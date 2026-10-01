// Actual app startup, isolated data, blocked network, real preload + synchronous IPC.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tomeva-desktop-'));
app.setPath('userData', directory);
const deadline = setTimeout(() => { console.error('Desktop smoke timed out'); app.exit(1); }, 60000);
app.whenReady().then(() => {
  console.log('Smoke: Electron ready');
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => cb({ cancel: true }));
  session.defaultSession.enableNetworkEmulation({ offline: true });
});
let completed = false;
app.on('browser-window-created', (_, window) => {
  console.log('Smoke: window created');
  window.webContents.on('did-fail-load', (_, code, description) => console.error('Load failed', code, description));
  window.webContents.on('render-process-gone', (_, details) => console.error('Renderer exited', details));
  window.webContents.on('preload-error', (_, filename, error) => console.error('Preload error', filename, error));
  window.webContents.on('console-message', (_, details) => {
    if (details.level === 'error') console.error('Renderer:', details.message);
  });
  window.webContents.once('did-finish-load', async () => {
    console.log('Smoke: page loaded');
    try {
      const result = await window.webContents.executeJavaScript(`(() => {
        const errors = [];
        const book = LibraryDB.addBook({access_no:'OFFLINE-1', document:'Offline test'});
        const student = LibraryDB.addStudent({adm_no:'OFFLINE-S', name:'Test student'});
        const issued = LibraryDB.issueBook('OFFLINE-S','OFFLINE-1');
        const returned = LibraryDB.returnBook('OFFLINE-1');
        return {book,student,issued:issued.ok,returned:returned.ok,
          synchronous:!(book instanceof Promise),status:LibraryDB.getBook('OFFLINE-1').status,
          firebase:typeof firebase,legacy:localStorage.getItem('tomeva.db'),
          nodeAvailable:typeof require !== 'undefined'};
      })()`);
      assert.equal(result.book.ok, true);
      assert.equal(result.student.ok, true);
      assert.equal(result.issued, true);
      assert.equal(result.returned, true);
      assert.equal(result.status, 'Available');
      assert.equal(result.synchronous, true);
      assert.equal(result.nodeAvailable, false);
      assert.equal(result.firebase, 'object');
      assert.equal(result.legacy, null);
      const lock = await window.webContents.executeJavaScript(`(async () => {
        const waitFor = async condition => {
          for (let i = 0; i < 100; i++) {
            if (condition()) return;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('Workstation lock UI did not change state');
        };
        const overlay = document.getElementById('workstation-lock-screen');
        document.getElementById('workstation-new-pin').value = '1234';
        document.getElementById('workstation-pin-form').requestSubmit();
        await waitFor(() => !document.getElementById('workstation-lock-now').hidden);
        document.getElementById('workstation-lock-now').click();
        await waitFor(() => !overlay.hidden);
        let blocked = false;
        try { LibraryDB.getBooks(); } catch (error) { blocked = /locked/.test(error.message); }
        document.getElementById('workstation-unlock-pin').value = '1234';
        document.getElementById('workstation-unlock-form').requestSubmit();
        await waitFor(() => overlay.hidden);
        return { blocked, books: LibraryDB.getBooks().length };
      })()`);
      assert.equal(lock.blocked, true);
      assert.equal(lock.books, 1);
      assert.ok(fs.existsSync(path.join(directory, 'tomeva.sqlite3')));
      completed = true;
      console.log('PASS: offline issue/return, local PIN lock/unlock, preload isolation and synchronous SQLite IPC');
      clearTimeout(deadline);
      app.quit();
    } catch (error) { console.error(error); clearTimeout(deadline); app.exit(1); }
  });
});
require('../main.js');
app.on('will-quit', () => { if (!completed) process.exitCode = 1; });

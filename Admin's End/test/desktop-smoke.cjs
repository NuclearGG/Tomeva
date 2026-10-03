const { app, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tomeva-admin-smoke-')));
app.setAsDefaultProtocolClient = () => true;
const packagedRoot = process.env.TOMEVA_PACKAGED_ROOT;
if (packagedRoot) {
  Object.defineProperty(app, 'isPackaged', { get: () => true });
  Object.defineProperty(process, 'resourcesPath', { value: path.join(packagedRoot, 'resources') });
}
const timer = setTimeout(() => { console.error('Admin smoke timed out'); app.exit(1); }, 90000);
app.whenReady().then(() => {
  console.log('Admin smoke: Electron ready');
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => callback({ cancel: true }));
});
app.on('browser-window-created', (_, window) => {
  console.log('Admin smoke: window created');
  window.webContents.on('console-message', (_, level, message) => console.error('Renderer console:', level, message));
  window.webContents.on('did-fail-load', (_, code, message) => console.error('Load failure:', code, message));
  window.webContents.on('preload-error', (_, file, error) => { console.error(file, error); app.exit(1); });
  window.webContents.once('did-finish-load', async () => {
    try {
      const state = await window.webContents.executeJavaScript(`(async () => {
        const config = await window.tomevaAdmin.getInstitution();
        const releases = await window.tomevaAdmin.reviewReleases();
        for (let attempt = 0; attempt < 50 && !document.querySelector('input[type="url"]'); attempt++) await new Promise(resolve => setTimeout(resolve, 20));
        return { node: typeof require, api: typeof window.tomevaAdmin.signInWithGoogle, connect: typeof window.tomevaAdmin.connectInstitution, config, releases, setupInput: !!document.querySelector('input[type="url"]'), title: document.title };
      })()`);
      assert.equal(state.node, 'undefined');
      assert.equal(state.api, 'function');
      assert.equal(state.connect, 'function');
      assert.equal(state.config, null);
      assert.ok(['current-release', 'error'].includes(state.releases.admin.state));
      assert.ok(['current-release', 'error'].includes(state.releases.librarian.state));
      assert.equal(state.setupInput, true);
      assert.match(state.title, /Tomeva/i);
      console.log('PASS: Admin window, sandboxed preload, institution IPC, and packaged release discovery');
      clearTimeout(timer); app.exit(0);
    } catch (error) { console.error(error); clearTimeout(timer); app.exit(1); }
  });
});
require(packagedRoot ? path.join(packagedRoot, 'resources/app.asar/main.js') : '../main.js');

const { app, session, dialog, clipboard } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tomeva-control-smoke-'));
app.setPath('userData', path.join(directory, 'user-data'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
const kitPath = path.join(directory, 'test-Recovery.tomeva');
dialog.showOpenDialog = async (_, options) => ({ canceled: false, filePaths: [options.properties.includes('openFile') ? kitPath : directory] });
dialog.showSaveDialog = async () => ({ canceled: false, filePath: kitPath });
dialog.showMessageBox = async () => ({ response: 1 });
const packagedRoot = process.env.TOMEVA_PACKAGED_ROOT;
if (packagedRoot) {
  Object.defineProperty(app, 'isPackaged', { get: () => true });
  Object.defineProperty(process, 'resourcesPath', { value: path.join(packagedRoot, 'resources') });
}
const deadline = setTimeout(() => { console.error('Control Center smoke timed out'); app.exit(1); }, 60000);
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => callback({ cancel: true }));
});
app.on('browser-window-created', (_, window) => {
  window.webContents.on('preload-error', (_, file, error) => console.error(file, error));
  window.webContents.once('did-finish-load', async () => {
    try {
      await window.webContents.executeJavaScript(`new Promise(resolve => setTimeout(resolve, 500))`);
      const status = await window.webContents.executeJavaScript(`({ node: typeof require, title: document.title, setupVisible: document.getElementById('page-overview').classList.contains('active') })`);
      assert.equal(status.node, 'undefined');
      assert.equal(status.title, 'Tomeva Control Center');
      assert.equal(status.setupVisible, true);
      assert.equal(await window.webContents.executeJavaScript(`typeof window.controlCenter.signIn`), 'undefined');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#signin-button') === null`), true);
      const config = { firebase: { apiKey: 'public-test-key', projectId: 'demo-school', authDomain: 'demo-school.firebaseapp.com', messagingSenderId: '123', appId: '1:123:web:abc' }, staffDomain: 'school.edu', vapidKey: '', webUrl: '' };
      assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('[data-install]').length`), 2);
      await window.webContents.executeJavaScript(`window.controlCenter.saveConfig(${JSON.stringify(config)})`);
      await window.webContents.executeJavaScript(`window.controlCenter.recoveryRun('create', 'institution passphrase 2026')`);
      const beforeVerify = fs.readFileSync(path.join(app.getPath('userData'), 'institution.json'), 'utf8');
      const verified = await window.webContents.executeJavaScript(`window.controlCenter.recoveryRun('verify', 'institution passphrase 2026')`);
      assert.equal(verified.valid, true);
      assert.equal(fs.readFileSync(path.join(app.getPath('userData'), 'institution.json'), 'utf8'), beforeVerify);
      for (const component of ['librarian', 'admin']) {
        const handoff = await window.webContents.executeJavaScript(`window.controlCenter.exportSetup(${JSON.stringify(config)}, '${component}')`);
        const folder = component === 'librarian' ? 'Librarian-Setup' : 'Admin-Setup';
        assert.ok(fs.existsSync(path.join(handoff.path, folder, 'institution.json')));
        assert.ok(!fs.existsSync(path.join(handoff.path, component === 'librarian' ? 'Admin-Setup' : 'Librarian-Setup')));
        if (packagedRoot) { assert.equal(handoff.installersIncluded, true); assert.ok(fs.statSync(handoff.installerPath).size > 1000000); }
      }
      const result = await window.webContents.executeJavaScript(`window.controlCenter.exportSetup(${JSON.stringify(config)})`);
      await window.webContents.executeJavaScript(`window.controlCenter.copyRules(${JSON.stringify(config)})`);
      assert.ok(clipboard.readText().includes('school\\\\.edu'));
      assert.ok(fs.existsSync(path.join(result.path, 'public', 'search.html')));
      const rules = fs.readFileSync(path.join(result.path, 'firestore.rules'), 'utf8');
      assert.ok(rules.includes('school\\\\.edu'));
      assert.ok(fs.existsSync(path.join(result.path, 'PASTE_IN_FIRESTORE_RULES.txt')));
      assert.ok(!fs.existsSync(path.join(result.path, 'functions')));
      assert.ok(!fs.existsSync(path.join(result.path, 'public', 'firebase-messaging-sw.js')));
      assert.ok(!JSON.parse(fs.readFileSync(path.join(result.path, 'firebase.json'), 'utf8')).functions);
      assert.ok(fs.existsSync(path.join(result.path, 'institution.json')));
      for (const folder of ['Librarian-Setup', 'Admin-Setup']) {
        const handoff = JSON.parse(fs.readFileSync(path.join(result.path, folder, 'institution.json'), 'utf8'));
        assert.deepEqual(handoff.firebase, config.firebase);
      }
      assert.ok(!fs.existsSync(path.join(result.path, 'public', 'control-sign-in')));
      assert.ok(fs.readFileSync(path.join(result.path, 'public', 'admin-sign-in', 'login.js'), 'utf8').includes('51734'));
      const web = await window.webContents.executeJavaScript(`window.controlCenter.exportWeb(${JSON.stringify(config)})`);
      assert.ok(fs.existsSync(path.join(web.path, 'index.html')));
      await window.webContents.executeJavaScript(`document.querySelector('[data-page="overview"]').click()`);
      const overviewVisible = await window.webContents.executeJavaScript(`document.getElementById('page-overview').classList.contains('active')`);
      assert.equal(overviewVisible, true);
      try {
        const image = await window.webContents.capturePage();
        const artifacts = path.join(__dirname, '..', 'test-artifacts');
        fs.mkdirSync(artifacts, { recursive: true });
        fs.writeFileSync(path.join(artifacts, 'overview.png'), image.toPNG());
        for (const page of ['packages', 'recovery']) {
          await window.webContents.executeJavaScript(`document.querySelector('[data-page="${page}"]').click()`);
          fs.writeFileSync(path.join(artifacts, page + '.png'), (await window.webContents.capturePage()).toPNG());
        }
      } catch (error) { console.warn('Screenshot unavailable in this desktop session:', error.message); }
      console.log('PASS: separate app, sandbox, input setup, rules clipboard, institution bundle, web export, navigation.');
      clearTimeout(deadline); app.exit(0);
    } catch (error) { console.error(error); clearTimeout(deadline); app.exit(1); }
  });
});
require(packagedRoot ? path.join(packagedRoot, 'resources', 'app.asar', 'main.js') : '../main');

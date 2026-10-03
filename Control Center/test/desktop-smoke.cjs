const { app, session, dialog, clipboard } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tomeva-control-smoke-'));
app.setPath('userData', path.join(directory, 'user-data'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
const webFixture = require('../../scripts/package-student.cjs').packageStudent(path.join(directory, 'publisher-fixture'));
const crypto = require('node:crypto');
global.fetch = async url => {
  const zip = fs.readFileSync(await webFixture);
  const version = require('../package.json').version;
  const payloads = new Map([
    [`tomeva-admin-${version}-win-x64.exe`, Buffer.from('MZ-test-admin')],
    [`tomeva-librarian-${version}-win-x64.exe`, Buffer.from('MZ-test-librarian')],
    [`tomeva-admin-${version}-linux-x64.AppImage`, Buffer.from('ELF-test-admin')],
    [`tomeva-librarian-${version}-linux-x64.AppImage`, Buffer.from('ELF-test-librarian')],
    [`tomeva-student-${version}.zip`, zip],
  ]);
  const assets = [...payloads].map(([name, data]) => ({ name, size: data.length, digest: 'sha256:' + crypto.createHash('sha256').update(data).digest('hex'), browser_download_url: `https://github.com/NuclearGG/Tomeva/releases/download/v${version}/${name}` }));
  if (url === 'https://api.github.com/repos/NuclearGG/Tomeva/releases/latest') return Response.json({ tag_name: 'v' + version, assets });
  const asset = assets.find(item => item.browser_download_url === url);
  if (asset) return new Response(payloads.get(asset.name));
  throw new Error('Unexpected network request: ' + url);
};
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
      const config = { institutionName: 'Example College', firebase: { apiKey: 'public-test-key', projectId: 'demo-school', authDomain: 'demo-school.firebaseapp.com', messagingSenderId: '123', appId: '1:123:web:abc' }, staffDomain: 'school.edu', vapidKey: '', webUrl: '' };
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[name="institutionName"]').required`), true);
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
        const expectedRules = await window.webContents.executeJavaScript(`window.controlCenter.getRules(${JSON.stringify(config)})`);
        assert.equal(fs.readFileSync(path.join(handoff.path, folder, 'PASTE_IN_FIRESTORE_RULES.txt'), 'utf8'), expectedRules);
        assert.ok(!fs.existsSync(path.join(handoff.path, component === 'librarian' ? 'Admin-Setup' : 'Librarian-Setup')));
        if (packagedRoot) { assert.equal(handoff.installersIncluded, true); assert.ok(fs.statSync(handoff.installerPath).size > 0); }
      }
      const linux = await window.webContents.executeJavaScript(`window.controlCenter.exportSetup(${JSON.stringify(config)}, 'librarian', 'linux')`);
      assert.ok(linux.installerPath.endsWith('.AppImage'));
      const result = await window.webContents.executeJavaScript(`window.controlCenter.exportSetup(${JSON.stringify(config)})`);
      const webRoot = path.join(result.path, 'Student-Portal');
      await window.webContents.executeJavaScript(`window.controlCenter.copyRules(${JSON.stringify(config)})`);
      assert.ok(clipboard.readText().includes('school\\\\.edu'));
      assert.ok(fs.existsSync(path.join(webRoot, 'public', 'search.html')));
      const rules = fs.readFileSync(path.join(webRoot, 'firestore.rules'), 'utf8');
      assert.equal(rules, clipboard.readText());
      assert.ok(rules.includes('school\\\\.edu'));
      assert.ok(fs.existsSync(path.join(webRoot, 'PASTE_IN_FIRESTORE_RULES.txt')));
      assert.ok(!fs.existsSync(path.join(webRoot, 'functions')));
      assert.ok(!fs.existsSync(path.join(webRoot, 'public', 'firebase-messaging-sw.js')));
      assert.ok(!JSON.parse(fs.readFileSync(path.join(webRoot, 'firebase.json'), 'utf8')).functions);
      for (const folder of ['Librarian-Setup', 'Admin-Setup']) {
        const handoff = JSON.parse(fs.readFileSync(path.join(result.path, folder, 'institution.json'), 'utf8'));
        assert.deepEqual(handoff.firebase, config.firebase);
        assert.equal(handoff.institutionName, config.institutionName);
      }
      assert.ok(!fs.existsSync(path.join(webRoot, 'public', 'control-sign-in')));
      assert.ok(fs.readFileSync(path.join(webRoot, 'public', 'admin-sign-in', 'login.js'), 'utf8').includes('51734'));
      const web = await window.webContents.executeJavaScript(`window.controlCenter.exportWeb(${JSON.stringify(config)})`);
      assert.ok(fs.existsSync(path.join(web.path, 'public', 'index.html')));
      const publicSetup = JSON.parse(fs.readFileSync(path.join(web.path, 'public', 'tomeva-institution.json'), 'utf8'));
      assert.equal(publicSetup.schemaVersion, 1);
      assert.equal(publicSetup.institutionName, config.institutionName);
      assert.deepEqual(publicSetup.firebase, config.firebase);
      assert.equal(publicSetup.staffDomain, config.staffDomain);
      assert.equal(publicSetup.webUrl, 'https://demo-school.web.app/');
      const otherConfig = { ...config, firebase: { ...config.firebase, projectId: 'demo-second-school' }, staffDomain: 'second.edu' };
      const otherRules = await window.webContents.executeJavaScript(`window.controlCenter.getRules(${JSON.stringify(otherConfig)})`);
      assert.ok(otherRules.includes('second\\\\.edu'));
      assert.ok(otherRules.includes('demo-second-school'));
      assert.ok(!otherRules.includes('school\\\\.edu'));
      assert.ok(!otherRules.includes('staff.example'));
      const otherWeb = await window.webContents.executeJavaScript(`window.controlCenter.exportWeb(${JSON.stringify(otherConfig)})`);
      assert.equal(fs.readFileSync(path.join(otherWeb.path, 'PASTE_IN_FIRESTORE_RULES.txt'), 'utf8'), otherRules);
      const otherAdmin = await window.webContents.executeJavaScript(`window.controlCenter.exportSetup(${JSON.stringify(otherConfig)}, 'admin')`);
      assert.equal(fs.readFileSync(path.join(otherAdmin.path, 'Admin-Setup', 'firestore.rules'), 'utf8'), otherRules);
      await window.webContents.executeJavaScript(`document.querySelector('[data-page="overview"]').click()`);
      const overviewVisible = await window.webContents.executeJavaScript(`document.getElementById('page-overview').classList.contains('active')`);
      assert.equal(overviewVisible, true);
      try {
        const image = await window.webContents.capturePage();
        const artifacts = path.join(__dirname, '..', 'test-artifacts');
        fs.mkdirSync(artifacts, { recursive: true });
        fs.writeFileSync(path.join(artifacts, 'overview.png'), image.toPNG());
        for (const page of ['setup', 'packages', 'recovery']) {
          await window.webContents.executeJavaScript(`document.querySelector('[data-page="${page}"]').click()`);
          assert.equal(await window.webContents.executeJavaScript(`document.getElementById('page-${page}').classList.contains('active')`), true);
          assert.doesNotMatch(await window.webContents.executeJavaScript(`document.body.innerText`), /me[\s_-]*academy/i);
          await window.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
          fs.writeFileSync(path.join(artifacts, page + '.png'), (await window.webContents.capturePage()).toPNG());
        }
      } catch (error) { console.warn('Screenshot unavailable in this desktop session:', error.message); }
      console.log('PASS: separate app, sandbox, input setup, rules clipboard, institution bundle, web export, navigation.');
      clearTimeout(deadline); app.exit(0);
    } catch (error) { console.error(error); clearTimeout(deadline); app.exit(1); }
  });
});
require(packagedRoot ? path.join(packagedRoot, 'resources', 'app.asar', 'main.js') : '../main');

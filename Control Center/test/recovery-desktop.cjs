// Real renderer/preload/main IPC, disposable profile, no external requests.
const { app, dialog, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tomeva-recovery-ui-'));
app.setPath('userData', path.join(directory, 'profile'));
app.disableHardwareAcceleration();
const kit = path.join(directory, 'school.tomeva');
const password = 'institution passphrase 2026';
let cancelSave = false, cancelOpen = false, response = 0, saves = 0;
dialog.showSaveDialog = async () => { saves++; return { canceled: cancelSave, filePath: kit }; };
dialog.showOpenDialog = async () => ({ canceled: cancelOpen, filePaths: [kit] });
dialog.showMessageBox = async (_, options) => { assert.equal(options.defaultId, 0); return { response }; };
global.fetch = async () => { throw new Error('External network disabled by recovery test'); };
const deadline = setTimeout(() => { console.error('Recovery UI test timed out'); app.exit(1); }, 45000);
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => callback({ cancel: true })));
app.on('browser-window-created', (_, window) => {
  window.hide();
  window.webContents.once('did-finish-load', async () => {
    const evaluate = source => window.webContents.executeJavaScript(source);
    async function click(action, value = password, confirmation = value) {
      return evaluate(`(async () => {
        document.getElementById('recovery-password').value = ${JSON.stringify(value)};
        document.getElementById('recovery-confirm').value = ${JSON.stringify(confirmation)};
        document.querySelector('[data-recovery="${action}"]').click();
        const start = Date.now();
        while (document.querySelector('[data-recovery="${action}"]').disabled) {
          if (Date.now() - start > 10000) throw new Error('Recovery button stayed disabled');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        return { notice: document.getElementById('notice').textContent,
          password: document.getElementById('recovery-password').value,
          confirmation: document.getElementById('recovery-confirm').value };
      })()`);
    }
    const configFile = path.join(app.getPath('userData'), 'institution.json');
    try {
      await evaluate(`new Promise(resolve => setTimeout(resolve, 300))`);
      const config = { institutionName: 'Recovery test school', firebase: { apiKey: 'public-test', projectId: 'demo-school', authDomain: 'demo-school.firebaseapp.com', appId: '1:123:web:test', messagingSenderId: '123' }, staffDomain: 'school.edu', webUrl: '' };
      await evaluate(`window.controlCenter.saveConfig(${JSON.stringify(config)})`);
      await evaluate(`document.querySelector('[data-page="recovery"]').click()`);
      assert.match((await click('create', password, 'mistyped password')).notice, /do not match/);
      assert.equal(saves, 0);
      const blank = await click('create', '            ');
      assert.match(blank.notice, /more than spaces/); assert.equal(blank.password, '');
      assert.equal(saves, 0);
      cancelSave = true; await click('create'); cancelSave = false;
      assert.ok(!fs.existsSync(kit));
      assert.match((await click('create')).notice, /saved to/);
      const originalKit = fs.readFileSync(kit, 'utf8');
      const originalConfig = fs.readFileSync(configFile, 'utf8');
      const wrong = await click('restore', 'wrong password');
      assert.match(wrong.notice, /verification failed/); assert.equal(wrong.password, ''); assert.equal(wrong.confirmation, '');
      assert.equal(fs.readFileSync(configFile, 'utf8'), originalConfig);
      fs.writeFileSync(kit, 'null');
      assert.match((await click('restore')).notice, /Invalid recovery metadata/);
      assert.equal(fs.readFileSync(configFile, 'utf8'), originalConfig);
      fs.writeFileSync(kit, originalKit);
      cancelOpen = true; await click('restore'); cancelOpen = false;
      await click('restore'); // Confirmation defaults to Cancel.
      assert.ok(!fs.existsSync(path.join(app.getPath('userData'), 'checkpoints')));
      fs.writeFileSync(configFile, '{damaged settings');
      response = 1;
      assert.match((await click('restore')).notice, /Local setup restored/);
      assert.equal(JSON.parse(fs.readFileSync(configFile)).staffDomain, 'school.edu');
      const [checkpoint] = fs.readdirSync(path.join(app.getPath('userData'), 'checkpoints'));
      assert.equal(fs.readFileSync(path.join(app.getPath('userData'), 'checkpoints', checkpoint, 'institution.json'), 'utf8'), '{damaged settings');
      fs.writeFileSync(path.join(app.getPath('userData'), 'recovery-metadata.json'), '{broken metadata');
      assert.match((await click('verify')).notice, /Recovery Kit valid/);
      assert.match(await evaluate(`document.getElementById('recovery-detail').textContent`), /damaged or missing/);
      assert.match((await click('copy', '')).notice, /Create a new kit/);
      assert.equal(await evaluate(`document.querySelectorAll('[data-recovery]:disabled').length`), 0);
      console.log('PASS: real recovery UI/IPC — mismatched and blank passwords, cancelled dialogs, wrong password/file, cancelled restore, restore over damaged settings, checkpoint bytes, damaged cache, cleared passwords and re-enabled controls.');
      clearTimeout(deadline); app.exit(0);
    } catch (error) { console.error(error); clearTimeout(deadline); app.exit(1); }
  });
});
require('../main');

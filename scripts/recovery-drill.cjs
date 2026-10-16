'use strict';
// Run actual desktop IPC against restored copies; never open a live profile for writing.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const electron = require(path.join(root, "Librarian's End/node_modules/electron"));
const mode = process.argv[2];
if (!mode) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const id = date + '-' + crypto.randomUUID();
  const directory = path.join(process.env.LOCALAPPDATA, 'Tomeva/RecoveryDrills', id);
  const passwords = path.join(process.env.LOCALAPPDATA, 'TomevaRecoveryPasswords');
  const circulation = path.join(process.env.LOCALAPPDATA, 'TomevaCirculationBackups', id);
  for (const folder of [directory, passwords, circulation]) {
    fs.mkdirSync(folder, { recursive: true });
    if (process.platform === 'win32') {
      const sid = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' }).match(/S-1-\d+(?:-\d+)+/)[0];
      execFileSync('icacls', [folder, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { windowsHide: true });
    }
  }
  const passwordFile = path.join(passwords, id + '.txt');
  fs.writeFileSync(passwordFile, crypto.randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' });
  const env = { ...process.env, TOMEVA_DRILL_ROOT: directory, TOMEVA_DRILL_PASSWORD_FILE: passwordFile, TOMEVA_DRILL_CIRCULATION_DIR: circulation };
  for (const job of ['snapshot', 'kit-create', 'kit-restore', 'library']) {
    const childEnv = { ...env }; delete childEnv.ELECTRON_RUN_AS_NODE;
    if (job === 'snapshot') childEnv.ELECTRON_RUN_AS_NODE = '1';
    const result = spawnSync(electron, [__filename, job], { env: childEnv, encoding: 'utf8', timeout: 60000, windowsHide: true });
    if (result.status !== 0) throw new Error(`Drill ${job} failed: ${result.stderr || result.stdout || result.error?.message}`);
    console.log('PASS: recovery drill ' + job);
  }
  const report = { completedAt: new Date().toISOString(), liveProfilesModified: false, circulationIncludesSyntheticDrillLoans: true, kitDirectory: path.join(directory, 'kits'), circulationDirectory: circulation, passwordFile, library: JSON.parse(fs.readFileSync(path.join(directory, 'library-result.json'))), kit: JSON.parse(fs.readFileSync(path.join(directory, 'kit-result.json'))) };
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ report: path.join(directory, 'report.json'), passwordFile, kitDirectory: report.kitDirectory, circulationDirectory: report.circulationDirectory }, null, 2));
} else if (mode === 'snapshot') {
  (async () => {
    const Database = require(path.join(root, "Librarian's End/node_modules/better-sqlite3"));
    const directory = process.env.TOMEVA_DRILL_ROOT;
    const target = path.join(directory, 'library-profile'); fs.mkdirSync(target);
    const source = new Database(path.join(process.env.APPDATA, 'Tomeva/tomeva.sqlite3'), { readonly: true, fileMustExist: true });
    try { await source.backup(path.join(target, 'tomeva.sqlite3')); } finally { source.close(); }
    const institution = path.join(process.env.APPDATA, 'Tomeva/institution.json');
    if (fs.existsSync(institution)) fs.copyFileSync(institution, path.join(target, 'institution.json'));
    const { SqliteStore } = require('../Librarian\'s End/main/sqlite-store');
    const { createLibraryService } = require('../Librarian\'s End/main/library-service');
    const store = new SqliteStore(target); store.initializeLegacy(null);
    // Machine-bound credentials are not circulation data. Use a new PIN only in
    // this disposable copy; the live workstation's verifier is never changed.
    const settings = store.collections.settings.findOne({});
    for (const key of Object.keys(settings)) if (key.startsWith('workstation_')) delete settings[key];
    store.collections.settings.update(settings);
    const api = createLibraryService(store);
    for (const suffix of ['ACTIVE', 'RETURN']) {
      const id = 'DRILL-' + suffix;
      if (!api.addBook({ access_no: id, document: 'Recovery drill ' + suffix }).ok) throw new Error('Drill book already exists');
      if (!api.addStudent({ adm_no: id, name: 'Synthetic recovery drill reader' }).ok || !api.issueBook(id, id).ok) throw new Error('Could not seed drill circulation');
    }
    const txn = store.collections.transactions.findOne({ book_access_no: 'DRILL-RETURN', status: 'Active' });
    txn.due_date = '2020-01-01'; store.collections.transactions.update(txn);
    if (!api.returnBook('DRILL-RETURN').ok || !api.markFinePaid(txn.transaction_id)) throw new Error('Could not seed drill fine history');
    store.close();
  })().catch(error => { console.error(error.message); process.exit(1); });
} else {
  const { app, session, dialog } = require('electron');
  const assert = require('node:assert/strict');
  const directory = process.env.TOMEVA_DRILL_ROOT;
  const kit = path.join(directory, 'kits/institution.tomeva');
  const backup = path.join(process.env.TOMEVA_DRILL_CIRCULATION_DIR, 'library.json');
  fs.mkdirSync(path.dirname(kit), { recursive: true }); fs.mkdirSync(path.dirname(backup), { recursive: true });
  const profile = path.join(directory, mode === 'library' ? 'library-profile' : mode === 'kit-create' ? 'control-create' : 'control-restored');
  app.setPath('userData', profile); app.disableHardwareAcceleration();
  app.setAsDefaultProtocolClient = () => true;
  if (mode === 'kit-create') {
    const sourceConfig = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'tomeva-control-center/institution.json')));
    require('../Control Center/config-store').createConfigStore(profile).save(sourceConfig);
  }
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: mode === 'library' ? backup : kit });
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [mode === 'library' ? backup : kit] });
  dialog.showMessageBox = async () => ({ response: 1 });
  global.fetch = async () => { throw new Error('No network during recovery drill'); };
  const deadline = setTimeout(() => { console.error('Recovery drill timed out'); app.exit(1); }, 45000);
  app.whenReady().then(() => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => cb({ cancel: true }));
    session.defaultSession.enableNetworkEmulation({ offline: true });
  });
  app.on('browser-window-created', (_, window) => {
    window.hide();
    window.webContents.once('did-finish-load', async () => {
      const evaluate = code => window.webContents.executeJavaScript(code);
      try {
        if (mode.startsWith('kit-')) {
          const password = fs.readFileSync(process.env.TOMEVA_DRILL_PASSWORD_FILE, 'utf8');
          const action = mode === 'kit-create' ? 'create' : 'restore';
          const result = await evaluate(`window.controlCenter.recoveryRun('${action}', ${JSON.stringify(password)})`);
          assert.ok(!result.cancelled && !result.warning);
          assert.equal((await evaluate(`window.controlCenter.recoveryRun('verify', ${JSON.stringify(password)})`)).valid, true);
          if (mode === 'kit-restore') {
            const { fingerprint } = require('../Control Center/recovery');
            const original = JSON.parse(fs.readFileSync(path.join(directory, 'control-create/institution.json')));
            const restored = await evaluate('window.controlCenter.getConfig()');
            assert.equal(fingerprint(restored), fingerprint(original));
            fs.writeFileSync(path.join(directory, 'kit-result.json'), JSON.stringify({ project: restored.firebase.projectId, fingerprint: fingerprint(restored), restoredIntoFreshProfile: true, verified: true }));
          }
        } else {
          const result = await evaluate(`(async () => {
            await new Promise(resolve => LibraryDB.onReady(resolve));
            const lock = await electronAPI.workstation.status();
            if (!lock.configured) {
              const configured = await electronAPI.workstation.setPin('482917', 10);
              if (!configured.ok) throw new Error(configured.msg);
            }
            const before = JSON.parse(LibraryDB.exportData());
            const saved = await electronAPI.backupDatabase();
            if (!saved.ok) throw new Error(saved.msg);
            const mutation = LibraryDB.addBook({ access_no: 'DRILL-AFTER-BACKUP', document: 'Must disappear on restore' });
            if (!mutation.ok) throw new Error(mutation.msg);
            const restored = await electronAPI.restoreDatabase();
            if (!restored.ok) throw new Error(restored.msg);
            const after = JSON.parse(LibraryDB.exportData());
            delete before.backup_date; delete before.checksum; delete after.backup_date; delete after.checksum;
            return { same: JSON.stringify(before) === JSON.stringify(after), active: LibraryDB.getActiveTransactions().length, payments: LibraryDB.getFinePayments().length, books: LibraryDB.getBooks().length, students: LibraryDB.getStudents().length, returned: !LibraryDB.getBook('DRILL-AFTER-BACKUP') };
          })()`);
          assert.equal(result.same, true); assert.equal(result.returned, true); assert.ok(result.active > 0 && result.payments > 0);
          assert.ok(fs.readdirSync(path.join(profile, 'restore-backups')).some(name => name.endsWith('.sqlite3')));
          fs.writeFileSync(path.join(directory, 'library-result.json'), JSON.stringify({ ...result, backupSha256: crypto.createHash('sha256').update(fs.readFileSync(backup)).digest('hex'), nativeCheckpointCreated: true }));
        }
        clearTimeout(deadline); app.exit(0);
      } catch (error) { console.error(error.message); clearTimeout(deadline); app.exit(1); }
    });
  });
  require(mode === 'library' ? '../Librarian\'s End/main' : '../Control Center/main');
}

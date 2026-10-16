const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm'); const { EventEmitter } = require('node:events');
function fixture() {
  const updater = new EventEmitter(); let installs = 0, checkpoints = 0, badHash = false, checkpointFailure = false;
  updater.checkForUpdates = async () => updater.emit('update-available', { version: '1.1.0' });
  updater.downloadUpdate = async () => ['fixture-installer']; updater.quitAndInstall = () => installs++;
  const verification = { trustPolicy: () => ({ mode: 'unsigned-pilot', publisherAuthenticated: false }), loadManifest: async () => new Map(), verifyFile: async () => { if (badHash) throw new Error('Changed checksum'); } };
  const context = { module: { exports: {} }, process: { platform: 'win32', arch: 'x64', resourcesPath: '/fixture' }, setTimeout: () => ({ unref() {} }), setInterval: () => ({ unref() {} }), clearTimeout() {}, clearInterval() {}, require: name => {
    if (name === 'electron') return { app: { isPackaged: true, getVersion: () => '1.0.9' }, Notification: { isSupported: () => false } };
    if (name === 'node:fs') return { existsSync: () => true };
    if (name === 'node:path') return path;
    if (name === './build-variant.json') return { legacyWindows: false };
    if (name.includes('release-verification')) return verification;
    if (name === 'electron-updater') return { autoUpdater: updater };
    throw new Error('Unexpected dependency ' + name);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../update-manager.js'), 'utf8'), context);
  const manager = context.module.exports.createUpdateManager({ send() {}, open() {}, beforeInstall: async () => { checkpoints++; if (checkpointFailure) throw new Error('Disk full'); } });
  manager.start();
  return { manager, updater, corrupt() { badHash = true; }, failCheckpoint() { checkpointFailure = true; }, get installs() { return installs; }, get checkpoints() { return checkpoints; } };
}
test('Control Center remains operator-managed and states unsigned pilot trust honestly', async () => {
  const f = fixture(); assert.equal(f.updater.autoDownload, false); assert.equal(f.updater.autoInstallOnAppQuit, false); assert.equal(f.updater.allowDowngrade, false); assert.equal(f.updater.allowPrerelease, false);
  await f.manager.check(); assert.equal(f.installs, 0); await f.manager.download(); assert.equal(f.manager.getStatus().state, 'ready'); assert.match(f.manager.getStatus().message, /Unsigned pilot/);
  await f.manager.install(); assert.equal(f.installs, 1); assert.equal(f.checkpoints, 1);
});
test('tampered ready installers cannot install or be reported as a checkpoint failure', async () => {
  const f = fixture(); await f.manager.check(); await f.manager.download(); f.corrupt(); await f.manager.install();
  assert.equal(f.installs, 0); assert.equal(f.checkpoints, 0); assert.equal(f.manager.getStatus().state, 'error'); assert.match(f.manager.getStatus().message, /verification failed/);
});
test('failed pre-install checkpoint keeps a verified update postponed without installing', async () => {
  const f = fixture(); await f.manager.check(); await f.manager.download(); f.failCheckpoint(); await f.manager.install();
  assert.equal(f.installs, 0); assert.equal(f.manager.getStatus().state, 'ready'); assert.match(f.manager.getStatus().message, /checkpoint failed/);
});

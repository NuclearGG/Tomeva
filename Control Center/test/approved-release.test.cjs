const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
test('workstation pins GitHub to institution-approved tag rather than the newest public tag', async () => {
  let feed, checks = 0;
  const updater = { on() {}, setFeedURL(value) { feed = value; }, async checkForUpdates() { checks++; } };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../desktop-integration/native-updater.cjs'), 'utf8'), {
    module: mod, process: { resourcesPath: '/resources' }, console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    require(name) {
      if (name === 'electron') return { app: { isPackaged: true, setAsDefaultProtocolClient() {} }, dialog: { showMessageBox: async () => ({ response: 0 }) }, Notification: { isSupported: () => false } };
      if (name === 'node:fs') return { existsSync: () => true };
      if (name === './institution-config.cjs') return { read: () => ({}) };
      if (name === './update-policy.cjs') return { approvedVersion: async () => '1.2.0', checkApproval: async () => true };
      return require(name);
    },
  });
  const manager = mod.exports.createNativeUpdater({ getUpdater: () => updater, getWindow: () => null, protocol: 'tomeva-admin' });
  manager.start();
  try { await manager.check(); } finally { manager.stop(); }
  assert.equal(feed.url, 'https://github.com/NuclearGG/Tomeva/releases/download/v1.2.0/');
  assert.equal(feed.channel, 'admin');
  assert.equal(checks, 1);
  assert.equal(updater.allowDowngrade, false);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { encrypt, decrypt, createRecovery } = require('../recovery');
const { createConfigStore } = require('../config-store');
const config = { firebase: { apiKey: 'public-key', projectId: 'demo-school', authDomain: 'demo-school.firebaseapp.com', appId: '1:123:web:abc', messagingSenderId: '123' }, staffDomain: 'school.edu', webUrl: '' };
const password = 'institution passphrase 2026';
test('encrypted round trip, random salt/IV, wrong password, tamper and unsupported format', async () => {
  const kit = await encrypt(config, password);
  const second = await encrypt(config, password);
  assert.notEqual(kit.salt, second.salt);
  assert.notEqual(kit.iv, second.iv);
  assert.ok(!JSON.stringify(kit).includes('demo-school'));
  assert.equal((await decrypt(JSON.stringify(kit), password)).config.firebase.projectId, 'demo-school');
  await assert.rejects(decrypt(JSON.stringify(kit), 'incorrect password'), /verification failed/);
  await assert.rejects(decrypt(JSON.stringify({ ...kit, tag: Buffer.alloc(16).toString('base64') }), password), /verification failed/);
  await assert.rejects(decrypt(JSON.stringify({ ...kit, N: 2147483648 }), password), /Unsupported/);
  await assert.rejects(decrypt(JSON.stringify({ ...kit, version: 2 }), password), /Unsupported/);
});
test('verification leaves live configuration untouched; restore checkpoints; configuration changes mark kit stale', async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'tomeva-recovery-'));
  const store = createConfigStore(userData); store.save(config);
  const kit = path.join(userData, 'export.tomeva');
  const recovery = createRecovery({ userData, store, version: '1.0.0', getWindow: () => null, dialog: {
    showSaveDialog: async () => ({ filePath: kit }),
    showOpenDialog: async () => ({ filePaths: [kit] }),
    showMessageBox: async () => ({ response: 1 }),
  }});
  await recovery.run('create', password);
  assert.equal((await recovery.status()).stale, false);
  store.save({ ...config, staffDomain: 'changed.edu' });
  assert.equal((await recovery.status()).stale, true);
  const before = await fs.readFile(path.join(userData, 'institution.json'), 'utf8');
  assert.equal((await recovery.run('verify', password)).valid, true);
  assert.equal(await fs.readFile(path.join(userData, 'institution.json'), 'utf8'), before);
  await assert.rejects(recovery.run('restore', 'incorrect password'));
  assert.equal(store.read().staffDomain, 'changed.edu');
  await recovery.run('restore', password);
  assert.equal(store.read().staffDomain, 'school.edu');
  assert.equal((await fs.readdir(path.join(userData, 'checkpoints'))).length, 1);
});
test('versioned migration backs up legacy data and refuses future schemas', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tomeva-migration-'));
  const filename = path.join(dir, 'institution.json');
  await fs.writeFile(filename, JSON.stringify(config));
  const store = createConfigStore(dir); store.read();
  assert.equal(JSON.parse(await fs.readFile(filename)).schemaVersion, 1);
  assert.ok((await fs.readdir(dir)).some(name => name.endsWith('.backup.json')));
  await fs.writeFile(filename, JSON.stringify({ ...config, schemaVersion: 999 }));
  assert.throws(() => store.read(), /Unsupported/);
});

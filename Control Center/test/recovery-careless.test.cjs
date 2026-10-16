const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRecovery, encrypt, decrypt } = require('../recovery');
const { createConfigStore } = require('../config-store');
const config = { firebase: { apiKey: 'public-key', projectId: 'demo-school', authDomain: 'demo-school.firebaseapp.com', appId: '1:123:web:abc', messagingSenderId: '123' }, staffDomain: 'school.edu', webUrl: '' };
const password = 'institution passphrase 2026';
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tomeva-careless-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const userData = path.join(dir, 'profile');
  const store = createConfigStore(userData); store.save(config);
  const state = { save: { filePath: path.join(dir, 'export.tomeva') }, open: { filePaths: [path.join(dir, 'export.tomeva')] }, response: 1, saveCalls: 0 };
  const recovery = createRecovery({ userData, store, version: 'test', getWindow: () => null, dialog: {
    showSaveDialog: async () => { state.saveCalls++; return state.save; },
    showOpenDialog: async () => state.open,
    showMessageBox: async (_, options) => { state.confirmation = options; return { response: state.response }; },
  } });
  return { dir, userData, store, state, recovery };
}
test('careless save cannot overwrite settings, internal cache, or a non-kit file', async t => {
  const f = await fixture(t);
  const original = await fs.readFile(path.join(f.userData, 'institution.json'), 'utf8');
  for (const target of ['institution.json', 'recovery.tomeva', 'checkpoints/mistake.tomeva']) {
    f.state.save.filePath = path.join(f.userData, target);
    await assert.rejects(f.recovery.run('create', password), /outside.*Control Center|outside.*profile/i);
  }
  f.state.save.filePath = path.join(f.dir, 'important.json');
  await fs.writeFile(f.state.save.filePath, 'important original');
  await assert.rejects(f.recovery.run('create', password), /\.tomeva/);
  assert.equal(await fs.readFile(f.state.save.filePath, 'utf8'), 'important original');
  assert.equal(await fs.readFile(path.join(f.userData, 'institution.json'), 'utf8'), original);
});
test('missing, corrupt, and stale cached kits cannot be exported as current', async t => {
  const f = await fixture(t);
  await f.recovery.run('create', password);
  const cache = path.join(f.userData, 'recovery.tomeva');
  const good = await fs.readFile(cache, 'utf8');
  await fs.unlink(cache);
  assert.equal((await f.recovery.status()).exists, false);
  await assert.rejects(f.recovery.run('copy', ''), /Create|missing/i);
  await fs.writeFile(cache, '{broken');
  assert.equal((await f.recovery.status()).stale, true);
  await assert.rejects(f.recovery.run('copy', ''), /Create|damaged/i);
  await fs.writeFile(cache, good);
  await fs.writeFile(path.join(f.userData, 'recovery-metadata.json'), '{broken');
  assert.equal((await f.recovery.status()).stale, true);
  await assert.rejects(f.recovery.run('copy', ''), /Create|damaged/i);
  await f.recovery.run('create', password);
  f.store.save({ ...config, staffDomain: 'changed.edu' });
  await assert.rejects(f.recovery.run('copy', ''), /Create|updated/i);
});
test('cancelling dialogs or restore confirmation preserves all local settings', async t => {
  const f = await fixture(t);
  const before = await fs.readFile(path.join(f.userData, 'institution.json'), 'utf8');
  f.state.save = { canceled: true };
  assert.deepEqual(await f.recovery.run('create', password), { cancelled: true });
  f.state.open = { canceled: true };
  for (const action of ['verify', 'restore']) assert.deepEqual(await f.recovery.run(action, password), { cancelled: true });
  f.state.open = { filePaths: [path.join(f.dir, 'other.tomeva')] };
  await fs.writeFile(f.state.open.filePaths[0], JSON.stringify(await encrypt({ ...config, staffDomain: 'other.edu' }, password)));
  f.state.response = 0;
  assert.deepEqual(await f.recovery.run('restore', password), { cancelled: true });
  assert.equal(f.state.confirmation.defaultId, 0);
  assert.equal(await fs.readFile(path.join(f.userData, 'institution.json'), 'utf8'), before);
  await assert.rejects(fs.access(path.join(f.userData, 'checkpoints')));
});
test('wrong files and passwords preserve settings; a subsequent valid restore still works', async t => {
  const f = await fixture(t);
  const before = await fs.readFile(path.join(f.userData, 'institution.json'), 'utf8');
  for (const value of ['', 'null', '[]', '{broken', JSON.stringify(config), 'x'.repeat(65537)]) {
    await fs.writeFile(f.state.open.filePaths[0], value);
    await assert.rejects(f.recovery.run('restore', password));
    assert.equal(await fs.readFile(path.join(f.userData, 'institution.json'), 'utf8'), before);
  }
  await fs.writeFile(f.state.open.filePaths[0], JSON.stringify(await encrypt(config, password)));
  await assert.rejects(f.recovery.run('restore', 'wrong password'));
  await fs.writeFile(path.join(f.userData, 'institution.json'), '{damaged local settings');
  assert.equal((await f.recovery.status()).stale, true);
  assert.equal((await f.recovery.run('restore', password)).valid, true);
  assert.equal(f.store.read().staffDomain, config.staffDomain);
  const [checkpoint] = await fs.readdir(path.join(f.userData, 'checkpoints'));
  assert.equal(await fs.readFile(path.join(f.userData, 'checkpoints', checkpoint, 'institution.json'), 'utf8'), '{damaged local settings');
});
test('failed export preserves a previous kit and releases the busy lock', async t => {
  const f = await fixture(t);
  await f.recovery.run('create', password);
  const before = await fs.readFile(path.join(f.userData, 'recovery.tomeva'), 'utf8');
  f.state.save.filePath = path.join(f.dir, 'missing-folder', 'kit.tomeva');
  await assert.rejects(f.recovery.run('create', password));
  assert.equal(await fs.readFile(path.join(f.userData, 'recovery.tomeva'), 'utf8'), before);
  assert.equal((await f.recovery.status()).stale, false);
  f.state.save.filePath = path.join(f.dir, 'retry.tomeva');
  await f.recovery.run('create', password);
  assert.equal((await decrypt(await fs.readFile(f.state.save.filePath, 'utf8'), password)).config.staffDomain, config.staffDomain);
});
test('double clicks are rejected; blank creation passwords fail before opening Save', async t => {
  const f = await fixture(t);
  await assert.rejects(f.recovery.run('create', '            '), /password/i);
  assert.equal(f.state.saveCalls, 0);
  const pending = f.recovery.run('create', password);
  await assert.rejects(f.recovery.run('restore', password), /already running/);
  await pending;
  assert.equal((await f.recovery.run('verify', password)).valid, true);
});
test('a failed final export write preserves the previous destination and removes temporary files', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.state.save.filePath, 'previous off-computer copy');
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (source, target) => {
    if (target === f.state.save.filePath) throw Object.assign(new Error('Simulated destination failure'), { code: 'ENOSPC' });
    return rename(source, target);
  });
  await assert.rejects(f.recovery.run('create', password), /Simulated destination/);
  assert.equal(await fs.readFile(f.state.save.filePath, 'utf8'), 'previous off-computer copy');
  assert.ok(!(await fs.readdir(f.dir)).some(name => name.endsWith('.tmp')));
});
test('cache failure reports the successful external export honestly; failed checkpoint prevents restore', async t => {
  const f = await fixture(t);
  await f.recovery.run('create', password);
  const rename = fs.rename;
  const mock = t.mock.method(fs, 'rename', async (source, target) => {
    if (target === path.join(f.userData, 'recovery-metadata.json')) throw new Error('Simulated metadata write failure');
    return rename(source, target);
  });
  const result = await f.recovery.run('create', password);
  assert.match(result.warning, /exported kit was saved/);
  assert.equal((await f.recovery.status()).stale, true);
  assert.equal((await decrypt(await fs.readFile(result.path, 'utf8'), password)).config.staffDomain, config.staffDomain);
  mock.mock.restore();
  f.store.save({ ...config, staffDomain: 'keep.edu' });
  await fs.writeFile(path.join(f.userData, 'checkpoints'), 'blocked checkpoint folder');
  await assert.rejects(f.recovery.run('restore', password));
  assert.equal(f.store.read().staffDomain, 'keep.edu');
});
test('a linked export directory cannot overwrite the recovery cache', async t => {
  const f = await fixture(t);
  const linked = path.join(f.dir, 'shortcut');
  await fs.symlink(f.userData, linked, process.platform === 'win32' ? 'junction' : 'dir');
  f.state.save.filePath = path.join(linked, 'recovery.tomeva');
  await assert.rejects(f.recovery.run('create', password), /outside.*Control Center/);
  assert.equal(f.store.read().staffDomain, config.staffDomain);
});
test('a disk-full error after a partial write cannot truncate the existing export', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.state.save.filePath, 'last good external kit');
  const open = fs.open;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args);
    if (args[0].startsWith(f.state.save.filePath + '.')) {
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async () => {
        await write('partial write');
        throw Object.assign(new Error('Simulated disk full'), { code: 'ENOSPC' });
      };
    }
    return handle;
  });
  await assert.rejects(f.recovery.run('create', password), /disk full/);
  assert.equal(await fs.readFile(f.state.save.filePath, 'utf8'), 'last good external kit');
  assert.ok(!(await fs.readdir(f.dir)).some(name => name.endsWith('.tmp')));
});

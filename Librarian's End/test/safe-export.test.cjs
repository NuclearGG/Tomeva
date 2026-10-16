const { test } = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs/promises'); const path = require('node:path'); const os = require('node:os');
const { writeBackup } = require('../main/safe-export');
test('native backup cannot overwrite its live profile and failed writes preserve the last external copy', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tomeva-safe-backup-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const profile = path.join(directory, 'profile'); await fs.mkdir(profile); const target = path.join(directory, 'backup.json');
  await fs.writeFile(path.join(profile, 'institution.json'), 'current settings');
  await assert.rejects(writeBackup(profile, path.join(profile, 'institution.json'), '{}'), /outside/);
  await assert.rejects(writeBackup(profile, path.join(directory, 'tomeva.sqlite3'), '{}'), /\.json/);
  await writeBackup(profile, target, 'last good backup');
  const rename = fs.rename; t.mock.method(fs, 'rename', async (...args) => { if (args[1] === target) throw new Error('Simulated export failure'); return rename(...args); });
  await assert.rejects(writeBackup(profile, target, 'new partial backup'), /failure/);
  assert.equal(await fs.readFile(target, 'utf8'), 'last good backup'); assert.equal(await fs.readFile(path.join(profile, 'institution.json'), 'utf8'), 'current settings');
});

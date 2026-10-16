'use strict';
const fs = require('node:fs/promises'); const path = require('node:path'); const { randomUUID } = require('node:crypto');
async function writeBackup(userData, filename, text) {
  if (typeof filename !== 'string' || path.extname(filename).toLowerCase() !== '.json') throw new Error('Choose a .json backup file outside the application profile.');
  const root = await fs.realpath(userData), parent = await fs.realpath(path.dirname(filename));
  const relative = path.relative(root, parent);
  if (!relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) throw new Error('Save circulation backups outside the application profile to protect live settings and SQLite.');
  try { if ((await fs.lstat(filename)).isSymbolicLink()) throw new Error('Choose a regular backup file, not a link.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (Buffer.byteLength(text) > 100 * 1024 * 1024) throw new Error('Backup exceeds the supported 100 MiB restore limit.');
  const temporary = filename + '.' + randomUUID() + '.tmp'; let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600); await handle.writeFile(text); await handle.sync(); await handle.close(); handle = null;
    await fs.rename(temporary, filename);
  } finally { if (handle) await handle.close(); await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
module.exports = { writeBackup };

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function migrateSchema(database, directory, migrations) {
  if (!migrations.length || migrations.some((step, index) => step.version !== index + 1 || typeof step.up !== 'function')) throw new Error('Schema migrations must have consecutive versions starting at 1.');
  const current = database.pragma('user_version', { simple: true }), latest = migrations.at(-1).version;
  if (current > latest) throw new Error(`Database schema ${current} is newer than supported schema ${latest}. Open it with a newer Tomeva; do not downgrade this profile.`);
  if (current === latest) return { from: current, to: latest, backupPath: null };
  let backupPath = null;
  if (database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get()) {
    const folder = path.join(directory, 'schema-backups'); fs.mkdirSync(folder, { recursive: true });
    backupPath = path.join(folder, `schema-${current}-${Date.now()}-${randomUUID()}.sqlite3`);
    // VACUUM INTO makes a synchronous, consistent copy, including committed WAL
    // pages. It must finish before entering the migration transaction.
    database.prepare('VACUUM main INTO ?').run(backupPath);
    fs.chmodSync(backupPath, 0o600);
    const descriptor = fs.openSync(backupPath, 'r+');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  }
  try {
    database.transaction(() => {
      for (const step of migrations.filter(step => step.version > current)) {
        step.up(database);
        database.pragma(`user_version = ${step.version}`);
      }
    }).immediate();
  } catch (error) {
    throw new Error(`Schema upgrade ${current} → ${latest} failed and was rolled back.${backupPath ? ' Backup: ' + backupPath + '.' : ''} ${error.message}`, { cause: error });
  }
  return { from: current, to: latest, backupPath };
}
module.exports = { migrateSchema };

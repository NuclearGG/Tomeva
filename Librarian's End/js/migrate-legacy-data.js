/* One-time migration. A committed main-process marker makes cleanup retries safe. */
(function(root) {
  'use strict';
  function run(db, storage) {
    const raw = storage.getItem('tomeva.db');
    const result = db.initialize(raw);
    if (!result?.ok || !result.verified) throw new Error('Migration was not verified. Legacy data was retained.');
    if (raw !== null && result.cleanupAllowed) {
      try {
        if (storage.getItem('tomeva.db') !== raw) throw new Error('Legacy data changed during migration.');
        storage.removeItem('tomeva.db');
      } catch (error) {
        return { ...result, notice: 'SQLite is ready. The legacy copy was retained: ' + error.message };
      }
    }
    return { ...result, notice: result.migrated ? 'Your library data was moved to SQLite. A verified backup was saved on this computer.' : '' };
  }
  root.LegacyMigration = { run };
  if (typeof module !== 'undefined') module.exports = { run };
})(globalThis);

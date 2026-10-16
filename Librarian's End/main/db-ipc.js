'use strict';
const { createLibraryService } = require('./library-service');
// Native restore and direct status changes must not be reachable through IPC.
const RENDERER_METHODS = new Set([
  'pageRows', 'fineSummary',
  'getRosterSyncCursor', 'setRosterSyncCursor', 'getCloudSnapshotHistory', 'recordCloudSnapshot', 'forgetCloudSnapshot',
  'getSettings', 'saveSettings', 'getBooks', 'getBook', 'searchBooks', 'addBook', 'importBooks',
  'getStudents', 'getStudent', 'getStudentByAdmNo', 'searchStudents', 'addStudent', 'updateStudent', 'deleteStudent',
  'upsertStudentFromCloud', 'updateStudentGroup', 'importStudents', 'studentDisplayName', 'bookDisplayTitle',
  'getTransactions', 'issueBook', 'issueBookToTeacher', 'returnBook', 'getActiveTxnForBook', 'getActiveTransactions',
  'getOverdueTransactions', 'getReturnedToday', 'getPendingFines', 'markFinePaid', 'getFinePayments',
  'getTotalCollected', 'getCollectedToday', 'reportDamage', 'restoreBook', 'undoLastTransaction', 'exportData',
  'calcLateDays', 'formatDate', 'hasBooks', 'hasStudents', 'isEmpty',
]);

function registerDatabaseIpc(ipcMain, store, isTrusted, appendLog, isLocked = () => false, diagnostics = () => {}) {
  let service;
  let windowStart = 0, calls = 0;
  const handle = (channel, operation) => ipcMain.on(channel, (event, ...args) => {
    try {
      if (!isTrusted(event)) throw new Error('Database access denied.');
      const now = Date.now(); if (now - windowStart >= 1000) { windowStart = now; calls = 0; }
      if (++calls > 1000) throw new Error('Too many database operations. Wait a moment and retry.');
      event.returnValue = { ok: true, value: operation(...args) };
    } catch (error) {
      diagnostics('warn', 'database.operation.rejected', { channel, code: error.code || 'OPERATION_REJECTED' });
      event.returnValue = { ok: false, error: error.message };
    }
  });
  handle('db:initialize', raw => {
    if (raw !== null && (typeof raw !== 'string' || Buffer.byteLength(raw) > 100 * 1024 * 1024)) throw new Error('Legacy data exceeds the supported 100 MiB migration limit.');
    const result = store.initializeLegacy(raw);
    service ||= createLibraryService(store, appendLog, diagnostics);
    diagnostics('info', 'database.initialized', { dbSchemaVersion: store.database.pragma('user_version', { simple: true }) });
    return result;
  });
  handle('db:call', (method, args) => {
    if (!service) throw new Error('Database migration has not completed.');
    if (isLocked()) throw new Error('Workstation is locked.');
    if (!RENDERER_METHODS.has(method) || !Object.hasOwn(service, method) || typeof service[method] !== 'function' || !Array.isArray(args)) {
      throw new Error('Unsupported database operation.');
    }
    if (args.length > 8 || Buffer.byteLength(JSON.stringify(args)) > (['importBooks', 'importStudents'].includes(method) ? 4 * 1024 * 1024 : 32768)) throw new Error('Database arguments exceed the supported limit.');
    return service[method](...args);
  });
  return () => {
    if (!service) throw new Error('Database migration has not completed.');
    return service;
  };
}
module.exports = { registerDatabaseIpc };

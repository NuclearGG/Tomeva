'use strict';
const { createLibraryService } = require('./library-service');

function registerDatabaseIpc(ipcMain, store, isTrusted, appendLog, isLocked = () => false) {
  let service;
  const handle = (channel, operation) => ipcMain.on(channel, (event, ...args) => {
    try {
      if (!isTrusted(event)) throw new Error('Database access denied.');
      event.returnValue = { ok: true, value: operation(...args) };
    } catch (error) {
      event.returnValue = { ok: false, error: error.message };
    }
  });
  handle('db:initialize', raw => {
    const result = store.initializeLegacy(raw);
    service ||= createLibraryService(store, appendLog);
    return result;
  });
  handle('db:call', (method, args) => {
    if (!service) throw new Error('Database migration has not completed.');
    if (isLocked()) throw new Error('Workstation is locked.');
    if (!Object.hasOwn(service, method) || typeof service[method] !== 'function' || !Array.isArray(args)) {
      throw new Error('Unsupported database operation.');
    }
    return service[method](...args);
  });
}
module.exports = { registerDatabaseIpc };

/* Renderer compatibility API. Records and business rules live in Electron main. */
const LibraryDB = (() => {
  'use strict';
  let ready = false;
  let notice = '';
  const callbacks = [];
  const api = Object.fromEntries(["getSettings","saveSettings","getBooks","getBook","searchBooks","addBook","updateBookStatus","importBooks","getStudents","getStudent","getStudentByAdmNo","searchStudents","addStudent","updateStudent","deleteStudent","upsertStudentFromCloud","updateStudentGroup","importStudents","studentDisplayName","bookDisplayTitle","getTransactions","issueBook","issueBookToTeacher","returnBook","getActiveTxnForBook","getActiveTransactions","getOverdueTransactions","getReturnedToday","getPendingFines","markFinePaid","getFinePayments","getTotalCollected","getCollectedToday","reportDamage","restoreBook","undoLastTransaction","undoAction","exportData","restoreData","calcLateDays","formatDate","hasBooks","hasStudents","isEmpty"].map(
    method => [method, (...args) => {
      if (!ready) throw new Error('Library database is not ready.');
      return window.electronAPI.db[method](...args);
    }]
  ));
  api.VALID_GROUPS = ['Regular', 'Literary Club', 'Editorial Board'];
  for (const method of ['getRosterSyncCursor', 'setRosterSyncCursor']) {
    api[method] = (...args) => {
      if (!ready) throw new Error('Library database is not ready.');
      return window.electronAPI.db[method](...args);
    };
  }
  api.onReady = cb => ready ? cb() : callbacks.push(cb);
  api.getMigrationNotice = () => notice;
  api.backupData = async () => window.electronAPI.backupDatabase(api.exportData());
  api.init = () => {
    if (ready) return;
    try {
      if (!window.electronAPI?.db) throw new Error('Open Tomeva in the desktop app to use the local database.');
      const result = LegacyMigration.run(window.electronAPI.db, window.localStorage);
      notice = result.notice;
    } catch (error) {
      console.error('[Database]', error);
      const showError = () => {
        const banner = document.createElement('div');
        banner.setAttribute('role', 'alert');
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;padding:18px;background:#7f1d1d;color:white;font:16px sans-serif';
        banner.textContent = 'Library database could not open. Your existing data has been retained. ' + error.message;
        document.body.prepend(banner);
      };
      if (document.body) showError();
      else document.addEventListener('DOMContentLoaded', showError, { once: true });
      return;
    }
    ready = true;
    callbacks.splice(0).forEach(cb => cb());
  };
  return api;
})();
LibraryDB.init();

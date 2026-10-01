/**
 * Electron Preload Script
 * Exposes safe IPC methods to the renderer process via contextBridge
 */

const { contextBridge, ipcRenderer } = require('electron');

// Synchronous local IPC preserves the existing LibraryDB return values.
function databaseCall(channel, ...args) {
  const response = ipcRenderer.sendSync(channel, ...args);
  if (!response?.ok) throw new Error(response?.error || 'Database unavailable.');
  return response.value;
}
const db = {
  initialize: raw => databaseCall('db:initialize', raw),
  getRosterSyncCursor: () => databaseCall('db:call', 'getRosterSyncCursor', []),
  setRosterSyncCursor: value => databaseCall('db:call', 'setRosterSyncCursor', [value]),
  ...Object.fromEntries(["getSettings","saveSettings","getBooks","getBook","searchBooks","addBook","upsertStudentFromCloud","updateBookStatus","importBooks","getStudents","getStudent","getStudentByAdmNo","searchStudents","addStudent","updateStudentGroup","importStudents","studentDisplayName","bookDisplayTitle","getTransactions","issueBook","issueBookToTeacher","returnBook","getActiveTxnForBook","getActiveTransactions","getOverdueTransactions","getReturnedToday","getPendingFines","markFinePaid","getFinePayments","getTotalCollected","getCollectedToday","reportDamage","restoreBook","undoLastTransaction","undoAction","exportData","restoreData","calcLateDays","formatDate","hasBooks","hasStudents","isEmpty"].map(
    method => [method, (...args) => databaseCall('db:call', method, args)]
  )),
};

contextBridge.exposeInMainWorld('electronAPI', {
  db,
  workstation: {
    status: () => ipcRenderer.invoke('workstation:status'),
    setPin: (pin, idleMinutes, currentPin) => ipcRenderer.invoke('workstation:set-pin', pin, idleMinutes, currentPin),
    lock: () => ipcRenderer.invoke('workstation:lock'),
    unlock: pin => ipcRenderer.invoke('workstation:unlock', pin),
  },
  // File dialogs (restricted to downloads folder, JSON only)
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),

  // Purpose-built database operations
  backupDatabase: (backupJson) => ipcRenderer.invoke('backup-database', backupJson),
  restoreDatabase: () => ipcRenderer.invoke('restore-database'),
  exportActivityLog: (maxLines) => ipcRenderer.invoke('export-activity-log', { maxLines }),

  // Activity log (transactions.log — appended on every issue/return/etc.)
  appendLog:     (line)     => ipcRenderer.invoke('append-log', line),
  getLogInfo:    ()         => ipcRenderer.invoke('get-log-info'),
  openLogFolder: ()         => ipcRenderer.invoke('open-log-folder'),
  readCurrentLog:(maxLines) => ipcRenderer.invoke('read-current-log', maxLines),

  // Kiosk credentials (OS keychain via safeStorage) — for kiosk auth
  getKioskCreds: (workstationId) => ipcRenderer.invoke('get-kiosk-creds', workstationId),
  setKioskCreds: (workstationId, email, password) => ipcRenderer.invoke('set-kiosk-creds', workstationId, email, password),

  // Menu events → renderer
  onMenuBackup:   (cb) => ipcRenderer.on('menu-backup', cb),
  onMenuUndo:     (cb) => ipcRenderer.on('menu-undo', cb),
  onNavigate:     (cb) => ipcRenderer.on('navigate', (_, page) => cb(page)),
  notify:         (type) => ipcRenderer.send('desktop-alert', type),
  getInstitution: () => ipcRenderer.invoke('institution:read'),
  onPerformBackup:(cb) => ipcRenderer.on('perform-backup', (_, data) => cb(data)),
  onPerformRestore:(cb) => ipcRenderer.on('perform-restore', (_, data) => cb(data)),
});

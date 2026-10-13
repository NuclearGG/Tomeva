/**
 * Electron Main Process
 * School Library Management System
 */

const { app, BrowserWindow, ipcMain, dialog, Menu, shell, safeStorage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { SqliteStore } = require('./main/sqlite-store');
const { registerDatabaseIpc } = require('./main/db-ipc');
const { createWorkstationLock } = require('./main/workstation-lock');
const { createWorkstationAccess } = require('./main/workstation-access');
const { createActivityLog } = require('./main/activity-log');
const { createNativeUpdater } = require(app.isPackaged ? './integration/native-updater.cjs' : '../desktop-integration/native-updater.cjs');
const institution = require(app.isPackaged ? './integration/institution-config.cjs' : '../desktop-integration/institution-config.cjs');

// ── ACTIVITY LOG ──
// Every issue, return, damage report, restore, fine payment, and undo
// is appended to a human-readable monthly log file on disk, independent
// of the SQLite database. This is a durable audit trail that
// survives even if the local database is ever cleared or corrupted.
const LOG_DIR = path.join(app.getPath('userData'), 'logs');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function currentLogFilePath() {
  return path.join(LOG_DIR, `transactions-${new Date().toISOString().slice(0, 7)}.audit.log`);
}

let mainWindow;
let store;
let workstationLock;
let appUpdater;
let getLibraryService;
let activityLog;
const workstationAccess = createWorkstationAccess(() => mainWindow, () => workstationLock, path.join(__dirname, 'index.html'));
const DESKTOP_ALERTS = Object.freeze({
  NEW_REQUEST: ['Library request', 'A new student request is ready for review.', 'requests'],
  ADMIN_MESSAGE: ['Library message', 'A new administrator message is available.', 'notifications'],
});
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
app.on('second-instance', (_, args) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    if (appUpdater?.accepts(args)) appUpdater.check();
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: !app.isPackaged,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#FAF7F2',
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());

  // Show when ready (no white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Build menu
  const isDev = !app.isPackaged;
  const viewSubmenu = [
    { label: 'Dashboard', accelerator: 'CmdOrCtrl+1', click: () => mainWindow.webContents.send('navigate', 'dashboard') },
    { label: 'Issue Book',  accelerator: 'CmdOrCtrl+2', click: () => mainWindow.webContents.send('navigate', 'issue') },
    { label: 'Return Book', accelerator: 'CmdOrCtrl+3', click: () => mainWindow.webContents.send('navigate', 'return') },
    { label: 'Fines',       accelerator: 'CmdOrCtrl+4', click: () => mainWindow.webContents.send('navigate', 'fines') },
  ];
  if (isDev) {
    viewSubmenu.push({ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' });
  }

  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Backup Database', accelerator: 'CmdOrCtrl+B', click: () => mainWindow.webContents.send('menu-backup') },
        { label: 'Import institution setup', click: () => institution.importConfiguration(mainWindow) },
        { label: 'Check for updates', click: () => appUpdater?.check() },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo Last Transaction', accelerator: 'CmdOrCtrl+Z', click: () => mainWindow.webContents.send('menu-undo') },
        { type: 'separator' },
        { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: viewSubmenu
    }
  ]);
  Menu.setApplicationMenu(menu);
}

ipcMain.on('desktop-alert', (event, type) => {
  if (!workstationAccess.trusted(event) || workstationLock?.isLocked() || !Object.hasOwn(DESKTOP_ALERTS, type) || !Notification.isSupported()) return;
  const [title, body, route] = DESKTOP_ALERTS[type];
  const notice = new Notification({ title, body });
  notice.on('click', () => {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('navigate', route);
  });
  notice.show();
});

if (hasInstanceLock) app.whenReady().then(() => {
  store = new SqliteStore(app.getPath('userData'));
  workstationLock = createWorkstationLock(store, safeStorage);
  activityLog = createActivityLog(LOG_DIR, safeStorage, store);
  getLibraryService = registerDatabaseIpc(ipcMain, store, event =>
    event.sender === mainWindow?.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame &&
    event.senderFrame.url.split('#')[0] === pathToFileURL(path.join(__dirname, 'index.html')).href,
  (line, event) => activityLog.append(line, event), () => workstationLock.isLocked());
  try {
    for (const event of store.database.prepare('SELECT * FROM audit_events WHERE exported = 0 ORDER BY created_at, rowid').all()) {
      activityLog.append(event.line, event);
      store.database.prepare('UPDATE audit_events SET exported = 1 WHERE id = ?').run(event.id);
    }
  } catch (error) { console.warn('[ActivityLog] Pending events retained:', error.message); }
  createWindow();
  appUpdater = createNativeUpdater({
    getUpdater: () => require('electron-updater').autoUpdater,
    getWindow: () => mainWindow, protocol: 'tomeva-librarian',
    legacyWindows: require('./build-variant.json').legacyWindows,
    beforeInstall: async () => {
      const directory = path.join(app.getPath('userData'), 'update-backups');
      fs.mkdirSync(directory, { recursive: true });
      await store.database.backup(path.join(directory, `tomeva-${Date.now()}.sqlite3`));
    },
  });
  appUpdater.start();
  if (appUpdater.accepts(process.argv)) appUpdater.check();
}).catch(error => {
  dialog.showErrorBox('Tomeva could not open its database', error.message);
  app.quit();
});
app.on('will-quit', () => { appUpdater?.stop(); store?.close(); });
app.on('open-url', (event, url) => { event.preventDefault(); if (appUpdater?.accepts([url])) appUpdater.check(); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function trustedWorkstationFrame(event) {
  return workstationAccess.trusted(event);
}
ipcMain.handle('workstation:status', event => {
  if (!trustedWorkstationFrame(event)) throw new Error('Workstation access denied.');
  return workstationLock.config();
});
ipcMain.handle('institution:read', event => {
  if (!trustedWorkstationFrame(event)) throw new Error('Untrusted window.');
  return institution.read();
});
ipcMain.handle('institution:connect', (event, url) => {
  workstationAccess.assertUnlocked(event);
  return institution.connectFromPublicUrl(url);
});
ipcMain.handle('workstation:set-pin', (event, pin, idleMinutes, currentPin) => {
  if (!trustedWorkstationFrame(event)) throw new Error('Workstation access denied.');
  return workstationLock.setPin(pin, idleMinutes, currentPin);
});
ipcMain.handle('workstation:lock', event => {
  if (!trustedWorkstationFrame(event)) throw new Error('Workstation access denied.');
  return workstationLock.lock();
});
ipcMain.handle('workstation:unlock', (event, pin) => {
  if (!trustedWorkstationFrame(event)) throw new Error('Workstation access denied.');
  return workstationLock.unlock(pin);
});

// ── IPC HANDLERS (secure, purpose-built only) ──

ipcMain.handle('backup-database', async event => {
  workstationAccess.assertUnlocked(event);
  try {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(app.getPath('downloads'), `tomeva_backup_${new Date().toISOString().slice(0,10)}.json`),
      filters: [{ name: 'JSON Backup', extensions: ['json'] }],
    });
    if (!filePath) return { ok: false, cancelled: true };
    workstationAccess.assertUnlocked(event);
    fs.writeFileSync(filePath, getLibraryService().exportData(), { encoding: 'utf8', mode: 0o600 });
    return { ok: true, filePath };
  } catch (err) {
    return { ok: false, msg: err.message };
  }
});

ipcMain.handle('restore-database', async event => {
  workstationAccess.assertUnlocked(event);
  try {
    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
      defaultPath: app.getPath('downloads'),
      filters: [{ name: 'JSON Backup', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (!filePaths?.length) return { ok: false, cancelled: true };
    workstationAccess.assertUnlocked(event);
    if (fs.statSync(filePaths[0]).size > 100 * 1024 * 1024) throw new Error('Backup exceeds 100 MiB.');
    const data = fs.readFileSync(filePaths[0], 'utf-8');
    const preview = getLibraryService().previewBackup(data);
    if (!preview.ok) return preview;
    const { response } = await dialog.showMessageBox(mainWindow, { type: 'warning', buttons: ['Cancel', 'Restore'], defaultId: 0, cancelId: 0,
      message: 'Replace the local library with this backup?', detail: Object.entries(preview.counts).map(([key, count]) => `${key}: ${count}`).join('\n') + (preview.legacy ? '\nLegacy backup: no checksum is available.' : '\nChecksum verified.') });
    if (response !== 1) return { ok: false, cancelled: true };
    workstationAccess.assertUnlocked(event);
    const recoveryDir = path.join(app.getPath('userData'), 'restore-backups');
    fs.mkdirSync(recoveryDir, { recursive: true });
    await store.database.backup(path.join(recoveryDir, `before-restore-${Date.now()}.sqlite3`));
    workstationAccess.assertUnlocked(event);
    return getLibraryService().restoreData(data, preview.legacy);
  } catch (err) {
    return { ok: false, msg: err.message };
  }
});

ipcMain.handle('export-activity-log', async (event, { maxLines } = {}) => {
  workstationAccess.assertUnlocked(event);
  try {
    ensureLogDir();
    const filePath = currentLogFilePath();
    const verifiedLines = activityLog.records(filePath).map(record => record.line);
    if (!fs.existsSync(filePath)) return { ok: false, msg: 'No log file exists' };
    const lines = verifiedLines;
    const tail = maxLines ? lines.slice(-maxLines) : lines;
    const { filePath: savePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(app.getPath('downloads'), `activity_log_${new Date().toISOString().slice(0,10)}.txt`),
      filters: [{ name: 'Text Files', extensions: ['txt'] }],
    });
    if (!savePath) return { ok: false, cancelled: true };
    workstationAccess.assertUnlocked(event);
    fs.writeFileSync(savePath, tail.join('\n'), 'utf-8');
    return { ok: true, filePath: savePath };
  } catch (err) {
    return { ok: false, msg: err.message };
  }
});

// ── ACTIVITY LOG IPC ──

ipcMain.handle('get-log-info', async event => {
  workstationAccess.assertUnlocked(event);
  ensureLogDir();
  const filePath = currentLogFilePath();
  let lineCount = 0;
  let sizeKb = 0;
  lineCount = activityLog.records(filePath).length;
  if (fs.existsSync(filePath)) {
    sizeKb = Math.round((fs.statSync(filePath).size / 1024) * 10) / 10;
  }
  return { folder: LOG_DIR, currentFile: filePath, lineCount, sizeKb };
});

ipcMain.handle('open-log-folder', async event => {
  workstationAccess.assertUnlocked(event);
  ensureLogDir();
  shell.openPath(LOG_DIR);
  return true;
});

ipcMain.handle('read-current-log', async (event, maxLines) => {
  workstationAccess.assertUnlocked(event);
  ensureLogDir();
  const filePath = currentLogFilePath();
  const lines = activityLog.records(filePath).map(record => record.line);
  const tail = maxLines ? lines.slice(-maxLines) : lines;
  return tail.join('\n');
});

// ── KIOSK CREDENTIALS (OS keychain via safeStorage) ──
// Email/password stored encrypted in the OS keychain during library provisioning.
// Never written to disk in plaintext, never in source control.

const KIOSK_CREDS_KEY = 'tomeva_kiosk_creds_';

function _getCredsKey(workstationId) {
  return KIOSK_CREDS_KEY + workstationId;
}

ipcMain.handle('get-kiosk-creds', async (event, workstationId) => {
  workstationAccess.assertUnlocked(event);
  try {
    if (!workstationId || typeof workstationId !== 'string') {
      return null;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(workstationId) || workstationId.length > 64) {
      return null;
    }

    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
      console.warn('[KioskAuth] safeStorage not available on this platform');
      return null;
    }

    const key = _getCredsKey(workstationId);
    const credsPath = path.join(app.getPath('userData'), `${key}.creds`);

    if (!fs.existsSync(credsPath)) {
      return null; // Not provisioned yet
    }

    const encryptedBase64 = fs.readFileSync(credsPath, 'utf-8');
    const encryptedBuffer = Buffer.from(encryptedBase64, 'base64');
    const decryptedBuffer = safeStorage.decryptString(encryptedBuffer);
    const decrypted = decryptedBuffer.toString('utf-8');
    
    // Parse JSON: { email, password }
    try {
      return JSON.parse(decrypted);
    } catch {
      console.error('[KioskAuth] Failed to parse credentials JSON');
      return null;
    }
  } catch (err) {
    console.error('[KioskAuth] Failed to retrieve credentials:', err.message);
    return null;
  }
});

ipcMain.handle('set-kiosk-creds', async (event, workstationId, email, password) => {
  workstationAccess.assertUnlocked(event);
  try {
    if (!workstationId || typeof workstationId !== 'string') {
      return { ok: false, msg: 'Invalid workstationId' };
    }
    if (typeof email !== 'string' || !/^kiosk-[a-f0-9]{32}@kiosk\.tomeva\.invalid$/.test(email)) {
      return { ok: false, msg: 'Invalid email' };
    }
    if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
      return { ok: false, msg: 'Invalid password' };
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(workstationId) || workstationId.length > 64) {
      return { ok: false, msg: 'Invalid workstationId format' };
    }

    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
      return { ok: false, msg: 'safeStorage not available on this platform' };
    }

    const key = _getCredsKey(workstationId);
    const credsPath = path.join(app.getPath('userData'), `${key}.creds`);

    // Encrypt and store as JSON
    const credsJson = JSON.stringify({ email, password });
    const encryptedBuffer = safeStorage.encryptString(credsJson);
    const encryptedBase64 = Buffer.from(encryptedBuffer).toString('base64');
    fs.writeFileSync(credsPath, encryptedBase64, 'utf-8');

    // Restrict file permissions (best effort)
    try { fs.chmodSync(credsPath, 0o600); } catch {}

    return { ok: true };
  } catch (err) {
    console.error('[KioskAuth] Failed to store credentials:', err.message);
    return { ok: false, msg: err.message };
  }
});

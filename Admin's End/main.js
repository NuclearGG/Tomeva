const { app, BrowserWindow, shell, Menu, ipcMain, Notification } = require('electron');
const path = require('node:path');
const { OAuthFlow } = require('./oauth-flow');
const { createNativeUpdater } = require(app.isPackaged ? './integration/native-updater.cjs' : '../desktop-integration/native-updater.cjs');
const institution = require(app.isPackaged ? './integration/institution-config.cjs' : '../desktop-integration/institution-config.cjs');

let mainWindow = null;
let appUpdater;
const oauth = new OAuthFlow({
  getLoginUrl: () => {
    const config = institution.read();
    return config ? `https://${config.firebase.projectId}.web.app/admin-sign-in/` : null;
  },
  openExternal: (url) => shell.openExternal(url),
  notify: (result) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('oauth-callback', result);
    }
  },
});

function openHttpsUrl(url) {
  try {
    if (new URL(url).protocol !== 'https:') return;
    shell.openExternal(url).catch((error) => console.error('[External link]', error));
  } catch (error) {
    console.error('[External link] Invalid URL:', error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#FAF7F2',
    title: 'Tomeva Admin — Library Dashboard',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  mainWindow.loadFile('index.html');
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openHttpsUrl(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => {
    oauth.stop();
    mainWindow = null;
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const viewMenu = [
    { role: 'reload' },
    { role: 'forceReload' },
    ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : []),
    { type: 'separator' },
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
  ];
  const template = [
    ...(isMac ? [{ label: app.name, submenu: [{ role: 'about' }, { role: 'quit' }] }] : []),
    { label: 'View', submenu: viewMenu },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
    { label: 'Updates', submenu: [{ label: 'Check for updates', click: () => appUpdater?.check() }] },
    { label: 'Setup', submenu: [{ label: 'Import institution setup', click: () => institution.importConfiguration(mainWindow) }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.on('sign-in-google', async (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  try {
    await oauth.start();
  } catch (error) {
    console.error('[OAuth] Could not start sign-in:', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('oauth-callback', {
        error: 'sign_in_start_failed',
        errorDescription: error.code === 'EADDRINUSE'
          ? 'Another sign-in is using port 51734. Close the other Tomeva instance and try again.'
          : 'Could not open the browser sign-in. Please try again.',
      });
    }
  }
});

const gotTheLock = app.requestSingleInstanceLock();
ipcMain.handle('updates:releases', event => {
  if (event.sender !== mainWindow?.webContents) throw new Error('Untrusted window.');
  return require(app.isPackaged ? './release-discovery.js' : '../Control Center/desktop-releases.js').checkDesktopReleases(app.isPackaged ? require('./public-releases.json') : undefined);
});
ipcMain.handle('institution:read', event => {
  if (event.sender !== mainWindow?.webContents) throw new Error('Untrusted window.');
  return institution.read();
});
ipcMain.on('desktop:notify', (event, type) => {
  if (event.sender !== mainWindow?.webContents || !['NEW_REQUEST', 'LIBRARIAN_MESSAGE'].includes(type) || !Notification.isSupported()) return;
  const notice = new Notification({ title: 'Tomeva Admin', body: type === 'NEW_REQUEST' ? 'A new library request is available.' : 'A new librarian message is available.' });
  notice.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show(); mainWindow.focus();
    mainWindow.webContents.send('desktop:navigate', type === 'NEW_REQUEST' ? 'requests' : 'notifications');
  });
  notice.show();
});
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_, args) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (appUpdater?.accepts(args)) appUpdater.check();
    }
  });
  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    appUpdater = createNativeUpdater({ getUpdater: () => require('electron-updater').autoUpdater, getWindow: () => mainWindow, protocol: 'tomeva-admin' });
    appUpdater.start();
    if (appUpdater.accepts(process.argv)) appUpdater.check();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  oauth.stop();
  if (process.platform !== 'darwin') app.quit();
});
app.on('will-quit', () => appUpdater?.stop());
app.on('open-url', (event, url) => { event.preventDefault(); if (appUpdater?.accepts([url])) appUpdater.check(); });

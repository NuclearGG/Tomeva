'use strict';
const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell, Menu, clipboard, dialog } = require('electron');
const { createConfigStore } = require('./config-store');
const { createUpdateManager } = require('./update-manager');
const { exportWebPackage, checkWebDeployment } = require('./web-helper');
const { exportSetupBundle, copyRules, getRules } = require('./setup-export');
const { checkDesktopReleases } = require('./desktop-releases');

let window = null;
let updater = null;
let provisioning = null;
async function distribute(action) {
  if (provisioning) throw new Error('A package download is already running. Wait or cancel it first.');
  provisioning = new AbortController();
  let lastProgress = 0;
  const progress = status => {
    if (status.state === 'downloading' && Date.now() - lastProgress < 200) return;
    lastProgress = Date.now(); send('distribution:progress', status);
  };
  progress({ state: 'checking', name: 'Checking official GitHub Releases' });
  try { return await action({ signal: provisioning.signal, progress }); }
  finally { provisioning = null; send('distribution:progress', { state: 'idle' }); }
}
const configStore = createConfigStore(app.getPath('userData'));
const recovery = require('./recovery').createRecovery({ userData: app.getPath('userData'), store: configStore, dialog, getWindow: () => window, version: app.getVersion() });

function send(channel, payload) { if (window && !window.isDestroyed()) window.webContents.send(channel, payload); }
function open(route) {
  if (!window || window.isDestroyed()) createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  if (route) window.webContents.send('navigate', route);
}
function createWindow() {
  window = new BrowserWindow({
    width: 1320, height: 850, minWidth: 1050, minHeight: 670,
    title: 'Tomeva Control Center', backgroundColor: '#F3F1EA',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      devTools: !app.isPackaged,
    },
  });
  window.loadFile(path.join(__dirname, 'ui', 'index.html'));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('closed', () => { window = null; });
}
const fromWindow = event => window && event.sender === window.webContents;
function handle(name, fn) { ipcMain.handle(name, (event, ...args) => { if (!fromWindow(event)) throw new Error('Untrusted window.'); return fn(...args); }); }
handle('config:read', () => configStore.read());
handle('config:save', value => configStore.save(value));
handle('recovery:status', () => recovery.status());
handle('recovery:run', (action, password) => recovery.run(action, password));
handle('app:version', () => app.getVersion());
handle('updates:status', () => updater?.getStatus() || { state: 'idle', version: app.getVersion() });
handle('updates:desktop-releases', () => checkDesktopReleases());
handle('updates:open-desktop', component => {
  const urls = { librarian: 'tomeva-librarian://updates', admin: 'tomeva-admin://updates' };
  if (!Object.hasOwn(urls, component)) throw new Error('Unknown Tomeva component.');
  return shell.openExternal(urls[component]);
});
handle('web:export', value => distribute(options => exportWebPackage(window, value, options)));
handle('web:check', url => checkWebDeployment(url));
handle('setup:export', (value, component, platform) => distribute(options => exportSetupBundle(window, value, component, platform, options)));
handle('setup:install', async (value, component) => {
  if (!['librarian', 'admin'].includes(component)) throw new Error('Unknown installer.');
  if (!['win32', 'linux'].includes(process.platform)) throw new Error('Local installation supports Windows and Linux. Export a package for another computer.');
  const result = await distribute(options => exportSetupBundle(window, value, component, process.platform === 'linux' ? 'linux' : 'win', options));
  if (result.cancelled) return result;
  if (!result.installerPath) throw new Error('No verified installer was downloaded.');
  if (process.platform === 'linux') {
    await new Promise((resolve, reject) => {
      const child = require('node:child_process').spawn(result.installerPath, [], { detached: true, stdio: 'ignore' });
      child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
    });
  } else { const error = await shell.openPath(result.installerPath); if (error) throw new Error(error); }
  return result;
});
handle('setup:copy-rules', value => copyRules(value, clipboard));
handle('setup:rules', value => getRules(value));
ipcMain.on('updates:check', event => { if (fromWindow(event)) updater?.check(); });
ipcMain.on('distribution:cancel', event => { if (fromWindow(event)) provisioning?.abort(); });
ipcMain.on('updates:download', event => { if (fromWindow(event)) updater?.download(); });
ipcMain.on('updates:install', event => { if (fromWindow(event)) updater?.install(); });

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => open());
  app.whenReady().then(() => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'File', submenu: [{ label: 'Open Control Center', click: () => open() }, { role: 'quit' }] },
      { label: 'View', submenu: [{ role: 'reload' }, ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : [])] },
    ]));
    createWindow();
    updater = createUpdateManager({ send: status => send('updates:status', status), open: () => open('updates'), beforeInstall: () => recovery.checkpoint() });
    updater.start();
    app.on('activate', () => open());
  });
}
app.on('before-quit', () => updater?.stop());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

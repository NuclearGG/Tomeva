const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tomevaAdmin', {
  reviewReleases: () => ipcRenderer.invoke('updates:releases'),
  getInstitution: () => ipcRenderer.invoke('institution:read'),
  notify: type => ipcRenderer.send('desktop:notify', type),
  onNavigate: callback => ipcRenderer.on('desktop:navigate', (_, page) => callback(page)),
  getIconPath: () => __dirname + '/assets/icon.png',
  onOAuthCallback: (callback) => {
    ipcRenderer.on('oauth-callback', (event, data) => callback(data));
  },
  signInWithGoogle: () => {
    ipcRenderer.send('sign-in-google');
  },
});

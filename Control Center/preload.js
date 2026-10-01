'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const listen = (channel, callback) => {
  const listener = (_, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('controlCenter', {
  getConfig: () => ipcRenderer.invoke('config:read'),
  saveConfig: value => ipcRenderer.invoke('config:save', value),
  getVersion: () => ipcRenderer.invoke('app:version'),
  exportWeb: value => ipcRenderer.invoke('web:export', value),
  checkWeb: url => ipcRenderer.invoke('web:check', url),
  exportSetup: (value, component) => ipcRenderer.invoke('setup:export', value, component),
  installPackage: (value, component) => ipcRenderer.invoke('setup:install', value, component),
  recoveryStatus: () => ipcRenderer.invoke('recovery:status'),
  recoveryRun: (action, password) => ipcRenderer.invoke('recovery:run', action, password),
  copyRules: value => ipcRenderer.invoke('setup:copy-rules', value),
  getRules: value => ipcRenderer.invoke('setup:rules', value),
  updates: {
    getStatus: () => ipcRenderer.invoke('updates:status'),
    check: () => ipcRenderer.send('updates:check'),
    download: () => ipcRenderer.send('updates:download'),
    install: () => ipcRenderer.send('updates:install'),
    desktopReleases: () => ipcRenderer.invoke('updates:desktop-releases'),
    openDesktop: component => ipcRenderer.invoke('updates:open-desktop', component),
    onStatus: callback => listen('updates:status', callback),
  },
  onNavigate: callback => listen('navigate', callback),
});

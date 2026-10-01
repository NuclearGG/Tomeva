'use strict';

const { app, Notification } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

function createUpdateManager({ send, open, beforeInstall }) {
  let updater;
  let timer;
  let startupTimer;
  let state = { state: 'idle', version: app.getVersion() };
  let busy = false;
  const emit = (name, extra = {}) => {
    state = { ...state, state: name, message: '', ...extra };
    send(state);
  };
  const notify = info => {
    if (!Notification.isSupported()) return;
    const notice = new Notification({
      title: `Tomeva Control Center ${info.version} is available`,
      body: 'Open Control Center to review and download the update.',
    });
    notice.on('click', open);
    notice.show();
  };
  function start() {
    if (!app.isPackaged) { emit('development'); return; }
    if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) { emit('unconfigured'); return; }
    try {
      updater = require('electron-updater').autoUpdater;
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.allowDowngrade = false;
      updater.allowPrerelease = false;
      updater.on('checking-for-update', () => emit('checking'));
      updater.on('update-not-available', () => emit('current'));
      updater.on('update-available', info => {
        emit('available', { availableVersion: info.version, releaseNotes: info.releaseNotes || '' });
        notify(info);
      });
      updater.on('download-progress', progress => emit('downloading', { percent: progress.percent }));
      updater.on('update-downloaded', info => emit('ready', { availableVersion: info.version }));
      updater.on('error', error => emit('error', { message: error.message }));
      startupTimer = setTimeout(() => check(), 10000);
      startupTimer.unref?.();
      timer = setInterval(() => check(), 6 * 60 * 60 * 1000);
      timer.unref?.();
    } catch (error) {
      emit('error', { message: error.message });
    }
  }
  async function check() {
    if (busy || ['ready', 'downloading'].includes(state.state)) return;
    if (!updater) return emit(app.isPackaged ? 'unconfigured' : 'development');
    busy = true;
    try { await updater.checkForUpdates(); }
    catch (error) { emit('error', { message: error.message }); }
    finally { busy = false; }
  }
  async function download() {
    if (!updater || state.state !== 'available' || busy) return;
    busy = true;
    emit('downloading', { percent: 0 });
    try { await updater.downloadUpdate(); }
    catch (error) { emit('error', { message: error.message }); }
    finally { busy = false; }
  }
  async function install() {
    if (!updater || state.state !== 'ready' || busy) return;
    busy = true;
    try { await beforeInstall(); updater.quitAndInstall(false, true); }
    catch (error) { emit('ready', { message: 'Update postponed: checkpoint failed. ' + error.message }); }
    finally { busy = false; }
  }
  function stop() { clearInterval(timer); clearTimeout(startupTimer); }
  return { start, check, download, install, stop, getStatus: () => state };
}

module.exports = { createUpdateManager };

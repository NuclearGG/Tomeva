'use strict';

const { app, Notification } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const legacyWindows = require('./build-variant.json').legacyWindows;
const verification = require(app.isPackaged ? './integration/release-verification.cjs' : '../desktop-integration/release-verification.cjs');

function createUpdateManager({ send, open, beforeInstall }) {
  let updater;
  let timer;
  let startupTimer;
  const trust = verification.trustPolicy();
  let state = { state: 'idle', version: app.getVersion(), updatePolicy: 'operator-managed-stable', ...trust };
  let busy = false;
  let signedManifest;
  let verifiedFiles = [];
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
      if (legacyWindows) {
        updater.setFeedURL({ provider: 'generic', url: 'https://github.com/NuclearGG/Tomeva/releases/latest/download/', channel: 'latest-legacy' });
        updater.channel = 'latest-legacy';
      }
      updater.on('checking-for-update', () => emit('checking'));
      updater.on('update-not-available', () => emit('current'));
      updater.on('update-available', info => {
        emit('available', { availableVersion: info.version, releaseNotes: info.releaseNotes || '' });
        notify(info);
      });
      updater.on('download-progress', progress => emit('downloading', { percent: progress.percent }));
      updater.on('update-downloaded', info => emit('verifying', { availableVersion: info.version }));
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
    try {
      signedManifest = await verification.loadManifest('v' + state.availableVersion);
      const files = await updater.downloadUpdate();
      const platform = process.platform === 'win32' ? (legacyWindows ? 'win7' : 'win') : process.platform === 'linux' ? 'linux' : 'mac';
      const name = `tomeva-control-center-${state.availableVersion}-${platform}-${process.arch}.${process.platform === 'win32' ? 'exe' : process.platform === 'linux' ? 'AppImage' : 'zip'}`;
      verifiedFiles = [];
      for (const file of files) { await verification.verifyFile(file, name, signedManifest); verifiedFiles.push({ path: file, name }); }
      if (!verifiedFiles.length) throw new Error('No checksum-verified installer was downloaded.');
      emit('ready', { message: trust.publisherAuthenticated ? 'Publisher signature and installer checksum verified. Restart when ready.' : 'Unsigned pilot: installer checksum verified against GitHub. Publisher authenticity is not configured. Restart when ready.' });
    }
    catch (error) { emit('error', { message: error.message }); }
    finally { busy = false; }
  }
  async function install() {
    if (!updater || state.state !== 'ready' || busy) return;
    busy = true;
    try {
      if (!signedManifest || !verifiedFiles.length) throw new Error('No checksum-verified installer is ready.');
      for (const file of verifiedFiles) await verification.verifyFile(file.path, file.name, signedManifest);
      try { await beforeInstall(); }
      catch (error) { emit('ready', { message: 'Update postponed: checkpoint failed. ' + error.message }); return; }
      updater.quitAndInstall(false, true);
    }
    catch (error) { verifiedFiles = []; signedManifest = null; emit('error', { message: 'Update verification failed: ' + error.message }); }
    finally { busy = false; }
  }
  function stop() { clearInterval(timer); clearTimeout(startupTimer); }
  return { start, check, download, install, stop, getStatus: () => state };
}

module.exports = { createUpdateManager };

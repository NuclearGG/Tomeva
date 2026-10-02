'use strict';
const { app, dialog, Notification } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { checkApproval, approvedVersion } = require('./update-policy.cjs');
const institution = require('./institution-config.cjs');

// Every desktop app installs its own signed binary. Control Center opens this
// flow through a fixed application protocol; no institution data is transmitted.
function createNativeUpdater({ getUpdater, getWindow, beforeInstall = async () => {}, protocol }) {
  let updater;
  let interval;
  let startup;
  let busy = false;
  let interactive = false;
  let ready = false;
  let releaseVersion = null;
  const component = protocol === 'tomeva-admin' ? 'admin' : 'librarian';
  const approved = () => checkApproval(institution.read(), component, releaseVersion);
  const show = async options => {
    const window = getWindow();
    return window && !window.isDestroyed() ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
  };
  async function check(manual = true) {
    if (busy) return;
    if (!app.isPackaged || !fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) {
      if (manual) await show({ type: 'info', message: 'No public update channel is configured for this build.', buttons: ['OK'] });
      return;
    }
    interactive = manual;
    busy = true;
    try {
      const version = await approvedVersion(institution.read(), component);
      if (ready && releaseVersion === version) return await install();
      ready = false;
      // Pin to the approved tag, even when GitHub's latest release is newer.
      updater.setFeedURL({ provider: 'generic', url: `https://github.com/NuclearGG/Tomeva/releases/download/v${version}/`, channel: component });
      updater.channel = component;
      updater.allowDowngrade = false;
      await updater.checkForUpdates();
    }
    catch (error) { if (manual) await show({ type: 'error', message: 'Could not check for updates.', detail: error.message }); }
    finally { busy = false; }
  }
  async function install() {
    if (!ready) return;
    const answer = await show({ type: 'question', message: 'Install the downloaded update and restart?', detail: 'Finish the current desk operation before restarting.', buttons: ['Later', 'Install and restart'], defaultId: 0, cancelId: 0 });
    if (answer.response !== 1) return;
    try {
      await approved();
      await beforeInstall();
      updater.quitAndInstall(false, true);
    } catch (error) { await show({ type: 'error', message: 'Update postponed: approval or recovery checks failed.', detail: error.message }); }
  }
  function start() {
    updater = getUpdater();
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.on('error', error => console.warn('[Updater]', error.message));
    updater.on('update-not-available', () => { if (interactive) show({ message: `${app.name} is up to date.`, buttons: ['OK'] }); });
    updater.on('update-available', async info => {
      releaseVersion = info.version;
      if (!interactive) {
        if (Notification.isSupported()) {
          const notification = new Notification({ title: `${app.name} ${info.version} is available`, body: 'Open the application update menu to review this release.' });
          notification.on('click', () => check(true)); notification.show();
        }
        return;
      }
      const notes = Array.isArray(info.releaseNotes) ? info.releaseNotes.map(note => note.note || '').join('\n') : String(info.releaseNotes || '');
      const answer = await show({ type: 'info', message: `${app.name} ${info.version} is available`, detail: notes.slice(0, 5000), buttons: ['Later', 'Download'], defaultId: 0, cancelId: 0 });
      if (answer.response === 1) {
        try { await approved(); await updater.downloadUpdate(); }
        catch (error) { await show({ type: 'error', message: 'Download failed.', detail: error.message }); }
      }
    });
    updater.on('download-progress', progress => getWindow()?.setProgressBar(Math.max(0, Math.min(1, progress.percent / 100))));
    updater.on('update-downloaded', info => { releaseVersion = info.version; ready = true; getWindow()?.setProgressBar(-1); install(); });
    if (app.isPackaged) app.setAsDefaultProtocolClient(protocol);
    startup = setTimeout(() => check(false), 15000); startup.unref?.();
    interval = setInterval(() => check(false), 6 * 60 * 60 * 1000); interval.unref?.();
  }
  function accepts(args) { return args.some(arg => arg === `${protocol}://updates` || arg === `${protocol}://updates/`); }
  function stop() { clearTimeout(startup); clearInterval(interval); }
  return { start, check, accepts, stop };
}
module.exports = { createNativeUpdater };

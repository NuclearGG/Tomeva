'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { app, dialog } = require('electron');
const { downloadPublicSetup } = require('./public-setup.cjs');
const filename = () => path.join(app.getPath('userData'), 'institution.json');
function validate(data) {
  const staffDomain = typeof data?.staffDomain === 'string' ? data.staffDomain.trim().toLowerCase() : '';
  if (!data?.firebase || data.libraryId !== 'main' || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(staffDomain) || staffDomain === 'staff.example') throw new Error('Invalid institution provisioning file.');
  for (const key of ['apiKey', 'projectId', 'authDomain', 'appId', 'messagingSenderId']) {
    if (typeof data.firebase[key] !== 'string' || !data.firebase[key] || data.firebase[key].length > 500) throw new Error(`Invalid Firebase ${key}.`);
  }
  if (!/^[a-z0-9-]{4,80}$/.test(data.firebase.projectId)) throw new Error('Invalid project ID.');
  const firebase = Object.fromEntries(['apiKey', 'projectId', 'authDomain', 'appId', 'messagingSenderId', 'storageBucket', 'measurementId', 'databaseURL'].filter(key => typeof data.firebase[key] === 'string').map(key => [key, data.firebase[key]]));
  const webUrl = typeof data.webUrl === 'string' ? data.webUrl : '';
  if (webUrl) { const url = new URL(webUrl); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid institution web URL.'); }
  const institutionName = typeof data.institutionName === 'string' ? data.institutionName.trim() : '';
  if (institutionName.length > 200) throw new Error('Invalid institution name.');
  return { institutionName, firebase, libraryId: 'main', staffDomain, webUrl };
}
function read() {
  if (!fs.existsSync(filename())) {
    const supplied = path.join(app.isPackaged ? path.dirname(process.platform === 'linux' && process.env.APPIMAGE ? process.env.APPIMAGE : app.getPath('exe')) : app.getAppPath(), 'institution.json');
    if (!fs.existsSync(supplied)) return null;
    if (fs.statSync(supplied).size > 32768) throw new Error('Institution configuration is too large.');
    const config = validate(JSON.parse(fs.readFileSync(supplied, 'utf8')));
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(filename(), JSON.stringify(config, null, 2), { flag: 'wx' });
    return config;
  }
  return validate(JSON.parse(fs.readFileSync(filename(), 'utf8')));
}
function save(config) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  if (fs.existsSync(filename())) fs.copyFileSync(filename(), filename() + `.${Date.now()}.backup`);
  const temporary = filename() + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, filename());
}
async function connectFromPublicUrl(rawUrl, options = {}) {
  const result = await downloadPublicSetup(rawUrl, { ...options, validate });
  save(result.config);
  return { ...result.config, setupUrl: result.url };
}
async function importConfiguration(window) {
  const selected = await dialog.showOpenDialog(window, { title: 'Import institution.json from Control Center', filters: [{ name: 'Institution configuration', extensions: ['json'] }], properties: ['openFile'] });
  if (selected.canceled) return;
  try {
    if (fs.statSync(selected.filePaths[0]).size > 32768) throw new Error('Configuration file is too large.');
    const config = validate(JSON.parse(fs.readFileSync(selected.filePaths[0], 'utf8')));
    const answer = await dialog.showMessageBox(window, { type: 'question', message: `Use Firebase project ${config.firebase.projectId}?`, detail: 'The application will reload. Finish any current desk operation first. Local records and kiosk credentials are preserved.', buttons: ['Cancel', 'Import and reload'], defaultId: 0, cancelId: 0 });
    if (answer.response !== 1) return;
    save(config);
    window.reload();
  } catch (error) { await dialog.showMessageBox(window, { type: 'error', message: 'Configuration could not be imported.', detail: error.message }); }
}
module.exports = { read, importConfiguration, connectFromPublicUrl, validate };

'use strict';
const fs = require('node:fs');
const path = require('node:path');

function validateConfig(input) {
  const text = (value, max = 500) => typeof value === 'string' && value.trim().length <= max ? value.trim() : '';
  const institutionName = text(input?.institutionName, 200);
  // Older setup files and recovery kits did not contain a name.
  if (input?.institutionName !== undefined && (typeof input.institutionName !== 'string' || input.institutionName.trim().length > 200)) throw new Error('Enter the institution name (up to 200 characters).');
  const firebase = {};
  for (const field of ['apiKey', 'authDomain', 'projectId', 'appId', 'messagingSenderId']) {
    firebase[field] = text(input?.firebase?.[field]);
    if (!firebase[field]) throw new Error(`Enter ${field}.`);
  }
  for (const field of ['storageBucket', 'databaseURL', 'measurementId']) {
    if (input?.firebase?.[field]) firebase[field] = text(input.firebase[field]);
  }
  if (Object.keys(input?.firebase || {}).some(key => /private|secret|credential|service_account/i.test(key))) {
    throw new Error('Paste the public Firebase web config, without private credentials.');
  }
  if (!/^[a-z0-9-]{4,80}$/.test(firebase.projectId)) throw new Error('Invalid project ID.');
  if (!/^[a-z0-9.-]+$/i.test(firebase.authDomain)) throw new Error('Invalid Auth domain.');
  const staffDomain = text(input.staffDomain, 253).toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(staffDomain)) throw new Error('Enter the institution staff email domain.');
  if (staffDomain === 'staff.example') throw new Error('Replace staff.example with the institution staff email domain.');
  const webUrl = text(input.webUrl, 1000);
  if (webUrl) {
    const parsed = new URL(webUrl);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Web URL must use HTTPS.');
  }
  return { ...(institutionName ? { institutionName } : {}), firebase, staffDomain, webUrl, libraryId: 'main' };
}

function createConfigStore(userData) {
  const filename = path.join(userData, 'institution.json');
  return {
    read() {
      try {
        const raw = JSON.parse(fs.readFileSync(filename, 'utf8'));
        if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) throw new Error('Unsupported configuration schema. Install a compatible Control Center.');
        const config = validateConfig(raw);
        if (!raw.schemaVersion) this.save(config); // Backup first; migrate only after validation.
        return config;
      }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    save(value) {
      const config = validateConfig(value);
      fs.mkdirSync(userData, { recursive: true });
      const temporary = filename + '.tmp';
      if (fs.existsSync(filename)) fs.copyFileSync(filename, path.join(userData, `institution-${Date.now()}.backup.json`));
      fs.writeFileSync(temporary, JSON.stringify({ ...config, schemaVersion: 1 }, null, 2), { mode: 0o600 });
      fs.renameSync(temporary, filename);
      return config;
    },
  };
}
module.exports = { validateConfig, createConfigStore };

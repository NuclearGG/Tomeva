'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const { validateConfig } = require('./config-store');
const scrypt = promisify(crypto.scrypt);
const params = { N: 131072, r: 8, p: 1 };
const fingerprint = config => crypto.createHash('sha256').update(JSON.stringify(validateConfig(config))).digest('hex');
function passwordCheck(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('Use a recovery password of 12–1024 characters.');
}
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
function parseKit(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536) throw new Error('Recovery file is too large.');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('This is not a readable Tomeva Recovery Kit. Select the original .tomeva file.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid recovery metadata.');
  const { ciphertext, tag, ...header } = value;
  if (header.format !== 'tomeva-recovery' || header.version !== 1 || header.kdf !== 'scrypt' || header.cipher !== 'aes-256-gcm' || header.N !== params.N || header.r !== params.r || header.p !== params.p) throw new Error('Unsupported recovery format or KDF parameters.');
  for (const [encoded, length] of [[header.salt, 16], [header.iv, 12], [tag, 16], [ciphertext, null]]) {
    if (typeof encoded !== 'string' || !encoded.length || Buffer.from(encoded, 'base64').toString('base64') !== encoded || (length && Buffer.from(encoded, 'base64').length !== length)) throw new Error('Invalid recovery metadata.');
  }
  return { ciphertext, tag, header };
}
// Keep the previous destination intact if writing fails, including a full disk.
async function atomicWrite(filename, text) {
  const temporary = filename + '.' + crypto.randomUUID() + '.tmp';
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(text);
    await handle.sync();
    await handle.close(); handle = null;
    await fs.rename(temporary, filename);
  } finally {
    if (handle) await handle.close();
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
async function encrypt(config, password) {
  passwordCheck(password);
  if (!password.trim()) throw new Error('Use a recovery password containing more than spaces.');
  const header = { format: 'tomeva-recovery', version: 1, kdf: 'scrypt', ...params, salt: crypto.randomBytes(16).toString('base64'), cipher: 'aes-256-gcm', iv: crypto.randomBytes(12).toString('base64') };
  const key = await scrypt(password, Buffer.from(header.salt, 'base64'), 32, { ...params, maxmem: 256 * 1024 * 1024 });
  try {
    const cipher = crypto.createCipheriv(header.cipher, key, Buffer.from(header.iv, 'base64'));
    cipher.setAAD(Buffer.from(JSON.stringify(header)));
    const payload = { schemaVersion: 1, createdAt: new Date().toISOString(), config: validateConfig(config) };
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    return { ...header, ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
  } finally { key.fill(0); }
}
async function decrypt(text, password) {
  passwordCheck(password);
  const { ciphertext, tag, header } = parseKit(text);
  const key = await scrypt(password, Buffer.from(header.salt, 'base64'), 32, { ...params, maxmem: 256 * 1024 * 1024 });
  try {
    const decipher = crypto.createDecipheriv(header.cipher, key, Buffer.from(header.iv, 'base64'));
    decipher.setAAD(Buffer.from(JSON.stringify(header)));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]);
    try {
      const payload = JSON.parse(plaintext.toString('utf8'));
      if (payload.schemaVersion !== 1 || !Number.isFinite(Date.parse(payload.createdAt))) throw new Error('Unsupported recovery schema.');
      return { ...payload, config: validateConfig(payload.config) };
    } finally { plaintext.fill(0); }
  } catch { throw new Error('Recovery verification failed. Check the password and file integrity.'); }
  finally { key.fill(0); }
}
function createRecovery({ userData, store, dialog, getWindow, version }) {
  const cached = path.join(userData, 'recovery.tomeva');
  const metaFile = path.join(userData, 'recovery-metadata.json');
  let busy = false;
  async function status() {
    let config;
    try { config = store.read(); }
    catch { return { exists: false, stale: true, issue: 'Local settings are damaged or unsupported. Restore a Recovery Kit or enter the existing Firebase settings.' }; }
    let text;
    try {
      if ((await fs.stat(cached)).size > 65536) throw new Error('Oversized cache');
      text = await fs.readFile(cached, 'utf8');
    } catch (error) {
      return { exists: false, stale: true, issue: error.code === 'ENOENT' ? 'No local kit is available. Create a kit or restore an external copy.' : 'The local kit cannot be read. Create a new kit or restore an external copy.' };
    }
    try {
      parseKit(text);
      const meta = JSON.parse(await fs.readFile(metaFile, 'utf8'));
      if (!meta || meta.schemaVersion !== 1 || meta.formatVersion !== 1 || !Number.isFinite(Date.parse(meta.createdAt)) || !/^[a-f0-9]{64}$/.test(meta.fingerprint) || (meta.digest && meta.digest !== digest(text))) throw new Error('Damaged metadata');
      const stale = !config || meta.fingerprint !== fingerprint(config);
      return { createdAt: meta.createdAt, formatVersion: 1, exists: true, stale, ...(stale ? { issue: 'Settings have changed. Create an updated kit before exporting a copy.' } : {}) };
    } catch {
      return { exists: true, stale: true, issue: 'The cached kit or its metadata is damaged or missing. Create a new kit or restore an external copy.' };
    }
  }
  async function exportPath(filename) {
    if (typeof filename !== 'string' || !filename) throw new Error('Choose a recovery file destination.');
    const root = await fs.realpath(userData);
    // Resolve the nearest existing parent too, so directory links cannot bypass the guard.
    let parent = path.dirname(path.resolve(filename));
    while (true) {
      try { parent = await fs.realpath(parent); break; }
      catch (error) { if (error.code !== 'ENOENT' || path.dirname(parent) === parent) throw error; parent = path.dirname(parent); }
    }
    const relative = path.relative(root, parent);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Save your kit outside the Control Center profile folder to protect local settings and checkpoints.');
    if (path.extname(filename).toLowerCase() !== '.tomeva') throw new Error('Save the Recovery Kit with a .tomeva extension.');
    try { if ((await fs.lstat(filename)).isSymbolicLink()) throw new Error('Choose a regular file destination, not a link.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async function checkpoint() {
    const directory = path.join(userData, 'checkpoints', `${Date.now()}-${crypto.randomUUID()}`);
    await fs.mkdir(directory, { recursive: true });
    for (const filename of ['institution.json', 'recovery.tomeva', 'recovery-metadata.json']) {
      try { await fs.copyFile(path.join(userData, filename), path.join(directory, filename)); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    await fs.writeFile(path.join(directory, 'checkpoint.json'), JSON.stringify({ version, schemaVersion: 1, createdAt: new Date().toISOString() }));
    return directory;
  }
  async function run(action, password) {
    if (busy) throw new Error('A recovery operation is already running.');
    busy = true;
    try {
      if (action === 'create' || action === 'copy') {
        const config = store.read();
        if (!config) throw new Error('Save your project settings first.');
        if (action === 'create') {
          passwordCheck(password);
          if (!password.trim()) throw new Error('Use a recovery password containing more than spaces.');
        } else {
          const current = await status();
          if (!current.exists || current.stale) throw new Error(current.issue + ' Create a new kit before exporting.');
        }
        const selection = await dialog.showSaveDialog(getWindow(), { defaultPath: `${config.firebase.projectId}-Recovery.tomeva`, filters: [{ name: 'Tomeva Recovery Kit', extensions: ['tomeva'] }] });
        if (selection.canceled) return { cancelled: true };
        await exportPath(selection.filePath);
        const text = action === 'copy' ? await fs.readFile(cached, 'utf8') : JSON.stringify(await encrypt(config, password));
        await atomicWrite(selection.filePath, text);
        if (action === 'create') {
          try {
            await atomicWrite(cached, text);
            await atomicWrite(metaFile, JSON.stringify({ createdAt: new Date().toISOString(), formatVersion: 1, schemaVersion: 1, fingerprint: fingerprint(config), digest: digest(text) }));
          } catch { return { path: selection.filePath, warning: 'The exported kit was saved, but the local recovery cache could not be updated. Keep the exported file and verify it before relying on it.' }; }
        }
        return { path: selection.filePath };
      }
      if (!['verify', 'restore'].includes(action)) throw new Error('Unknown recovery action.');
      const selection = await dialog.showOpenDialog(getWindow(), { properties: ['openFile'], filters: [{ name: 'Tomeva Recovery Kit', extensions: ['tomeva'] }] });
      if (selection.canceled) return { cancelled: true };
      if (!selection.filePaths?.[0]) throw new Error('Select a Tomeva Recovery Kit.');
      if ((await fs.stat(selection.filePaths[0])).size > 65536) throw new Error('Recovery file is too large.');
      const payload = await decrypt(await fs.readFile(selection.filePaths[0], 'utf8'), password);
      if (action === 'restore') {
        const answer = await dialog.showMessageBox(getWindow(), { type: 'question', message: `Restore settings for ${payload.config.firebase.projectId}?`, detail: 'Current local settings will be checkpointed. This restores bootstrap settings; it does not grant Firebase account access or replace cloud data.', buttons: ['Cancel', 'Restore'], defaultId: 0, cancelId: 0 });
        if (answer.response !== 1) return { cancelled: true };
        await checkpoint();
        store.save(payload.config);
      }
      return { valid: true, projectId: payload.config.firebase.projectId, createdAt: payload.createdAt, formatVersion: 1 };
    } finally { busy = false; }
  }
  return { status, checkpoint, run };
}
module.exports = { encrypt, decrypt, fingerprint, createRecovery };

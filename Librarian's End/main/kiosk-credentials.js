'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
function createCredentialStore({ userData, getProject, protection }) {
  const valid = value => value && typeof value.email === 'string' && /^kiosk-[a-f0-9]{32}@kiosk\.tomeva\.invalid$/.test(value.email)
    && typeof value.password === 'string' && value.password.length >= 12 && value.password.length <= 256 && !!value.password.trim();
  function scope(workstationId) {
    if (workstationId !== 'ws-main') throw new Error('Unknown workstation.');
    const projectId = getProject();
    if (typeof projectId !== 'string' || !/^[a-z0-9-]{4,80}$/.test(projectId)) throw new Error('Configure the institution before activating a kiosk.');
    if (!protection.isEncryptionAvailable() || protection.getSelectedStorageBackend?.() === 'basic_text') throw new Error('A secure OS credential store is required.');
    const hash = createHash('sha256').update(projectId).digest('hex').slice(0, 24);
    return { projectId, filename: path.join(userData, `tomeva-kiosk-${hash}-${workstationId}.creds`) };
  }
  function get(workstationId) {
    try {
      const { projectId, filename } = scope(workstationId);
      if (fs.statSync(filename).size > 16384) return null;
      const value = JSON.parse(protection.decryptString(Buffer.from(fs.readFileSync(filename, 'utf8'), 'base64')));
      if (value.schemaVersion !== 1 || value.projectId !== projectId || value.workstationId !== workstationId || !valid(value)) return null;
      return { email: value.email, password: value.password };
    } catch { return null; }
  }
  function set(workstationId, email, password) {
    let temporary;
    try {
      if (!valid({ email, password })) throw new Error('Enter a valid kiosk email and issued password.');
      const { projectId, filename } = scope(workstationId);
      const value = { schemaVersion: 1, projectId, workstationId, email, password };
      fs.mkdirSync(userData, { recursive: true });
      temporary = filename + '.' + randomUUID() + '.tmp';
      const descriptor = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(descriptor, protection.encryptString(JSON.stringify(value)).toString('base64')); fs.fsyncSync(descriptor); }
      finally { fs.closeSync(descriptor); }
      fs.renameSync(temporary, filename);
      return { ok: true };
    } catch (error) { return { ok: false, msg: error.message }; }
    finally { if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  return { get, set };
}
module.exports = { createCredentialStore };

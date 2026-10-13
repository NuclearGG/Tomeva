'use strict';
const { pbkdf2Sync, randomBytes, timingSafeEqual } = require('node:crypto');
const ITERATIONS = 210000;
const VALID_IDLE = new Set([5, 10, 15]);
function createWorkstationLock(store, protection) {
  const settings = store.collections.settings;
  const read = () => settings.findOne({}) || {};
  let locked = !!(read().workstation_pin_verifier || read().workstation_pin_hash);
  let busy = false;
  const secure = () => !!protection?.isEncryptionAvailable() && protection.getSelectedStorageBackend?.() !== 'basic_text';
  const update = values => store.transaction(() => {
    const row = settings.findOne({});
    if (row) { Object.assign(row, values); settings.update(row); }
    else settings.insert({ fine_per_day: 2, loan_days: 14, ...values });
  });
  if (read().workstation_pin_hash && secure()) {
    update({ workstation_pin_verifier: protection.encryptString(read().workstation_pin_hash).toString('base64'), workstation_pin_hash: null, workstation_legacy_pin: true });
  }
  function config() {
    const row = read();
    return { configured: !!(row.workstation_pin_verifier || row.workstation_pin_hash), locked,
      legacyPin: !!(row.workstation_pin_hash || row.workstation_legacy_pin), idleMinutes: VALID_IDLE.has(row.workstation_idle_minutes) ? row.workstation_idle_minutes : 10 };
  }
  function verify(pin) {
    if (typeof pin !== 'string' || !/^\d{4,12}$/.test(pin)) return false;
    const row = read();
    if (!row.workstation_pin_salt) return false;
    let hash = row.workstation_pin_hash;
    if (row.workstation_pin_verifier) {
      if (!secure()) return false;
      hash = protection.decryptString(Buffer.from(row.workstation_pin_verifier, 'base64'));
    }
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) return false;
    const actual = pbkdf2Sync(pin, Buffer.from(row.workstation_pin_salt, 'hex'), ITERATIONS, 32, 'sha256');
    return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
  }
  function failedAttempt() {
    const failures = Number(read().workstation_pin_failures || 0) + 1;
    update({ workstation_pin_failures: failures, workstation_pin_retry_after: failures >= 5 ? Date.now() + Math.min(300000, 30000 * (failures - 4)) : 0 });
    return { ok: false, msg: 'Incorrect PIN.' };
  }
  const allowedAttempt = () => Date.now() >= Number(read().workstation_pin_retry_after || 0);
  async function setPin(pin, idleMinutes, currentPin) {
    if (busy) return { ok: false, msg: 'A PIN operation is already running.' };
    if (locked) return { ok: false, msg: 'Unlock the workstation first.' };
    if (typeof pin !== 'string' || !/^\d{6,12}$/.test(pin)) return { ok: false, msg: 'Enter 6 to 12 digits.' };
    if (!VALID_IDLE.has(idleMinutes)) return { ok: false, msg: 'Choose 5, 10, or 15 minutes.' };
    if (!secure()) return { ok: false, msg: 'A secure OS credential store is required to configure a PIN.' };
    if (!allowedAttempt()) return { ok: false, msg: 'Too many attempts. Try again shortly.' };
    busy = true;
    try {
      if (config().configured && !verify(currentPin)) return failedAttempt();
      const salt = randomBytes(16);
      const hash = pbkdf2Sync(pin, salt, ITERATIONS, 32, 'sha256').toString('hex');
      update({ workstation_pin_salt: salt.toString('hex'), workstation_pin_verifier: protection.encryptString(hash).toString('base64'),
        workstation_pin_hash: null, workstation_legacy_pin: false, workstation_pin_iterations: ITERATIONS, workstation_idle_minutes: idleMinutes,
        workstation_pin_failures: 0, workstation_pin_retry_after: 0 });
      return { ok: true, ...config() };
    } finally { busy = false; }
  }
  function lock() {
    if (!config().configured) return { ok: false, msg: 'Set a workstation PIN in Settings first.' };
    locked = true;
    return { ok: true, ...config() };
  }
  async function unlock(pin) {
    if (!locked) return { ok: true, ...config() };
    if (busy || !allowedAttempt()) return { ok: false, msg: 'Too many attempts. Try again shortly.' };
    busy = true;
    try {
      if (!verify(pin)) return failedAttempt();
      const row = read();
      const migrated = row.workstation_pin_hash && secure()
        ? { workstation_pin_verifier: protection.encryptString(row.workstation_pin_hash).toString('base64'), workstation_pin_hash: null } : {};
      update({ ...migrated, workstation_pin_failures: 0, workstation_pin_retry_after: 0 });
      locked = false;
      return { ok: true, ...config() };
    } finally { busy = false; }
  }
  return { config, setPin, lock, unlock, isLocked: () => locked };
}
module.exports = { createWorkstationLock };

'use strict';

const { webcrypto, timingSafeEqual } = require('node:crypto');
const ITERATIONS = 210000;
const VALID_IDLE = new Set([5, 10, 15]);

function createWorkstationLock(store) {
  const settings = store.collections.settings;
  let locked = !!settings.findOne({})?.workstation_pin_hash;
  let failures = 0;
  let retryAfter = 0;

  function config() {
    const row = settings.findOne({}) || {};
    return { configured: !!row.workstation_pin_hash, locked,
      idleMinutes: VALID_IDLE.has(row.workstation_idle_minutes) ? row.workstation_idle_minutes : 10 };
  }

  async function derive(pin, salt, iterations = ITERATIONS) {
    const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
    return Buffer.from(bits);
  }

  async function verify(pin) {
    if (!/^\d{4}$/.test(pin)) return false;
    const row = settings.findOne({}) || {};
    if (!row.workstation_pin_hash || !row.workstation_pin_salt) return false;
    const actual = await derive(pin, Buffer.from(row.workstation_pin_salt, 'hex'), row.workstation_pin_iterations || ITERATIONS);
    const expected = Buffer.from(row.workstation_pin_hash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  async function setPin(pin, idleMinutes, currentPin) {
    if (locked) return { ok: false, msg: 'Unlock the workstation first.' };
    if (!/^\d{4}$/.test(pin)) return { ok: false, msg: 'Enter exactly four digits.' };
    if (!VALID_IDLE.has(idleMinutes)) return { ok: false, msg: 'Choose 5, 10, or 15 minutes.' };
    if (config().configured && !(await verify(currentPin))) return { ok: false, msg: 'Current PIN is incorrect.' };
    const salt = webcrypto.getRandomValues(new Uint8Array(16));
    const hash = await derive(pin, salt);
    store.transaction(() => {
      const row = settings.findOne({});
      const update = { workstation_pin_salt: Buffer.from(salt).toString('hex'),
        workstation_pin_hash: hash.toString('hex'), workstation_pin_iterations: ITERATIONS,
        workstation_idle_minutes: idleMinutes };
      if (row) { Object.assign(row, update); settings.update(row); }
      else settings.insert({ fine_per_day: 2, loan_days: 14, ...update });
    });
    failures = 0;
    return { ok: true, ...config() };
  }

  function lock() {
    if (!config().configured) return { ok: false, msg: 'Set a workstation PIN in Settings first.' };
    locked = true;
    return { ok: true, ...config() };
  }

  async function unlock(pin) {
    if (!locked) return { ok: true, ...config() };
    if (Date.now() < retryAfter) return { ok: false, msg: 'Too many attempts. Try again shortly.' };
    if (!(await verify(pin))) {
      failures++;
      if (failures >= 5) { failures = 0; retryAfter = Date.now() + 30000; }
      return { ok: false, msg: 'Incorrect PIN.' };
    }
    failures = 0;
    retryAfter = 0;
    locked = false;
    return { ok: true, ...config() };
  }

  return { config, setPin, lock, unlock, isLocked: () => locked };
}

module.exports = { createWorkstationLock };

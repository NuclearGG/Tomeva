'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
function createActivityLog(directory, protection, store) {
  fs.mkdirSync(directory, { recursive: true });
  let key;
  let windowStarted = Date.now(), writesInWindow = 0;
  const sign = record => createHmac('sha256', key).update(JSON.stringify(record)).digest('hex');
  function ensureKey() {
    if (key) return;
    if (!protection?.isEncryptionAvailable() || protection.getSelectedStorageBackend?.() === 'basic_text') throw new Error('Secure OS storage is unavailable for activity-log signing.');
    const file = path.join(directory, 'activity-key.enc');
    if (fs.existsSync(file)) key = Buffer.from(protection.decryptString(fs.readFileSync(file)), 'hex');
    else {
      key = randomBytes(32);
      fs.writeFileSync(file, protection.encryptString(key.toString('hex')), { flag: 'wx', mode: 0o600 });
    }
    if (key.length !== 32) throw new Error('Invalid activity-log key.');
  }
  function fileFor(date = new Date().toISOString()) {
    return path.join(directory, 'transactions-' + date.slice(0, 7) + '.audit.log');
  }
  function records(file) {
    ensureKey();
    const month = /^transactions-(\d{4}-\d{2})\.audit\.log$/.exec(path.basename(file))?.[1];
    const expected = store && month ? store.database.prepare('SELECT id FROM audit_events WHERE exported = 1 AND substr(created_at, 1, 7) = ?').all(month) : [];
    if (!fs.existsSync(file)) {
      if (expected.length) throw new Error('Activity log integrity check failed: signed records are missing.');
      return [];
    }
    let previous = '0'.repeat(64);
    const ids = new Set();
    const result = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => {
      const { mac, ...record } = JSON.parse(line);
      const actual = sign(record);
      if (!/^[a-f0-9]{64}$/.test(mac || '') || record.previous !== previous || ids.has(record.id)
        || !timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(actual, 'hex'))) throw new Error('Activity log integrity check failed.');
      ids.add(record.id); previous = mac;
      return { ...record, mac };
    });
    if (expected.some(event => !ids.has(event.id))) throw new Error('Activity log integrity check failed: signed records are missing.');
    return result;
  }
  function append(line, event) {
    ensureKey();
    if (!event?.id || typeof line !== 'string' || line.length > 4096 || /[\r\n\u0000]/.test(line)) throw new Error('Invalid internal activity event.');
    const file = fileFor(event.created_at);
    const existing = records(file);
    if (existing.some(record => record.id === event.id)) return;
    if (Date.now() - windowStarted >= 60000) { windowStarted = Date.now(); writesInWindow = 0; }
    if (++writesInWindow > 1000) throw new Error('Activity-log export rate exceeded; events remain in the durable queue.');
    const record = { id: event.id, at: event.created_at, line, previous: existing.at(-1)?.mac || '0'.repeat(64) };
    const fd = fs.openSync(file, 'a', 0o600);
    try { fs.writeSync(fd, JSON.stringify({ ...record, mac: sign(record) }) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
  }
  return { append, records, fileFor };
}
module.exports = { createActivityLog };

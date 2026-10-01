const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('incoming authorized students sync incrementally and offline work skips the network', async () => {
  const students = [];
  const writes = [];
  const notices = [];
  let cursor = 0;
  let reads = 0;
  const docs = [
    { id: 'a@example.com', data: () => ({ email: 'a@example.com', name: 'A', group: 'Regular', adm_no: 'A1', added_at: { toMillis: () => 100 } }) },
    { id: 'b@example.com', data: () => ({ email: 'b@example.com', name: 'B', group: 'Regular', added_at: { toMillis: () => 110 } }) },
  ];
  const auth = { currentUser: { uid: 'anon', isAnonymous: true },
    onAuthStateChanged(cb) { queueMicrotask(() => cb(this.currentUser)); return () => {}; } };
  const firestore = () => ({ collection: () => ({ doc: () => ({ collection: name => name === 'student_logins'
    ? { doc: email => ({ get: async () => ({ exists: email === 'b@example.com', data: () => ({ adm_no: 'B2' }) }) }) }
    : { get: async () => { reads++; return { docs }; } } }) }) });
  const navigator = { onLine: false };
  const context = {
    firebase: { apps: [{}], firestore, auth: () => auth }, navigator,
    LibraryDB: {
      getRosterSyncCursor: () => cursor,
      setRosterSyncCursor: value => { cursor = value; return { ok: true }; },
      getStudents: () => students.map(student => ({ ...student })),
      upsertStudentFromCloud: record => {
        writes.push(record);
        const existing = students.find(student => student.email === record.email);
        if (existing) { existing.group = record.group; existing.cloud_synced = true; return { ok: true, created: false }; }
        students.push({ ...record, cloud_synced: true });
        return { ok: true, created: true };
      },
    },
    window: { electronAPI: { getKioskCreds: async () => null }, dispatchEvent: () => {} },
    Event: class {}, document: { getElementById: () => null }, console,
    showToast: message => notices.push(message),
    setTimeout, setInterval, clearInterval,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js/firebase-sync.js'), 'utf8'), context);
  const sync = context.window.FirebaseSync.syncIncomingStudents;
  assert.equal((await sync()).reason, 'offline');
  assert.equal(reads, 0);
  navigator.onLine = true;
  assert.equal((await sync()).created, 2);
  assert.equal(cursor, 110);
  assert.equal(notices.length, 1);
  assert.equal((await sync()).created, 0);
  assert.equal(writes.length, 2);
  docs[0] = { id: 'a@example.com', data: () => ({ email: 'a@example.com', name: 'A', group: 'Literary Club', adm_no: 'A1', updated_at: { toMillis: () => 120 } }) };
  assert.equal((await sync()).changed, 1);
  assert.equal(students[0].group, 'Literary Club');
  assert.equal(cursor, 120);
});

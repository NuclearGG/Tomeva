const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('anonymous sync publishes catalog only and replaces the legacy document', async () => {
  const writes = [];
  const auth = {
    currentUser: { uid: 'anonymous', isAnonymous: true },
    onAuthStateChanged(callback) { queueMicrotask(() => callback(this.currentUser)); return () => {}; },
  };
  const firestore = () => ({
    collection(name) {
      return {
        doc(id) {
          const root = `${name}/${id}`;
          return {
            path: root,
            collection(child) {
              return {
                doc(key) { return { path: `${root}/${child}/${key}` }; },
                async get() { return { docs: [] }; },
              };
            },
          };
        },
      };
    },
    batch() {
      return {
        set(ref, payload, options) { writes.push({ path: ref.path, payload, options }); },
        async commit() {},
      };
    },
  });
  firestore.FieldValue = { serverTimestamp: () => 'server-time' };
  const book = { access_no: 'B-1', document: 'Test title', author: 'Test author', status: 'Issued' };
  const transaction = {
    book_access_no: 'B-1', student_adm_no: 'A-1', issue_date: '2026-09-01',
    due_date: '2026-09-15', status: 'Active',
  };
  const context = {
    firebase: {
      apps: [{}], firestore, auth: () => auth,
    },
    LibraryDB: {
      getBooks: () => [book], getTransactions: () => [transaction],
      getStudents: () => [{ adm_no: 'A-1', name: 'Private Student' }],
      getRosterSyncCursor: () => 0,
      getSettings: () => ({ fine_per_day: 2 }),
      getOverdueTransactions: () => [transaction], getPendingFines: () => [],
      getFinePayments: () => [], getCollectedToday: () => ({ amount: 0, count: 0 }),
      getTotalCollected: () => 0, getBook: () => book,
      getStudent: () => ({ name: 'Private Student', class: '10', section: 'A' }),
      calcLateDays: () => 2,
    },
    window: { electronAPI: { getKioskCreds: async () => null } },
    navigator: { onLine: true },
    document: { getElementById: () => null },
    console,
    setTimeout, setInterval, clearInterval,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'firebase-sync.js'), 'utf8'), context);
  const result = await context.window.FirebaseSync.syncNow(false);
  assert.equal(result.ok, true);
  assert.equal(result.restrictedSynced, false);
  assert.deepEqual(writes.map(write => write.path), [
    'libraries/main/public/catalog', 'libraries/main',
  ]);
  for (const write of writes) {
    assert.equal(write.options, undefined, 'set must replace old PII fields');
    assert.equal(write.payload.issuedList.length, 1);
    assert.equal(write.payload.issuedList[0].book_id, 'B-1');
    assert.equal(write.payload.issuedList[0].title, 'Test title');
    assert.equal(write.payload.issuedList[0].student_name, undefined);
    assert.equal(write.payload.stats.collected_total, undefined);
    assert.equal(JSON.stringify(write.payload).includes('Private Student'), false);
  }
});

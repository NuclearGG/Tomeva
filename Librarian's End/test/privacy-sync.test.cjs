const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const scenario of [false, true, 'failed-page', 'batched']) test(scenario === 'batched' ? 'catalogue upload commits groups of at most 50 rows before publishing the manifest' : scenario === 'failed-page' ? 'a failed page write never publishes the new manifest' : scenario ? 'approved kiosk publishes sanitized catalog and replaces legacy PII' : 'unprovisioned sync defers every cloud write', async () => {
  const approved = scenario !== false;
  const writes = [];
  const deletions = [];
  const batches = [];
  const history = [{ projectId: 'demo-school', generation: 'retired-generation', publicCount: 1, privateCount: 2, recordedAt: Date.now() - 25 * 60 * 60 * 1000 }];
  const auth = {
    currentUser: approved ? { uid: 'desk', email: 'kiosk@example.org', isAnonymous: false } : { uid: 'anonymous', isAnonymous: true },
    onAuthStateChanged(callback) { queueMicrotask(() => callback(this.currentUser)); return () => {}; },
  };
  const firestore = () => ({
    app: { options: { projectId: 'demo-school' } },
    collection(name) {
      return {
        doc(id) {
          const root = `${name}/${id}`;
          return {
            path: root,
            async get() { return { exists: approved, data: () => ({ active: true, libraryId: 'main', email: 'kiosk@example.org' }) }; },
            onSnapshot(options, callback) { callback({ exists: approved, metadata: { fromCache: false }, data: () => ({ active: true, libraryId: 'main', email: 'kiosk@example.org' }) }); return () => {}; },
            collection(child) {
              return {
                orderBy() { return { limit() { return { onSnapshot() { return () => {}; } }; } }; },
                doc(key) { return { path: `${root}/${child}/${key}`, async get() { return { exists: false }; }, async set(payload) { writes.push({ path: `${root}/${child}/${key}`, payload }); } }; },
                async get() { return { docs: [] }; },
              };
            },
          };
        },
      };
    },
    batch() {
      const current = [];
      return {
        set(ref, payload, options) { const write = { path: ref.path, payload, options }; writes.push(write); current.push(write); },
        delete(ref) { deletions.push(ref.path); },
        async commit() { batches.push(current); if (scenario === 'failed-page') throw new Error('page write failed'); },
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
    TomevaCloudShards: require('../js/cloud-shards'),
    firebase: {
      apps: [{}], firestore, auth: () => auth,
    },
    LibraryDB: {
      recordCloudSnapshot: value => { history.push({ ...value, recordedAt: Date.now() }); return { ok: true }; },
      getCloudSnapshotHistory: () => history,
      forgetCloudSnapshot: generation => { const index = history.findIndex(item => item.generation === generation); if (index >= 0) history.splice(index, 1); return { ok: true }; },
      getBooks: () => scenario === 'batched' ? [book, ...Array.from({ length: 122 }, (_, index) => ({ access_no: 'B' + index, document: 'Title ' + index, status: 'Available' }))] : [book], getTransactions: () => [transaction],
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
  if (scenario === 'failed-page') {
    assert.equal(result.ok, false);
    assert.equal(writes.some(write => /public\/catalog$/.test(write.path)), false);
    return;
  }
  if (!approved) {
    assert.equal(result.reason, 'kiosk_required');
    assert.equal(writes.length, 0);
    return;
  }
  assert.equal(result.ok, true);
  assert.equal(result.restrictedSynced, true);
  if (scenario === 'batched') {
    const stages = batches.filter(batch => batch.some(write => /shards/.test(write.path)));
    assert.ok(stages.length >= 3);
    for (const stage of stages) {
      const rows = stage.reduce((sum, write) => sum + Object.values(write.payload).reduce((n, value) => n + (Array.isArray(value) ? value.length : 0), 0), 0);
      assert.ok(rows <= 50);
    }
    const publication = batches.findIndex(batch => batch.some(write => /public\/catalog$/.test(write.path)));
    assert.equal(publication, stages.length);
    return;
  }
  assert.deepEqual(deletions, ['libraries/main/catalog_shards/retired-generation-0', 'libraries/main/circulation_shards/retired-generation-0', 'libraries/main/circulation_shards/retired-generation-1']);
  assert.deepEqual(writes.filter(write => !/shards/.test(write.path)).map(write => write.path), [
    'libraries/main/public/catalog', 'libraries/main', 'libraries/main/restricted/circulation',
  ]);
  for (const write of writes.filter(write => !/circulation/.test(write.path))) {
    assert.equal(write.options, undefined, 'set must replace old PII fields');
    if (/catalog_shards/.test(write.path)) {
      assert.equal(write.payload.issuedList.length, 1);
      assert.equal(write.payload.issuedList[0].book_id, 'B-1');
      assert.equal(write.payload.issuedList[0].title, 'Test title');
      assert.equal(write.payload.issuedList[0].student_name, undefined);
    } else {
      assert.equal(write.payload.issuedList, undefined);
      assert.equal(write.payload.stats.collected_total, undefined);
    }
    assert.equal(JSON.stringify(write.payload).includes('Private Student'), false);
  }
});

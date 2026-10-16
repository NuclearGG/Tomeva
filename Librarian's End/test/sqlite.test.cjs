const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SqliteStore } = require('../main/sqlite-store');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLibraryService } = require('../main/library-service');
const { run: migrate } = require('../js/migrate-legacy-data');
const { registerDatabaseIpc } = require('../main/db-ipc');
const { createWorkstationLock } = require('../main/workstation-lock');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tomeva-sqlite-'));
  const store = new SqliteStore(dir);
  t.after(() => store.close());
  return { dir, store };
}
test('schema versions adopt unversioned profiles, back up upgrades, rebuild FTS, and reopen without rerunning', t => {
  const { dir, store } = fixture(t); store.initializeLegacy(null);
  createLibraryService(store).addBook({ access_no: 'UPGRADE', document: 'Astronomy upgrade' });
  assert.equal(store.database.pragma('user_version', { simple: true }), 3);
  store.database.exec('DROP TRIGGER books_fts_insert; DROP TRIGGER books_fts_update; DROP TRIGGER books_fts_delete; DROP TABLE books_fts; PRAGMA user_version = 0');
  store.close();
  const upgraded = new SqliteStore(dir); t.after(() => upgraded.close());
  assert.equal(upgraded.schemaMigration.from, 0); assert.equal(upgraded.schemaMigration.to, 3);
  assert.ok(fs.statSync(upgraded.schemaMigration.backupPath).size > 0);
  assert.equal(createLibraryService(upgraded).searchBooks('Astron')[0].access_no, 'UPGRADE');
  const Database = require('better-sqlite3'), backup = new Database(upgraded.schemaMigration.backupPath, { readonly: true });
  assert.equal(backup.pragma('user_version', { simple: true }), 0); assert.equal(backup.prepare('SELECT COUNT(*) AS n FROM books').get().n, 1); backup.close();
  upgraded.close(); const reopened = new SqliteStore(dir); t.after(() => reopened.close());
  assert.deepEqual(reopened.schemaMigration, { from: 3, to: 3, backupPath: null });
});
test('failed schema migrations roll back DDL, data, FTS and user_version; future schemas refuse downgrade', t => {
  const { dir, store } = fixture(t); store.initializeLegacy(null);
  const { migrateSchema } = require('../main/schema-migrations');
  const steps = [1, 2, 3].map(version => ({ version, up() {} }));
  assert.throws(() => migrateSchema(store.database, dir, [...steps, { version: 4, up(db) {
    db.exec("CREATE TABLE failed_upgrade(value); INSERT INTO books(data) VALUES ('{\"access_no\":\"GHOST\",\"document\":\"Ghost astronomy\",\"status\":\"Available\"}')");
  } }, { version: 5, up() { throw new Error('Injected upgrade failure'); } }]), /rolled back/);
  assert.equal(store.database.pragma('user_version', { simple: true }), 3);
  assert.equal(store.database.prepare("SELECT name FROM sqlite_master WHERE name='failed_upgrade'").get(), undefined);
  assert.equal(createLibraryService(store).searchBooks('Ghost').length, 0);
  store.database.pragma('user_version = 999'); store.close();
  assert.throws(() => new SqliteStore(dir), /newer than supported/);
  const db = new (require('better-sqlite3'))(path.join(dir, 'tomeva.sqlite3'), { readonly: true });
  assert.equal(db.pragma('user_version', { simple: true }), 999); db.close();
});
test('a failed pre-upgrade backup prevents migration writes and version advancement', t => {
  const { dir, store } = fixture(t); store.initializeLegacy(null);
  const original = store.database.prepare.bind(store.database); let changed = false;
  store.database.prepare = sql => {
    if (sql.startsWith('VACUUM')) throw new Error('Injected backup disk failure');
    return original(sql);
  };
  try {
    const steps = [1,2,3].map(version => ({version,up(){}}));
    assert.throws(() => require('../main/schema-migrations').migrateSchema(store.database,dir,[...steps,{version:4,up(){changed=true;}}]), /backup disk failure/);
    assert.equal(changed,false); assert.equal(store.database.pragma('user_version',{simple:true}),3);
  } finally { store.database.prepare = original; }
});
test('query-plan baselines retain indexed lookups, ordered windows and FTS access', t => {
  const { store } = fixture(t); store.initializeLegacy(null);
  for (const plan of require('../main/query-plans').inspectQueryPlans(store.database)) {
    assert.ok(plan.details.some(detail => detail.includes(plan.access)), `${plan.name}: ${plan.details.join('; ')}`);
    if (['book_window', 'student_window', 'overdue'].includes(plan.name)) assert.ok(!plan.details.some(detail => detail.includes('USE TEMP B-TREE')), plan.name);
  }
});
test('catalogue import matches mixed-case active references and omission rolls back the whole catalogue', t => {
  const { store } = fixture(t); store.initializeLegacy(null); const api = createLibraryService(store);
  api.addBook({ access_no: 'MiXeD', document: 'Original' }); api.addStudent({ adm_no: 'S1', name: 'Student' }); api.issueBook('S1', 'mixed');
  const loan = store.collections.transactions.findOne({ status: 'Active' }); loan.book_access_no = 'MIXED'; store.collections.transactions.update(loan);
  assert.equal(api.importBooks('[{"access_no":"mixed","document":"Replacement"}]').ok, true);
  assert.equal(api.getBook('mixed').status, 'Issued'); assert.equal(api.getBook('MIXED').access_no, 'MiXeD');
  assert.equal(api.getActiveTxnForBook('mixed').book_access_no, 'MiXeD');
  assert.equal(api.previewBackup(api.exportData()).ok, true);
  const before = api.exportData();
  assert.equal(api.importBooks('[{"access_no":"other","document":"Omitted loan"}]').ok, false);
  assert.deepEqual(JSON.parse(api.exportData()).books, JSON.parse(before).books);
  assert.equal(api.getActiveTxnForBook('mixed').transaction_id, loan.transaction_id);
});
test('student replacement cannot orphan an active borrower or change canonical admission references', t => {
  const { store } = fixture(t); store.initializeLegacy(null); const api = createLibraryService(store);
  api.addBook({ access_no:'B1', document:'Book' }); api.addStudent({ adm_no:'Reader-ONE', name:'Reader' }); api.issueBook('reader-one','B1');
  assert.equal(api.importStudents('[{"adm_no":"other","name":"Other"}]').ok, false);
  assert.equal(api.getStudent('Reader-ONE').name, 'Reader');
  assert.equal(api.importStudents('[{"adm_no":"READER-ONE","name":"Updated"}]').ok, true);
  assert.equal(api.getStudent('reader-one').adm_no, 'Reader-ONE');
  assert.equal(api.getActiveTxnForBook('B1').student_adm_no, 'Reader-ONE');
  assert.equal(api.previewBackup(api.exportData()).ok, true);
});
const legacy = (overrides = {}) => JSON.stringify({ collections: Object.entries({
  books: [{ access_no: 'B1', document: 'One', status: 'Available', $loki: 7, meta: { revision: 2 } }],
  students: [{ adm_no: 'S1', name: 'Student', email: 'student@example.com', group: 'Regular' }],
  transactions: [{ transaction_id: 'OLD', book_access_no: 'B1', student_adm_no: 'S1', status: 'Returned', fine: 2 }],
  finePayments: [{ payment_id: 'P1', transaction_id: 'OLD', amount: 2 }],
  settings: [{ fine_per_day: 3, loan_days: 7 }], ...overrides,
}).map(([name, data]) => ({ name, data })) });
function storage(raw) {
  const map = new Map([['tomeva.db', raw], ['unrelated', 'keep']]);
  return { getItem: key => map.get(key) ?? null, removeItem: key => map.delete(key), map };
}
test('native SQLite works in Electron with WAL persistence', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tomeva-sqlite-'));
  const store = new SqliteStore(dir);
  t.after(() => store.close());
  assert.equal(store.database.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(store.initializeLegacy(null).ok, true);
});

test('book IDs are case-insensitive throughout circulation and imports preserve canonical loan references', t => {
  const { store } = fixture(t); store.initializeLegacy(null); const api = createLibraryService(store);
  assert.equal(api.addBook({ access_no: 'Copy-Ab1', document: 'One' }).ok, true);
  assert.equal(api.addBook({ access_no: 'copy-ab1', document: 'Duplicate' }).ok, false);
  assert.equal(api.addStudent({ adm_no: 'S1', name: 'Student' }).ok, true);
  assert.equal(api.issueBook('S1', 'COPY-AB1').ok, true);
  assert.equal(api.getBook('copy-ab1').access_no, 'Copy-Ab1');
  assert.equal(api.getActiveTxnForBook('copy-ab1').book_access_no, 'Copy-Ab1');
  assert.equal(api.importBooks(JSON.stringify([{ access_no: 'COPY-AB1', document: 'Corrected' }])).ok, true);
  assert.equal(api.getBook('copy-ab1').status, 'Issued');
  assert.equal(api.getBook('copy-ab1').access_no, 'Copy-Ab1');
  assert.equal(api.issueBook('S1', 'copy-ab1').ok, false);
  assert.equal(api.reportDamage('copy-ab1', 'Torn', 'Minor Damage').ok, false);
  assert.equal(api.updateBookStatus('copy-ab1', 'Available'), false);
  assert.equal(api.returnBook('COPY-AB1').ok, true);
  assert.equal(api.reportDamage('copy-ab1', 'Torn', 'Minor Damage').ok, true);
  assert.equal(api.restoreBook('COPY-AB1', 'Fixed').ok, true);
});
test('stale Issued catalogue flags without an active loan do not survive import', t => {
  const { store } = fixture(t); store.initializeLegacy(null); const api = createLibraryService(store);
  api.addBook({ access_no: 'B1', document: 'Old' });
  const row = store.collections.books.findOne({ access_no: 'B1' }); row.status = 'Issued'; store.collections.books.update(row);
  assert.equal(api.importBooks('[{"access_no":"b1","document":"New"}]').ok, true);
  assert.equal(api.getBook('B1').status, 'Available');
});
test('indexed pages, FTS updates and rollback stay bounded on a 10,000-book catalogue', t => {
  const { store } = fixture(t); store.initializeLegacy(null); const api = createLibraryService(store);
  store.transaction(() => { for (let i = 0; i < 10000; i++) store.collections.books.insert({ access_no: 'B' + String(i).padStart(5, '0'), document: i === 9999 ? 'Unique Astronomy Reference' : 'Shelf Book ' + i, author: 'Author', status: 'Available' }); });
  const first = api.pageRows('books', { page: 0 }); const last = api.pageRows('books', { page: 399 });
  assert.equal(first.rows.length, 25); assert.equal(first.total, 10000); assert.equal(last.rows.length, 25);
  assert.equal(api.searchBooks('Astron')[0].access_no, 'B09999');
  assert.equal(api.pageRows('books', { query: 'Unique Reference' }).total, 1);
  assert.throws(() => api.pageRows('books', { pageSize: 1000000 }));
  assert.throws(() => api.pageRows('books; DROP TABLE books', {}));
  assert.throws(() => store.transaction(() => { store.collections.books.insert({ access_no: 'ROLLBACK', document: 'Ghost Astronomy', status: 'Available' }); throw new Error('Interrupted'); }));
  assert.equal(api.searchBooks('Ghost').length, 0);
  const book = store.collections.books.findOne({ access_no: 'B09999' }); book.document = 'Changed Mathematics'; store.collections.books.update(book);
  assert.equal(api.searchBooks('Astron').length, 0); assert.equal(api.searchBooks('Mathem')[0].access_no, 'B09999');
  const plan = store.database.prepare("EXPLAIN QUERY PLAN SELECT data FROM transactions WHERE status='Active' AND json_extract(data,'$.due_date') < ?").all('2026-10-15');
  assert.ok(plan.some(row => row.detail.includes('transactions_overdue')));
  const plans = require('../main/query-plans').inspectQueryPlans(store.database);
  for (const entry of plans) assert.ok(entry.details.some(detail => detail.includes(entry.access)), entry.name);
  const folder = path.join(__dirname, '../test-artifacts'); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'query-plans.json'), JSON.stringify({ sqlite: store.database.prepare('SELECT sqlite_version() AS version').get().version, node: process.version, books: 10000, plans }, null, 2));
});
test('Unicode accession case variants cannot duplicate books or conceal legacy active loans', t => {
  const { store } = fixture(t); store.initializeLegacy(null); const api = createLibraryService(store);
  api.addBook({ access_no: 'École-Δ', document: 'Unicode copy' }); api.addStudent({ adm_no: 'S1', name: 'Student' });
  assert.throws(() => store.collections.books.insert({ access_no: 'école-δ', document: 'Duplicate', status: 'Available' }), /UNIQUE/);
  store.collections.transactions.insert({ transaction_id: 'OLD-UNICODE', book_access_no: 'école-δ', student_adm_no: 'S1', status: 'Active', issue_date: '2026-10-01', due_date: '2026-10-15' });
  assert.equal(api.getActiveTxnForBook('ÉCOLE-Δ').transaction_id, 'OLD-UNICODE');
  assert.equal(api.issueBook('S1', 'École-Δ').ok, false);
  assert.throws(() => store.collections.transactions.insert({ transaction_id: 'SECOND', book_access_no: 'École-Δ', status: 'Active' }), /UNIQUE/);
  assert.equal(api.returnBook('ÉCOLE-Δ').ok, true);
});
test('legacy backup, exact rows, cleanup and restart are idempotent', t => {
  const { dir, store } = fixture(t);
  const raw = legacy();
  const browser = storage(raw);
  const result = migrate({ initialize: value => store.initializeLegacy(value) }, browser);
  assert.deepEqual(result.counts, { books: 1, students: 1, transactions: 1, finePayments: 1, settings: 1 });
  assert.equal(fs.readFileSync(result.backupPath, 'utf8'), raw);
  assert.equal(browser.getItem('tomeva.db'), null);
  assert.equal(browser.getItem('unrelated'), 'keep');
  assert.match(result.notice, /SQLite/);
  const api = createLibraryService(store);
  assert.equal(api.getStudent('S1').email, 'student@example.com');
  assert.equal(api.addBook({ access_no: 'B2', document: 'Two' }).ok, true);
  assert.equal(store.initializeLegacy(raw).migrated, false);
  assert.equal(api.getBooks().length, 2);
  store.close();
  const reopened = new SqliteStore(dir);
  t.after(() => reopened.close());
  assert.equal(reopened.initializeLegacy(null).migrated, false);
  assert.equal(createLibraryService(reopened).getBooks().length, 2);
});
test('duplicate rows roll back every table and preserve legacy source and disk backup', t => {
  const { dir, store } = fixture(t);
  const raw = legacy({ students: [{ adm_no: 'S1' }, { adm_no: 'S1' }] });
  const browser = storage(raw);
  assert.throws(() => migrate({ initialize: value => store.initializeLegacy(value) }, browser), /UNIQUE/);
  assert.equal(browser.getItem('tomeva.db'), raw);
  assert.equal(store.migrationState(), undefined);
  assert.ok(Object.values(store.counts()).every(n => n === 0));
  const backups = fs.readdirSync(path.join(dir, 'migration-backups'));
  assert.equal(fs.readFileSync(path.join(dir, 'migration-backups', backups[0]), 'utf8'), raw);
});
test('malformed JSON is backed up and cannot clear legacy data', t => {
  const { dir, store } = fixture(t);
  const browser = storage('{broken');
  assert.throws(() => migrate({ initialize: raw => store.initializeLegacy(raw) }, browser));
  assert.equal(browser.getItem('tomeva.db'), '{broken');
  assert.equal(fs.readdirSync(path.join(dir, 'migration-backups')).length, 1);
  assert.equal(store.migrationState(), undefined);
});
test('backup failure or count mismatch cannot commit a migration', t => {
  const { store } = fixture(t);
  const original = store.backupLegacy;
  store.backupLegacy = () => { throw new Error('Disk full'); };
  assert.throws(() => store.initializeLegacy(legacy()), /Disk full/);
  assert.equal(store.collections.books.count(), 0);
  store.backupLegacy = original;
  const insert = store.collections.books.insert;
  store.collections.books.insert = () => {};
  assert.throws(() => store.initializeLegacy(legacy()), /row-count/);
  assert.equal(store.migrationState(), undefined);
  store.collections.books.insert = insert;
  assert.equal(store.initializeLegacy(legacy()).ok, true);
});
test('different legacy source cannot overwrite completed migration', t => {
  const { store } = fixture(t);
  store.initializeLegacy(legacy());
  assert.throws(() => store.initializeLegacy(legacy({ books: [] })), /differs/);
  assert.equal(store.collections.books.count(), 1);
});
test('failed cleanup retries safely; unverified result never clears storage', t => {
  const { store } = fixture(t);
  const browser = storage(legacy());
  browser.removeItem = () => { throw new Error('Storage unavailable'); };
  const first = migrate({ initialize: raw => store.initializeLegacy(raw) }, browser);
  assert.match(first.notice, /retained/);
  browser.removeItem = key => browser.map.delete(key);
  assert.equal(migrate({ initialize: raw => store.initializeLegacy(raw) }, browser).migrated, false);
  assert.equal(browser.getItem('tomeva.db'), null);
  const untouched = storage('keep');
  assert.throws(() => migrate({ initialize: () => ({ ok: true }) }, untouched));
  assert.equal(untouched.getItem('tomeva.db'), 'keep');
});
test('student and teacher circulation, return undo, payment undo and restart', t => {
  const { dir, store } = fixture(t);
  store.initializeLegacy(null);
  const logs = [];
  const api = createLibraryService(store, line => logs.push(line));
  assert.equal(api.addBook({ access_no: 'B1', document: 'One' }).ok, true);
  assert.equal(api.addStudent({ adm_no: 'S1', name: 'A', email: 'a@example.com' }).ok, true);
  assert.equal(api.issueBook('S1', 'B1').ok, true);
  assert.equal(api.getBook('B1').status, 'Issued');
  const txn = store.collections.transactions.findOne({ status: 'Active' });
  txn.due_date = '2020-01-01';
  store.collections.transactions.update(txn);
  assert.ok(api.returnBook('B1').fine > 0);
  assert.equal(api.undoLastTransaction().ok, true);
  assert.equal(api.getActiveTransactions().length, 1);
  assert.equal(api.returnBook('B1').ok, true);
  assert.equal(api.markFinePaid(txn.transaction_id), true);
  assert.equal(api.markFinePaid(txn.transaction_id), false);
  assert.equal(api.getFinePayments().length, 1);
  assert.equal(api.undoLastTransaction().ok, true);
  assert.equal(api.getFinePayments().length, 0);
  assert.equal(api.getPendingFines().length, 1);
  assert.equal(api.issueBookToTeacher('Teacher', 'teacher@example.com', 'B1').ok, true);
  assert.equal(api.getActiveTxnForBook('B1').due_date, null);
  assert.equal(api.returnBook('B1').fine, 0);
  assert.equal(api.undoLastTransaction().ok, true);
  assert.equal(api.undoLastTransaction().ok, true);
  assert.equal(api.getBook('B1').status, 'Available');
  assert.equal(api.reportDamage('B1', 'Minor Damage', 'Torn').ok, true);
  assert.equal(api.restoreBook('B1', 'Fixed').ok, true);
  assert.equal(api.undoLastTransaction().ok, true);
  assert.equal(api.getBook('B1').status, 'Damaged');
  assert.ok(logs.length > 5);
  const before = JSON.parse(api.exportData());
  store.close();
  const reopened = new SqliteStore(dir);
  t.after(() => reopened.close());
  reopened.initializeLegacy(null);
  const after = JSON.parse(createLibraryService(reopened).exportData());
  delete before.backup_date; delete after.backup_date; delete before.checksum; delete after.checksum;
  assert.deepEqual(after, before);
});
test('failed imports and restores leave all original rows intact', t => {
  const { store } = fixture(t);
  store.initializeLegacy(legacy());
  const api = createLibraryService(store);
  const books = api.getBooks();
  assert.equal(api.importBooks(JSON.stringify([{ access_no: 'B2', document: 'Two' }, { access_no: 'B2', document: 'Duplicate' }])).ok, false);
  assert.deepEqual(api.getBooks(), books);
  const students = api.getStudents();
  assert.equal(api.importStudents(JSON.stringify([{ adm_no: 'S2', name: 'A' }, { adm_no: 'S2', name: 'B' }])).ok, false);
  assert.deepEqual(api.getStudents(), students);
  const backup = JSON.parse(api.exportData());
  backup.transactions.push({ transaction_id: 'OLD' });
  assert.equal(api.restoreData(JSON.stringify(backup)).ok, false);
  assert.deepEqual(api.getBooks(), books);
  assert.equal(api.getTransactions().length, 1);
});

test('careless restore rejects wrong files; insertion failure rolls back every table and survives restart', t => {
  const { dir, store } = fixture(t);
  store.initializeLegacy(legacy());
  const api = createLibraryService(store);
  const snapshot = () => {
    const data = JSON.parse(api.exportData());
    delete data.backup_date; delete data.checksum;
    return data;
  };
  const before = snapshot();
  const valid = api.exportData();
  for (const input of ['', 'null', '[]', '{broken', '{}', valid.replace('One', 'Changed')]) {
    assert.equal(api.restoreData(input).ok, false);
    assert.deepEqual(snapshot(), before);
  }
  const { encodeBackup } = require('../main/backup');
  const duplicate = snapshot(); duplicate.books.push({ ...duplicate.books[0] });
  assert.equal(api.restoreData(encodeBackup(duplicate)).ok, false);
  const old = JSON.stringify({ ...before, format: 'tomeva-v2' });
  assert.equal(api.previewBackup(old).legacy, true);
  assert.equal(api.restoreData(old).ok, false);
  const insert = store.collections.students.insert;
  store.collections.students.insert = () => { throw new Error('Simulated disk failure after books were replaced'); };
  assert.equal(api.restoreData(valid).ok, false);
  store.collections.students.insert = insert;
  assert.deepEqual(snapshot(), before);
  store.close();
  const reopened = new SqliteStore(dir); t.after(() => reopened.close());
  const restored = JSON.parse(createLibraryService(reopened).exportData());
  delete restored.backup_date; delete restored.checksum;
  assert.deepEqual(restored, before);
});

test('a pre-restore SQLite checkpoint remains usable after replacing the live library', async t => {
  const { store } = fixture(t);
  store.initializeLegacy(legacy());
  const api = createLibraryService(store);
  const original = JSON.parse(api.exportData());
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tomeva-restore-checkpoint-'));
  await store.database.backup(path.join(backupDir, 'tomeva.sqlite3'));
  const { encodeBackup } = require('../main/backup');
  assert.equal(api.restoreData(encodeBackup({ books: [], students: [], transactions: [], finePayments: [], settings: { fine_per_day: 0, loan_days: 7 } })).ok, true);
  assert.equal(api.getBooks().length, 0);
  const backup = new SqliteStore(backupDir); t.after(() => backup.close());
  const recovered = JSON.parse(createLibraryService(backup).exportData());
  delete original.backup_date; delete original.checksum;
  delete recovered.backup_date; delete recovered.checksum;
  assert.deepEqual(recovered, original);
  assert.equal(api.restoreData(JSON.stringify({ ...original, format: 'tomeva-v2' }), true).ok, true);
  assert.equal(api.getBooks()[0].access_no, 'B1');
});

test('settings preserve a zero fine and reject invalid loan periods', t => {
  const { store } = fixture(t);
  store.initializeLegacy(null);
  const api = createLibraryService(store);
  assert.equal(api.saveSettings({ fine_per_day: 0, loan_days: 14 }).ok, true);
  assert.equal(api.getSettings().fine_per_day, 0);
  assert.equal(api.saveSettings({ loan_days: -1 }).ok, false);
  assert.equal(api.saveSettings({ loan_days: 1.5 }).ok, false);
  assert.equal(api.getSettings().loan_days, 14);
});

test('catalogue imports preserve active loans and due-date returns stay free until tomorrow', t => {
  const { store } = fixture(t);
  store.initializeLegacy(null);
  const api = createLibraryService(store);
  assert.equal(api.addBook({ access_no: 'B1', document: 'One' }).ok, true);
  assert.equal(api.addStudent({ adm_no: 'S1', name: 'Student' }).ok, true);
  assert.equal(api.issueBook('S1', 'B1').ok, true);
  const missing = api.importBooks(JSON.stringify([{ access_no: 'B2', document: 'Two' }]));
  assert.equal(missing.ok, false);
  assert.equal(api.getBook('B1').status, 'Issued');
  assert.equal(api.importBooks(JSON.stringify([{ access_no: 'B1', document: 'One', status: 'Available' }])).ok, true);
  assert.equal(api.getBook('B1').status, 'Issued');
  const txn = store.collections.transactions.findOne({ status: 'Active' });
  txn.due_date = require('../main/calendar').localDate();
  store.collections.transactions.update(txn);
  assert.equal(api.calcLateDays(txn.due_date), 0);
  assert.equal(api.returnBook('B1').fine, 0);
});
test('failure after transaction insert rolls back issue and emits no audit log', t => {
  const { store } = fixture(t);
  store.initializeLegacy(legacy());
  const logs = [];
  const api = createLibraryService(store, line => logs.push(line));
  store.collections.books.update = () => { throw new Error('Write failure'); };
  assert.equal(api.issueBook('S1', 'B1').ok, false);
  assert.equal(api.getTransactions().length, 1);
  assert.equal(api.getBook('B1').status, 'Available');
  assert.equal(logs.length, 0);
});
test('IPC rejects untrusted senders, unknown methods and access before migration', t => {
  const { store } = fixture(t);
  const handlers = {};
  registerDatabaseIpc({ on: (name, handler) => { handlers[name] = handler; } }, store, e => e.trusted);
  const call = (trusted, channel, ...args) => {
    const event = { trusted };
    handlers[channel](event, ...args);
    return event.returnValue;
  };
  assert.match(call(false, 'db:initialize', null).error, /denied/);
  assert.match(call(true, 'db:call', 'getBooks', []).error, /migration/);
  assert.equal(call(true, 'db:initialize', null).value.verified, true);
  assert.match(call(true, 'db:call', '__proto__', []).error, /Unsupported/);
  assert.match(call(true, 'db:call', 'exec', ['DROP TABLE books']).error, /Unsupported/);
  for (const method of ['restoreData', 'previewBackup', 'updateBookStatus'])
    assert.match(call(true, 'db:call', method, []).error, /Unsupported/);
  assert.deepEqual(call(true, 'db:call', 'getBooks', []), { ok: true, value: [] });
});

test('IPC bounds migration types, argument sizes and bursts before database mutation', t => {
  const { store } = fixture(t), handlers = {};
  registerDatabaseIpc({ on: (name, handler) => { handlers[name] = handler; } }, store, () => true);
  const call = (channel, ...args) => { const event = {}; handlers[channel](event, ...args); return event.returnValue; };
  assert.match(call('db:initialize', {}).error, /migration limit/);
  assert.equal(call('db:initialize', null).ok, true);
  assert.match(call('db:call', 'saveSettings', [{ padding: 'x'.repeat(32768) }]).error, /arguments/);
  assert.match(call('db:call', 'getBooks', Array(9).fill(null)).error, /arguments/);
  let response;
  for (let i = 0; i < 1001; i++) response = call('db:call', 'getBooks', []);
  assert.match(response.error, /Too many/);
  assert.equal(store.collections.books.count(), 0);
});

test('case-insensitive student lookup preserves canonical loan ownership and deletion protection', t => {
  const { store } = fixture(t); store.initializeLegacy(null);
  const api = createLibraryService(store);
  api.addBook({ access_no: 'B1', document: 'Book' });
  api.addStudent({ adm_no: 'ADM-ONE', name: 'Student' });
  assert.equal(api.issueBook('adm-one', 'B1').txn.student_adm_no, 'ADM-ONE');
  assert.equal(api.deleteStudent('adm-one').ok, false);
  assert.equal(api.previewBackup(api.exportData()).ok, true);
  assert.equal(api.returnBook('B1').ok, true);
  assert.equal(api.deleteStudent('adm-one').ok, true);
});

test('cloud roster upsert requires real admission numbers and reconciles by email or admission number', t => {
  const { store } = fixture(t);
  store.initializeLegacy(null);
  const api = createLibraryService(store);
  const first = { email: 'student@example.com', name: 'Web Student', group: 'Regular' };
  assert.equal(api.upsertStudentFromCloud(first).skipped, true);
  assert.equal(api.getStudents().length, 0);
  assert.equal(api.upsertStudentFromCloud({ ...first, adm_no: 'A100' }).created, true);
  assert.equal(api.getStudents()[0].cloud_synced, true);
  assert.equal(api.upsertStudentFromCloud({ ...first, adm_no: 'A100', group: 'Literary Club' }).created, false);
  assert.equal(api.getStudents().length, 1);
  assert.equal(api.getStudent('A100').group, 'Literary Club');
  api.addBook({ access_no: 'B1', document: 'One' });
  assert.equal(api.issueBook('A100', 'B1').ok, true);
  assert.equal(api.getStudent('A100').email, first.email);
  assert.equal(api.getActiveTransactions()[0].student_adm_no, 'A100');
  assert.equal(api.getStudents().length, 1);
  assert.equal(api.addStudent({ adm_no: 'A200', name: 'Local Student' }).ok, true);
  assert.equal(api.upsertStudentFromCloud({ email: 'local@example.com', name: 'Web Name', adm_no: 'A200', group: 'Editorial Board' }).ok, true);
  assert.equal(api.getStudent('A200').name, 'Local Student');
  assert.equal(api.getStudent('A200').group, 'Editorial Board');
  assert.equal(api.getStudent('A200').email, 'local@example.com');
  assert.equal(api.upsertStudentFromCloud({ email: 'other@example.com', name: 'Other', adm_no: 'A200' }).ok, false);
  assert.equal(api.getStudent('A200').email, 'local@example.com');
  assert.equal(api.addStudent({ adm_no: 'WEB-OLD', name: 'Legacy Web Student', email: 'old@example.com' }).ok, true);
  assert.equal(api.upsertStudentFromCloud({ email: 'old@example.com', name: 'Legacy Web Student', adm_no: 'A300', group: 'Regular' }).ok, true);
  assert.equal(api.getStudent('WEB-OLD'), null);
  assert.equal(api.getStudent('A300').email, 'old@example.com');
  assert.equal(api.setRosterSyncCursor(123).ok, true);
  assert.equal(api.getRosterSyncCursor(), 123);
});

test('student corrections keep one admission number and deletion waits for returns', t => {
  const { store } = fixture(t);
  store.initializeLegacy(null);
  const api = createLibraryService(store);
  assert.equal(api.addStudent({ adm_no: 'A-42', name: 'Old Name', email: 'old@example.com' }).ok, true);
  assert.equal(api.addStudent({ adm_no: ' a-42 ', name: 'Duplicate' }).ok, false);
  assert.equal(api.getStudentByAdmNo('a-42').name, 'Old Name');
  assert.equal(api.updateStudent('a-42', { name: 'Correct Name', email: 'new@example.com', class: '10', section: 'A', roll_no: '7', group: 'Regular' }).ok, true);
  assert.equal(api.getStudents().length, 1);
  assert.equal(api.getStudentByAdmNo('A-42').name, 'Correct Name');
  api.addBook({ access_no: 'B-42', document: 'Book' });
  assert.equal(api.issueBook('A-42', 'B-42').ok, true);
  assert.match(api.deleteStudent('A-42').msg, /return/i);
  assert.equal(api.returnBook('B-42').ok, true);
  assert.equal(api.deleteStudent('a-42').ok, true);
  assert.equal(api.getStudents().length, 0);
  assert.equal(api.getTransactions().length, 1);
});

test('workstation PIN is salted, local, persistent and gates database calls while locked', async t => {
  const { dir, store } = fixture(t);
  store.initializeLegacy(null);
  const protection = require('./os-protection.cjs')();
  const lock = createWorkstationLock(store, protection);
  assert.equal(lock.config().configured, false);
  assert.equal((await lock.setPin('12', 5)).ok, false);
  assert.equal((await lock.setPin('123456', 10)).ok, true);
  const row = store.collections.settings.findOne({});
  assert.equal(row.workstation_pin_hash, null);
  assert.ok(row.workstation_pin_verifier);
  assert.ok(row.workstation_pin_salt.length >= 32);
  const service = createLibraryService(store);
  assert.equal(service.getSettings().workstation_pin_hash, undefined);
  assert.equal(JSON.parse(service.exportData()).settings.workstation_pin_hash, undefined);
  service.saveSettings({ fine_per_day: 3, workstation_pin_hash: 'forged' });
  assert.equal(store.collections.settings.findOne({}).workstation_pin_hash, row.workstation_pin_hash);
  assert.equal(lock.lock().ok, true);
  const handlers = {};
  registerDatabaseIpc({ on: (name, handler) => { handlers[name] = handler; } }, store, () => true, undefined, lock.isLocked);
  const call = method => { const event = {}; handlers['db:call'](event, method, []); return event.returnValue; };
  handlers['db:initialize']({}, null);
  assert.match(call('getBooks').error, /locked/);
  assert.equal((await lock.unlock('0000')).ok, false);
  assert.equal((await lock.unlock('123456')).ok, true);
  assert.equal(call('getBooks').ok, true);
  store.close();
  const reopened = new SqliteStore(dir);
  t.after(() => reopened.close());
  const restarted = createWorkstationLock(reopened, protection);
  assert.equal(restarted.config().locked, true);
  for (let i = 0; i < 5; i++) await restarted.unlock('000000');
  assert.match((await createWorkstationLock(reopened, protection).unlock('123456')).msg, /Too many/);
});

test('catalog imports preserve recorded damage/loss and cannot inject a status', t => {
  const { store } = fixture(t);
  store.initializeLegacy(null);
  const service = createLibraryService(store);
  service.addBook({ access_no: 'B1', document: 'Book' });
  assert.equal(service.updateBookStatus('B1', 'Lost'), true);
  assert.equal(service.updateBookStatus('B1', 'Anything'), false);
  assert.equal(service.importBooks(JSON.stringify([{ access_no: 'B1', document: 'Book', status: 'Available' }])).ok, true);
  assert.equal(service.getBook('B1').status, 'Lost');
});

test('audit export failure retains committed events for replay and undo survives reopening', t => {
  const { dir, store } = fixture(t);
  store.initializeLegacy(null);
  const service = createLibraryService(store, () => { throw new Error('disk full'); });
  service.addBook({ access_no: 'B1', document: 'Book' });
  service.addStudent({ adm_no: 'S1', name: 'Student' });
  assert.equal(service.issueBook('S1', 'B1').ok, true);
  assert.ok(store.database.prepare('SELECT COUNT(*) AS n FROM audit_events WHERE exported = 0').get().n > 0);
  store.close();
  const reopened = new SqliteStore(dir);
  t.after(() => reopened.close());
  const exported = [];
  const restarted = createLibraryService(reopened, (line, event) => exported.push(event.id));
  assert.equal(restarted.undoLastTransaction().ok, true);
  assert.equal(restarted.getBook('B1').status, 'Available');
  assert.equal(reopened.database.prepare('SELECT COUNT(*) AS n FROM audit_events WHERE exported = 0').get().n, 0);
  assert.equal(new Set(exported).size, exported.length);
});

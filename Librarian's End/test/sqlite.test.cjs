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
  delete before.backup_date; delete after.backup_date;
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
  txn.due_date = new Date().toISOString().slice(0, 10);
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
  assert.deepEqual(call(true, 'db:call', 'getBooks', []), { ok: true, value: [] });
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
  const lock = createWorkstationLock(store);
  assert.equal(lock.config().configured, false);
  assert.equal((await lock.setPin('12', 5)).ok, false);
  assert.equal((await lock.setPin('1234', 10)).ok, true);
  const row = store.collections.settings.findOne({});
  assert.notEqual(row.workstation_pin_hash, '1234');
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
  assert.equal((await lock.unlock('1234')).ok, true);
  assert.equal(call('getBooks').ok, true);
  store.close();
  const reopened = new SqliteStore(dir);
  t.after(() => reopened.close());
  assert.equal(createWorkstationLock(reopened).config().locked, true);
});

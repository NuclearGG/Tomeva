const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encodeBackup, decodeBackup } = require('../main/backup');
const payload = () => ({ books: [{ access_no: 'B1', document: 'Book', status: 'Available' }], students: [], transactions: [], finePayments: [], settings: { fine_per_day: 2, loan_days: 14 } });
test('backup validates checksum, row shape, version, and circulation references', () => {
  const value = payload();
  assert.equal(decodeBackup(encodeBackup(value)).counts.books, 1);
  assert.throws(() => decodeBackup(encodeBackup(value).replace('Book', 'Changed')), /checksum/);
  assert.throws(() => decodeBackup(encodeBackup({ ...value, books: [...value.books, ...value.books] })), /Duplicate/);
  assert.throws(() => decodeBackup(encodeBackup({ ...value, books: [{ ...value.books[0], status: 'Issued' }] })), /active loan/);
  assert.throws(() => decodeBackup(encodeBackup({ ...value, transactions: [{ transaction_id: 'T1', book_access_no: 'missing', status: 'Active' }] })), /inconsistent/);
  const legacy = JSON.stringify({ ...value, format: 'tomeva-v2' });
  assert.throws(() => decodeBackup(legacy), /legacy/i);
  assert.equal(decodeBackup(legacy, true).legacy, true);
});

test('checksummed backups still reject malformed rendering fields and impossible dates', () => {
  for (const patch of [{ publisher: {} }, { author: [] }, { cost: { amount: 5 } }, { access_no: '<b>bad</b>' }]) {
    const data = payload(); Object.assign(data.books[0], patch);
    assert.throws(() => decodeBackup(encodeBackup(data)), /Invalid/);
  }
  const data = payload();
  data.students.push({ adm_no: 'S1', name: 'Student', group: '<b>staff</b>' });
  assert.throws(() => decodeBackup(encodeBackup(data)), /group/);
  data.students[0].group = 'Regular';
  data.books[0].status = 'Issued';
  data.transactions.push({ transaction_id: 'T1', book_access_no: 'B1', student_adm_no: 'S1', status: 'Active', issue_date: '2026-02-30', due_date: '2026-03-10' });
  assert.throws(() => decodeBackup(encodeBackup(data)), /date/);
  data.transactions[0].issue_date = '2026-02-28';
  assert.equal(decodeBackup(encodeBackup(data)).counts.transactions, 1);
});

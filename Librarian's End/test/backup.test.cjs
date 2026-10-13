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

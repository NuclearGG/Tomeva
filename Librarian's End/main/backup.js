'use strict';
const { createHash } = require('node:crypto');
const BOOK_STATUSES = new Set(['Available', 'Issued', 'Damaged', 'Under Repair', 'Lost']);
const TXN_STATUSES = new Set(['Active', 'Returned', 'FinePending', 'FinePaid', 'Restored']);
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const checksum = data => createHash('sha256').update(canonical(data)).digest('hex');
function encodeBackup(data) {
  const payload = { ...data, format: 'tomeva-v3', schemaVersion: 3 };
  return JSON.stringify({ ...payload, checksum: checksum(payload) }, null, 2);
}
function decodeBackup(raw, allowLegacy = false) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 100 * 1024 * 1024) throw new Error('Backup must be a JSON file smaller than 100 MiB.');
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid backup object.');
  const legacy = data.format === 'tomeva-v2';
  if (legacy && !allowLegacy) throw new Error('This legacy backup has no checksum. Review it and explicitly allow a legacy restore.');
  if (!legacy) {
    if (data.format !== 'tomeva-v3' || data.schemaVersion !== 3) throw new Error('Unsupported backup version.');
    const { checksum: expected, ...payload } = data;
    if (typeof expected !== 'string' || checksum(payload) !== expected) throw new Error('Backup checksum mismatch.');
  }
  const text = (v, max, required = false) => typeof v === 'string' && v.length <= max && (!required || !!v.trim()) && !/[\u0000-\u001f\u007f]/.test(v);
  const keys = { books: 'access_no', students: 'adm_no', transactions: 'transaction_id', finePayments: 'payment_id' };
  for (const [table, key] of Object.entries(keys)) {
    if (!Array.isArray(data[table]) || data[table].length > 200000) throw new Error(table + ' must be a bounded array.');
    const seen = new Set();
    for (const row of data[table]) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || !text(row[key], 100, true)) throw new Error('Invalid ' + table + ' row identifier.');
      const id = row[key].toLowerCase();
      if (seen.has(id)) throw new Error('Duplicate ' + table + ' identifier: ' + row[key]);
      seen.add(id);
      if (Buffer.byteLength(JSON.stringify(row)) > 16384) throw new Error('Oversized ' + table + ' row.');
    }
  }
  for (const b of data.books) if (!text(b.document, 200, true) || !BOOK_STATUSES.has(b.status) || (b.author != null && !text(b.author, 100))) throw new Error('Invalid book title, author, or status.');
  for (const s of data.students) if (!text(s.name, 100, true) || (s.email != null && !text(s.email, 320))) throw new Error('Invalid student name or email.');
  const books = new Map(data.books.map(b => [b.access_no, b]));
  const students = new Set(data.students.map(s => s.adm_no));
  const transactions = new Map(data.transactions.map(t => [t.transaction_id, t]));
  const active = new Set();
  for (const t of data.transactions) {
    if (!TXN_STATUSES.has(t.status) || !text(t.book_access_no, 50, true) || (t.fine != null && (!Number.isFinite(t.fine) || t.fine < 0))) throw new Error('Invalid transaction status, book, or fine.');
    if (t.status === 'Active') {
      if (active.has(t.book_access_no) || books.get(t.book_access_no)?.status !== 'Issued') throw new Error('Active loan has a duplicate or inconsistent book.');
      if (!t.is_teacher && t.borrower_type !== 'teacher' && !students.has(t.student_adm_no)) throw new Error('Active loan references a missing student.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t.issue_date || '') || (t.borrower_type !== 'teacher' && !/^\d{4}-\d{2}-\d{2}$/.test(t.due_date || ''))) throw new Error('Invalid active loan dates.');
      active.add(t.book_access_no);
    }
  }
  for (const b of data.books) if (b.status === 'Issued' && !active.has(b.access_no)) throw new Error('Issued book has no active loan.');
  for (const p of data.finePayments) if (!transactions.has(p.transaction_id) || !Number.isFinite(p.amount) || p.amount < 0) throw new Error('Invalid payment amount or transaction reference.');
  if (!data.settings || Array.isArray(data.settings) || typeof data.settings !== 'object'
    || !Number.isFinite(data.settings.fine_per_day) || data.settings.fine_per_day < 0 || data.settings.fine_per_day > 10000
    || !Number.isInteger(data.settings.loan_days) || data.settings.loan_days < 1 || data.settings.loan_days > 365) throw new Error('Invalid backup settings.');
  return { data, legacy, counts: Object.fromEntries(Object.keys(keys).map(table => [table, data[table].length])) };
}
module.exports = { encodeBackup, decodeBackup, BOOK_STATUSES };

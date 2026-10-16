'use strict';
// Structural baselines: SQLite instruction numbers and timing vary by runtime.
// Every hot lookup/window below must retain its named access path.
const BASELINES = [
  { name: 'book_identity', sql: 'SELECT access_no FROM books WHERE tomeva_fold(access_no) = ?', args: ['b1'], access: 'books_access_fold' },
  { name: 'active_copy', sql: "SELECT data FROM transactions WHERE tomeva_fold(book_access_no) IS ? AND status IS ? ORDER BY _id", args: ['b1', 'Active'], access: 'transactions_book_fold_status' },
  { name: 'overdue', sql: "SELECT data FROM transactions WHERE status='Active' AND json_extract(data,'$.due_date') < ? ORDER BY json_extract(data,'$.due_date')", args: ['2026-10-16'], access: 'transactions_overdue' },
  { name: 'student_loans', sql: "SELECT COUNT(*) FROM transactions WHERE student_adm_no = ? AND status='Active'", args: ['S1'], access: 'transactions_student_status' },
  { name: 'book_window', sql: 'SELECT data FROM books ORDER BY access_no COLLATE NOCASE LIMIT ? OFFSET ?', args: [25, 0], access: 'books_access_nocase' },
  { name: 'student_window', sql: 'SELECT data FROM students ORDER BY adm_no COLLATE NOCASE LIMIT ? OFFSET ?', args: [25, 0], access: 'students_adm_page' },
  { name: 'book_fts', sql: 'SELECT data FROM books WHERE _id IN (SELECT rowid FROM books_fts WHERE books_fts MATCH ?) ORDER BY access_no COLLATE NOCASE LIMIT ?', args: ['"Astron"*', 25], access: 'books_fts VIRTUAL TABLE INDEX' },
  { name: 'pending_fines', sql: "SELECT data FROM transactions WHERE status='FinePending' ORDER BY _id DESC LIMIT ?", args: [25], access: 'transactions_overdue' },
];
function inspectQueryPlans(database) {
  return BASELINES.map(baseline => ({ name: baseline.name, access: baseline.access, details: database.prepare('EXPLAIN QUERY PLAN ' + baseline.sql).all(...baseline.args).map(row => row.detail) }));
}
module.exports = { BASELINES, inspectQueryPlans };

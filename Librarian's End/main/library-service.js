'use strict';
// Business rules run synchronously in Electron main; SQLite owns persistence.
// The renderer keeps the existing LibraryDB signatures through a narrow IPC API.
const { randomUUID } = require('node:crypto');
const crypto = { randomUUID };

function createLibraryService(store, appendLog = () => {}) {
  const { books: _books, students: _students, transactions: _txns, finePayments: _finePayments, settings: _settings } = store.collections;
  let _actionHistory = [];
  let _pendingLogs = [];
  const MAX_HISTORY = 50;

  function _uid() {
    // Use crypto.randomUUID() for cryptographically secure IDs (fallback for older browsers)
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback: timestamp + random (less secure but functional)
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // Record action for undo history
  function _recordAction(action) {
    _actionHistory.push(action);
    if (_actionHistory.length > MAX_HISTORY) {
      _actionHistory.shift();
    }
  }

  /**
   * _logActivity(action, line)
   * Appends a human-readable line to the on-disk activity log via the
   * Electron main process (see main.js / preload.js). This is a durable
   * audit trail, independent of the SQLite database — it survives even
   * if the database is cleared, restored, or corrupted.
   *
   * Entries are flushed after the database transaction commits.
   */
  function _logActivity(action, details) {
    try {
      const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
      _pendingLogs.push(`[${ts}] ${action.padEnd(10, ' ')}| ${details}`);
    } catch (e) {
      // Never let logging failures affect the actual transaction.
      console.warn('[ActivityLog]', e.message);
    }
  }

  function _stripMeta(obj) {
    if (!obj) return null;
    const { $loki, meta, ...rest } = obj;
    return rest;
  }

  function _stripAll(arr) {
    return (arr || []).map(_stripMeta);
  }

  function _normalizeAccessNo(value) {
    return String(value || '').trim();
  }

  function _validateAccessNo(value) {
    const accessNo = _normalizeAccessNo(value);
    if (!accessNo) return { ok: false, msg: 'Book Access No is required.' };
    if (accessNo.length > 50) return { ok: false, msg: 'Book Access No is too long (max 50 chars).' };
    if (/[\u0000-\u001F\u007F<>"'`\\]/.test(accessNo)) {
      return { ok: false, msg: 'Book Access No contains unsupported characters.' };
    }
    return { ok: true, accessNo };
  }

  function _isValidEmail(value) {
    const email = String(value || '').trim();
    if (!email) return true;
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  /* ══════════════════════════════
     SETTINGS
  ══════════════════════════════ */
  function getSettings() {
    const s = _settings.findOne({});
    return s ? { fine_per_day: s.fine_per_day, loan_days: s.loan_days }
      : { fine_per_day: 2, loan_days: 14 };
  }

  function saveSettings(obj) {
    try {
      // Workstation PIN fields are controlled exclusively by main-process IPC.
      const allowed = {};
      if (Object.hasOwn(obj, 'fine_per_day')) allowed.fine_per_day = obj.fine_per_day;
      if (Object.hasOwn(obj, 'loan_days')) allowed.loan_days = obj.loan_days;
      const s = _settings.findOne({});
      if (s) { Object.assign(s, allowed); _settings.update(s); }
      else   { _settings.insert({ fine_per_day: 2, loan_days: 14, ...allowed }); }
  
      return { ok: true };
    } catch (e) {
      console.error('[Settings] Save failed:', e);
      return { ok: false, msg: 'Settings could not be saved: ' + e.message };
    }
  }

  function getRosterSyncCursor() {
    return Number(_settings.findOne({})?.roster_sync_cursor || 0);
  }

  function setRosterSyncCursor(value) {
    if (!Number.isSafeInteger(value) || value < 0) return { ok: false, msg: 'Invalid roster sync cursor.' };
    const row = _settings.findOne({});
    if (row) { row.roster_sync_cursor = Math.max(getRosterSyncCursor(), value); _settings.update(row); }
    else _settings.insert({ fine_per_day: 2, loan_days: 14, roster_sync_cursor: value });
    return { ok: true };
  }

  /* ══════════════════════════════
     BOOKS
  ══════════════════════════════ */
  function getBooks() {
    return _stripAll(_books.find());
  }

  function getBook(access_no) {
    return _stripMeta(_books.findOne({ access_no: _normalizeAccessNo(access_no) }));
  }

  function searchBooks(q) {
    q = q.toLowerCase();
    return _stripAll(_books.where(b =>
      (b.access_no  || '').toLowerCase().includes(q) ||
      (b.document   || '').toLowerCase().includes(q) ||
      (b.author     || '').toLowerCase().includes(q) ||
      (b.publisher  || '').toLowerCase().includes(q)
    ));
  }

  function addBook(b) {
    const accessCheck = _validateAccessNo(b.access_no);
    if (!accessCheck.ok) return accessCheck;
    b.access_no = accessCheck.accessNo;
    if (_books.findOne({ access_no: b.access_no }))
      return { ok: false, msg: `Access No "${b.access_no}" already exists.` };
    _books.insert({ ...b, status: 'Available' });

    return { ok: true };
  }

  function updateBookStatus(access_no, status) {
    access_no = _normalizeAccessNo(access_no);
    const b = _books.findOne({ access_no });
    if (!b) return false;
    b.status = status;
    _books.update(b);

    return true;
  }

  function importBooks(jsonStr) {
    try {
      let raw = JSON.parse(jsonStr);
      if (!Array.isArray(raw)) raw = [raw];
      if (raw.length === 0) return { ok: false, msg: 'File is empty.' };

      const first = raw[0];
      if (!(first.access_no || first.book_id) && !(first.document || first.title)) {
        return { ok: false, msg: 'JSON must have "access_no" or "book_id", and "document" or "title" fields.' };
      }

      const activeAccessNos = new Set(
        _txns.find({ status: 'Active' }).map(t => t.book_access_no)
      );

      // Validate all entries first
      const errors = [];
      raw.forEach((b, idx) => {
        const access_no = (b.access_no || b.book_id || '').toString().trim();
        const document = (b.document || b.title || '').trim();
        if (!access_no) errors.push(`Row ${idx + 1}: Missing access_no/book_id`);
        if (!document) errors.push(`Row ${idx + 1}: Missing document/title`);
        if (access_no.length > 50) errors.push(`Row ${idx + 1}: access_no too long (max 50 chars)`);
        if (/[\u0000-\u001F\u007F<>"'`\\]/.test(access_no)) errors.push(`Row ${idx + 1}: access_no contains unsupported characters`);
        if (document.length > 200) errors.push(`Row ${idx + 1}: document too long (max 200 chars)`);
        if (b.author && b.author.trim().length > 100) errors.push(`Row ${idx + 1}: author too long (max 100 chars)`);
        if (b.publisher && b.publisher.trim().length > 100) errors.push(`Row ${idx + 1}: publisher too long (max 100 chars)`);
      });
      if (errors.length) return { ok: false, msg: 'Validation errors: ' + errors.join('; ') };

      _books.clear({ removeIndices: false });

      raw.forEach(b => {
        const access_no = (b.access_no || b.book_id || '').toString().trim();
        const existing_status = activeAccessNos.has(access_no) ? 'Issued' : 'Available';
        _books.insert({
          access_no,
          document:  (b.document  || b.title   || '').trim().slice(0, 200),
          author:    (b.author    || '').trim().slice(0, 100),
          publisher: (b.publisher || '').trim().slice(0, 100),
          cost:      (b.cost      || '').toString().trim().slice(0, 20),
          pages:     (b.pages     || '').toString().trim().slice(0, 10),
          status:    b.status || existing_status,
        });
      });

  
      return { ok: true, count: raw.length };
    } catch (e) {
      return { ok: false, msg: 'Could not parse JSON: ' + e.message };
    }
  }

  /* ══════════════════════════════
     STUDENTS
  ══════════════════════════════ */
  const VALID_GROUPS = ['Regular', 'Literary Club', 'Editorial Board'];

  function getStudents() {
    return _stripAll(_students.find());
  }

  function getStudent(adm_no) {
    return _stripMeta(_students.findOne({ adm_no }));
  }

  function searchStudents(q) {
    q = q.toLowerCase();
    return _stripAll(_students.where(s =>
      (s.adm_no   || '').toLowerCase().includes(q) ||
      (s.name     || '').toLowerCase().includes(q) ||
      (s.class    || '').toLowerCase().includes(q) ||
      (s.section  || '').toLowerCase().includes(q) ||
      (s.roll_no  || '').toLowerCase().includes(q)
    ));
  }

  function addStudent(s) {
    if (_students.findOne({ adm_no: s.adm_no }))
      return { ok: false, msg: `Admission No "${s.adm_no}" already exists.` };
    if (!_isValidEmail(s.email)) return { ok: false, msg: 'Enter a valid student email address.' };
    const group = VALID_GROUPS.includes(s.group) ? s.group : 'Regular';
    _students.insert({
      adm_no:  (s.adm_no  || '').trim(),
      name:    (s.name    || '').trim(),
      class:   (s.class   || '').trim(),
      section: (s.section || '').trim(),
      roll_no: (s.roll_no || '').trim(),
      email:   (s.email || '').trim().toLowerCase(),
      group,
    });

    return { ok: true };
  }

  // Cloud authorization is an input to the local roster, never a replacement for
  // it. Match by either stable identifier and refuse ambiguous cross-matches.
  function upsertStudentFromCloud(record) {
    const email = String(record?.email || '').trim().toLowerCase();
    const adm_no = String(record?.adm_no || '').trim();
    const name = String(record?.name || '').trim();
    if (!email || !_isValidEmail(email) || !name || name.length > 100 || adm_no.length > 40 ||
        String(record.class || '').length > 20 || String(record.section || '').length > 10 ||
        String(record.roll_no || '').length > 20) {
      return { ok: false, msg: 'Cloud student is missing a valid email or name.' };
    }
    const byEmail = _students.where(s => String(s.email || '').trim().toLowerCase() === email)[0] || null;
    const byAdm = adm_no ? _students.findOne({ adm_no }) : null;
    if (byAdm?.email && String(byAdm.email).trim().toLowerCase() !== email) {
      return { ok: false, msg: `Admission number ${adm_no} is linked to another email.` };
    }
    if (byEmail && byAdm && byEmail.$loki !== byAdm.$loki) {
      return { ok: false, msg: `Cloud student ${email} conflicts with local admission number ${adm_no}.` };
    }
    const student = byEmail || byAdm;
    if (!student && !adm_no) {
      return { ok: false, skipped: true, msg: `No admission number is available for ${email}.` };
    }
    if (student && adm_no && student.adm_no !== adm_no && student.adm_no.startsWith('WEB-')) {
      const conflict = _students.findOne({ adm_no });
      if (conflict && conflict.$loki !== student.$loki) return { ok: false, msg: `Admission number ${adm_no} is already in use.` };
      const previous = student.adm_no;
      student.adm_no = adm_no;
      // The service transaction also moves existing circulation references.
      for (const txn of _txns.find({ student_adm_no: previous })) {
        txn.student_adm_no = adm_no;
        _txns.update(txn);
      }
    }
    const group = VALID_GROUPS.includes(record.group) ? record.group : 'Regular';
    if (student) {
      student.email = email;
      if (!student.name) student.name = name;
      student.group = group;
      for (const field of ['class', 'section', 'roll_no']) {
        if (!student[field] && typeof record[field] === 'string' && record[field].trim()) student[field] = record[field].trim();
      }
      student.cloud_synced = true;
      if (record.cloud_updated_at) student.cloud_updated_at = record.cloud_updated_at;
      _students.update(student);
      return { ok: true, created: false };
    }
    _students.insert({
      adm_no, email, name, group,
      class: String(record.class || '').trim(),
      section: String(record.section || '').trim(),
      roll_no: String(record.roll_no || '').trim(),
      cloud_synced: true, cloud_updated_at: record.cloud_updated_at || null,
    });
    return { ok: true, created: true };
  }

  function updateStudentGroup(adm_no, group) {
    const s = _students.findOne({ adm_no });
    if (!s) return { ok: false, msg: 'Student not found.' };
    s.group = VALID_GROUPS.includes(group) ? group : 'Regular';
    _students.update(s);

    return { ok: true };
  }

  function importStudents(jsonStr) {
    try {
      let raw = JSON.parse(jsonStr);
      if (!Array.isArray(raw)) raw = [raw];
      if (raw.length === 0) return { ok: false, msg: 'File is empty.' };

      const first = raw[0];
      if (!first.adm_no && !first.name) {
        return { ok: false, msg: 'JSON must have "adm_no" and "name" fields.' };
      }

      // Validate all entries first
      const errors = [];
      raw.forEach((s, idx) => {
        const adm_no = (s.adm_no || s.admission_no || s.admno || '').toString().trim();
        const name = (s.name || s.student_name || '').trim();
        if (!adm_no) errors.push(`Row ${idx + 1}: Missing adm_no`);
        if (!name) errors.push(`Row ${idx + 1}: Missing name`);
        if (adm_no.length > 40) errors.push(`Row ${idx + 1}: adm_no too long (max 40 chars)`);
        if (name.length > 100) errors.push(`Row ${idx + 1}: name too long (max 100 chars)`);
        if (s.class && s.class.toString().trim().length > 20) errors.push(`Row ${idx + 1}: class too long (max 20 chars)`);
        if (s.section && s.section.toString().trim().length > 10) errors.push(`Row ${idx + 1}: section too long (max 10 chars)`);
        if (s.roll_no && s.roll_no.toString().trim().length > 20) errors.push(`Row ${idx + 1}: roll_no too long (max 20 chars)`);
      });
      if (errors.length) return { ok: false, msg: 'Validation errors: ' + errors.join('; ') };

      _students.clear({ removeIndices: false });

      raw.forEach(s => {
        const rawGroup = (s.group || s.club || 'Regular').toString().trim();
        _students.insert({
          adm_no:  (s.adm_no  || s.admission_no || s.admno || '').toString().trim().slice(0, 40),
          name:    (s.name    || s.student_name || '').trim().slice(0, 100),
          class:   (s.class   || s.std          || '').toString().trim().slice(0, 20),
          section: (s.section || s.div          || '').trim().slice(0, 10),
          roll_no: (s.roll_no || s.rollno       || s.roll  || '').toString().trim().slice(0, 20),
          group:   VALID_GROUPS.includes(rawGroup) ? rawGroup : 'Regular',
          email:   (s.email || '').trim(),
        });
      });

  
      return { ok: true, count: raw.length };
    } catch (e) {
      return { ok: false, msg: 'Could not parse JSON: ' + e.message };
    }
  }

  /* ══════════════════════════════
     TRANSACTIONS
  ══════════════════════════════ */
  function getTransactions() {
    return _stripAll(_txns.find());
  }

  function issueBook(adm_no, access_no) {
    const accessCheck = _validateAccessNo(access_no);
    if (!accessCheck.ok) return accessCheck;
    access_no = accessCheck.accessNo;

    const student = getStudent(adm_no);
    if (!student) return { ok: false, msg: `Student ADM No "${adm_no}" not found.` };

    const book = getBook(access_no);
    if (!book)   return { ok: false, msg: `Book Access No "${access_no}" not found.` };
    if (book.status !== 'Available')
      return { ok: false, msg: `Book is currently "${book.status}" and cannot be issued.` };

    const settings = getSettings();
    const today    = new Date();
    const due      = new Date(today);
    due.setDate(due.getDate() + settings.loan_days);

    const txn = {
      transaction_id:  'TXN-' + _uid(),
      borrower_type:   'student',
      student_adm_no:  adm_no,
      teacher_name:    null,
      teacher_email:   null,
      book_access_no:  access_no,
      issue_date:      today.toISOString().split('T')[0],
      due_date:        due.toISOString().split('T')[0],
      return_date:     null,
      fine:            0,
      damage_reported: false,
      status:          'Active',
    };

    _txns.insert(txn);
    updateBookStatus(access_no, 'Issued');


    // Record action for undo history
    _recordAction({
      type: 'issue',
      transaction_id: txn.transaction_id,
      book_access_no: access_no,
      previous_book_status: 'Available',
      timestamp: Date.now()
    });

    _logActivity('ISSUE', `Book: ${book.document} [${access_no}] | Student: ${student.name} (${adm_no}) | Due: ${txn.due_date}`);
    return { ok: true, txn: _stripMeta(_txns.findOne({ transaction_id: txn.transaction_id })), student, book, due_date: txn.due_date };
  }

  /**
   * issueBookToTeacher(teacherName, teacherEmail, access_no)
   * Issues a book to a staff member. Teacher loans have NO due date —
   * open-ended until manually returned, and never accrue a fine.
   */
  function issueBookToTeacher(teacherName, teacherEmail, access_no) {
    const name = (teacherName || '').trim();
    if (!name) return { ok: false, msg: 'Teacher name is required.' };
    const email = (teacherEmail || '').trim();
    if (!_isValidEmail(email)) return { ok: false, msg: 'Enter a valid teacher email address.' };

    const accessCheck = _validateAccessNo(access_no);
    if (!accessCheck.ok) return accessCheck;
    access_no = accessCheck.accessNo;

    const book = getBook(access_no);
    if (!book) return { ok: false, msg: `Book Access No "${access_no}" not found.` };
    if (book.status !== 'Available')
      return { ok: false, msg: `Book is currently "${book.status}" and cannot be issued.` };

    const today = new Date();

    const txn = {
      transaction_id:  'TXN-' + _uid(),
      borrower_type:   'teacher',
      student_adm_no:  null,
      teacher_name:    name,
      teacher_email:   email,
      book_access_no:  access_no,
      issue_date:      today.toISOString().split('T')[0],
      due_date:        null,   // no due date for teacher loans
      return_date:     null,
      fine:            0,
      damage_reported: false,
      status:          'Active',
    };

    _txns.insert(txn);
    updateBookStatus(access_no, 'Issued');


    // Record action for undo history
    _recordAction({
      type: 'issue_teacher',
      transaction_id: txn.transaction_id,
      book_access_no: access_no,
      previous_book_status: 'Available',
      timestamp: Date.now()
    });

    _logActivity('ISSUE_STAFF', `Book: ${book.document} [${access_no}] | Teacher: ${name}${txn.teacher_email ? ' (' + txn.teacher_email + ')' : ''} | No due date`);
    return { ok: true, txn: _stripMeta(_txns.findOne({ transaction_id: txn.transaction_id })), teacherName: name, teacherEmail: txn.teacher_email, book };
  }

  function returnBook(access_no) {
    const accessCheck = _validateAccessNo(access_no);
    if (!accessCheck.ok) return accessCheck;
    access_no = accessCheck.accessNo;

    const book = getBook(access_no);
    if (!book)                      return { ok: false, msg: `Book Access No "${access_no}" not found.` };
    if (book.status === 'Available') return { ok: false, msg: 'This book has not been issued.' };

    const txnDoc = _txns.findOne({ book_access_no: access_no, status: 'Active' });
    if (!txnDoc) return { ok: false, msg: 'No active transaction found for this book.' };

    const isTeacherLoan = txnDoc.borrower_type === 'teacher';
    const student  = isTeacherLoan ? null : getStudent(txnDoc.student_adm_no);
    const settings = getSettings();
    const today    = new Date();
    let fine = 0, lateDays = 0;

    // Teacher loans have no due date, so they can never accrue a fine.
    if (!isTeacherLoan && txnDoc.due_date) {
      const due = new Date(txnDoc.due_date);
      if (today > due) {
        lateDays = Math.ceil((today - due) / (1000*60*60*24));
        fine     = lateDays * settings.fine_per_day;
      }
    }

    txnDoc.return_date = today.toISOString().split('T')[0];
    txnDoc.fine        = fine;
    txnDoc.status      = fine > 0 ? 'FinePending' : 'Returned';
    _txns.update(txnDoc);
    updateBookStatus(access_no, 'Available');


    // Record action for undo history
    _recordAction({
      type: 'return',
      transaction_id: txnDoc.transaction_id,
      book_access_no: access_no,
      previous_book_status: 'Issued',
      previous_txn_status: 'Active',
      previous_txn_fine: 0,
      previous_txn_return_date: null,
      fine,
      timestamp: Date.now()
    });

    if (isTeacherLoan) {
      _logActivity('RETURN_STAFF', `Book: ${book.document} [${access_no}] | Teacher: ${txnDoc.teacher_name}`);
    } else {
      const fineNote = fine > 0 ? ` | Fine: ₹${fine} (${lateDays} days late)` : ' | On time, no fine';
      _logActivity('RETURN', `Book: ${book.document} [${access_no}] | Student: ${student ? student.name : txnDoc.student_adm_no} (${txnDoc.student_adm_no})${fineNote}`);
    }

    return {
      ok: true,
      txn: _stripMeta(txnDoc),
      student,
      teacherName:  isTeacherLoan ? txnDoc.teacher_name  : null,
      teacherEmail: isTeacherLoan ? txnDoc.teacher_email : null,
      borrowerType: txnDoc.borrower_type || 'student',
      book, fine, lateDays,
    };
  }

  function getActiveTxnForBook(access_no) {
    return _stripMeta(_txns.findOne({ book_access_no: access_no, status: 'Active' }));
  }

  function getActiveTransactions() {
    return _stripAll(_txns.find({ status: 'Active' }));
  }

  function getOverdueTransactions() {
    const todayStr = new Date().toISOString().split('T')[0];
    // Teacher loans (due_date null) can never be overdue.
    return _stripAll(_txns.where(t => t.status === 'Active' && !!t.due_date && t.due_date < todayStr));
  }

  function getReturnedToday() {
    const todayStr = new Date().toISOString().split('T')[0];
    return _stripAll(_txns.where(t => t.return_date === todayStr));
  }

  function getPendingFines() {
    return _stripAll(_txns.find({ status: 'FinePending' }));
  }

  /* ══════════════════════════════
     FINE PAYMENTS  (collected fines log)
  ══════════════════════════════ */
  function markFinePaid(transaction_id) {
    const t = _txns.findOne({ transaction_id });
    if (!t || t.status !== 'FinePending') return false;

    const amount = t.fine || 0;

    // Log the collection event before clearing status
    _finePayments.insert({
      payment_id:     'PMT-' + _uid(),
      transaction_id: t.transaction_id,
      student_adm_no: t.student_adm_no,
      book_access_no: t.book_access_no,
      amount,
      paid_date:      new Date().toISOString().split('T')[0],
      paid_at:        new Date().toISOString(),
    });

    // Record action for undo history
    _recordAction({
      type: 'fine_paid',
      transaction_id: t.transaction_id,
      book_access_no: t.book_access_no,
      student_adm_no: t.student_adm_no,
      fine_amount: t.fine,
      previous_txn_status: t.status,
      timestamp: Date.now()
    });

    t.status = 'Returned';
    _txns.update(t);


    const student = getStudent(t.student_adm_no);
    _logActivity('FINE_PAID', `Student: ${student ? student.name : t.student_adm_no} (${t.student_adm_no}) | Book: ${t.book_access_no} | Amount: ₹${amount}`);

    return true;
  }

  function getFinePayments() {
    return _stripAll(_finePayments.find());
  }

  function getTotalCollected() {
    return _finePayments.find().reduce((s, p) => s + (p.amount || 0), 0);
  }

  function getCollectedToday() {
    const todayStr = new Date().toISOString().split('T')[0];
    const rows = _finePayments.find({ paid_date: todayStr });
    return { count: rows.length, amount: rows.reduce((s, p) => s + (p.amount || 0), 0) };
  }

  function reportDamage(access_no, desc, severity, responsible_adm_no, notes) {
    const accessCheck = _validateAccessNo(access_no);
    if (!accessCheck.ok) return accessCheck;
    access_no = accessCheck.accessNo;

    const book = getBook(access_no);
    if (!book) return { ok: false, msg: 'Book not found.' };
    const statusMap = { 'Minor Damage':'Damaged', 'Repair Needed':'Under Repair', 'Unusable':'Lost' };
    const newStatus = statusMap[severity] || 'Damaged';
    const prevStatus = book.status;
    updateBookStatus(access_no, newStatus);

    const txnDoc = _txns.findOne({ book_access_no: access_no, status: { $in: ['Active','Returned'] } });
    if (txnDoc) {
      txnDoc.damage_reported  = true;
      txnDoc.damage_desc      = desc;
      txnDoc.damage_severity  = severity;
      txnDoc.repair_notes     = notes;
      if (responsible_adm_no) txnDoc.responsible = responsible_adm_no;
      _txns.update(txnDoc);
  
    }

    // Record action for undo history
    _recordAction({
      type: 'damage',
      book_access_no: access_no,
      previous_book_status: prevStatus,
      severity,
      desc,
      timestamp: Date.now()
    });

    _logActivity('DAMAGE', `Book: ${book.document} [${access_no}] | Severity: ${severity} | Status set to: ${newStatus} | Note: ${desc}`);

    return { ok: true, book };
  }

  function restoreBook(access_no, notes) {
    const accessCheck = _validateAccessNo(access_no);
    if (!accessCheck.ok) return accessCheck;
    access_no = accessCheck.accessNo;

    const book = getBook(access_no);
    if (!book) return { ok: false, msg: 'Book not found.' };
    const restorable = ['Damaged','Under Repair','Lost'];
    if (!restorable.includes(book.status))
      return { ok: false, msg: `Book is "${book.status}" — only Damaged, Under Repair, or Lost can be restored.` };

    const prevStatus = book.status;
    updateBookStatus(access_no, 'Available');

    const restoreTxn = {
      transaction_id:   'RST-' + _uid(),
      borrower_type:    'system',
      student_adm_no:   null,
      teacher_name:     null,
      teacher_email:    null,
      book_access_no:   access_no,
      issue_date:       new Date().toISOString().split('T')[0],
      due_date:         null,
      return_date:      new Date().toISOString().split('T')[0],
      fine:             0,
      damage_reported:  false,
      status:           'Returned',
      restoration_note: notes || '',
      restored_from:    prevStatus,
    };
    _txns.insert(restoreTxn);


    // Record action for undo history
    _recordAction({
      type: 'restore',
      transaction_id: restoreTxn.transaction_id,
      book_access_no: access_no,
      previous_book_status: prevStatus,
      timestamp: Date.now()
    });

    _logActivity('RESTORE', `Book: ${book.document} [${access_no}] | Restored from: ${prevStatus} → Available${notes ? ' | Note: ' + notes : ''}`);

    return { ok: true, book, prevStatus };
  }

  function undoLastTransaction() {
    // Use action history if available, fallback to transaction-based undo
    if (_actionHistory.length > 0) {
      const lastAction = _actionHistory.pop();
      return _undoAction(lastAction);
    }

    // Fallback: original transaction-based undo
    const all = _txns.find().sort((a,b) => (b.$loki||0)-(a.$loki||0));
    if (!all.length) return { ok: false, msg: 'No transactions to undo.' };

    const last    = all[0];
    const lastDoc = _txns.findOne({ transaction_id: last.transaction_id });
    if (!lastDoc) return { ok: false, msg: 'Transaction not found.' };
    _txns.remove(lastDoc);

    const book = getBook(last.book_access_no);
    if (book) {
      updateBookStatus(last.book_access_no, last.return_date ? 'Issued' : 'Available');
    }


    _logActivity('UNDO', `Reverted transaction: ${last.transaction_id} | Book: ${last.book_access_no} | Student: ${last.student_adm_no || '—'}`);
    return { ok: true, txn: last };
  }

  // Undo a specific action from history
  function _undoAction(action) {
    switch (action.type) {
      case 'issue_teacher':
      case 'issue':
        // Remove the transaction and set book back to Available
        const txnDoc = _txns.findOne({ transaction_id: action.transaction_id });
        if (txnDoc) {
          _txns.remove(txnDoc);
          updateBookStatus(action.book_access_no, 'Available');
        }
    
        _logActivity('UNDO', `Reverted issue: ${action.transaction_id} | Book: ${action.book_access_no}`);
        return { ok: true, type: 'issue', transaction_id: action.transaction_id };

      case 'return': {
        const returned = _txns.findOne({ transaction_id: action.transaction_id });
        if (!returned) return { ok: false, msg: 'Transaction not found.' };
        returned.status = action.previous_txn_status;
        returned.fine = action.previous_txn_fine;
        returned.return_date = action.previous_txn_return_date;
        _txns.update(returned);
        updateBookStatus(action.book_access_no, action.previous_book_status);
        _logActivity('UNDO', `Reverted return: ${action.transaction_id}`);
        return { ok: true, type: 'return', transaction_id: action.transaction_id };
      }
      case 'fine_paid':
        // Restore the transaction to FinePending status and remove the payment
        const ft = _txns.findOne({ transaction_id: action.transaction_id });
        if (ft) {
          ft.status = 'FinePending';
          _txns.update(ft);
        }
        // Remove the payment record
        const payment = _finePayments.findOne({ transaction_id: action.transaction_id });
        if (payment) {
          _finePayments.remove(payment);
        }
    
        _logActivity('UNDO', `Reverted fine payment: ${action.transaction_id} | Book: ${action.book_access_no}`);
        return { ok: true, type: 'fine_paid', transaction_id: action.transaction_id };

      case 'damage':
        // Restore book to previous status
        updateBookStatus(action.book_access_no, action.previous_book_status);
    
        _logActivity('UNDO', `Reverted damage report: ${action.book_access_no} | Previous status: ${action.previous_book_status}`);
        return { ok: true, type: 'damage', book_access_no: action.book_access_no };

      case 'restore':
        // Set book back to the damaged status
        updateBookStatus(action.book_access_no, action.previous_book_status);
        // Remove the restoration transaction
        const rstTxn = action.transaction_id
          ? _txns.findOne({ transaction_id: action.transaction_id })
          : _txns
              .find({ book_access_no: action.book_access_no })
              .filter(t => /^RST-/.test(t.transaction_id || ''))
              .sort((a, b) => (b.$loki || 0) - (a.$loki || 0))[0];
        if (rstTxn) _txns.remove(rstTxn);
    
        _logActivity('UNDO', `Reverted restore: ${action.book_access_no} | Previous status: ${action.previous_book_status}`);
        return { ok: true, type: 'restore', book_access_no: action.book_access_no };

      default:
        return { ok: false, msg: 'Unknown action type for undo' };
    }
  }

  /* ══════════════════════════════
     BACKUP / RESTORE (full DB)
  ══════════════════════════════ */
  function exportData() {
    return JSON.stringify({
      books: getBooks(), students: getStudents(), transactions: getTransactions(),
      finePayments: getFinePayments(), settings: getSettings(),
      backup_date: new Date().toISOString(), format: 'tomeva-v2',
    }, null, 2);
  }

  function restoreData(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      if (data.format !== 'tomeva-v2') {
        return { ok: false, msg: 'Unrecognised backup format. Use a Tomeva backup file.' };
      }

      // Validate data structure before restoring
      const errors = [];
      if (data.books && !Array.isArray(data.books)) errors.push('books must be an array');
      if (data.students && !Array.isArray(data.students)) errors.push('students must be an array');
      if (data.transactions && !Array.isArray(data.transactions)) errors.push('transactions must be an array');
      if (data.finePayments && !Array.isArray(data.finePayments)) errors.push('finePayments must be an array');
      if (data.settings && typeof data.settings !== 'object') errors.push('settings must be an object');

      if (errors.length) {
        return { ok: false, msg: 'Invalid backup data: ' + errors.join(', ') };
      }

      // Restore with validation
      if (data.books) {
        _books.clear();
        data.books.forEach(b => {
          // Ensure required fields exist
          if (!b.access_no || !b.document) throw new Error('Every book needs access_no and document.');
          _books.insert(b);
        });
      }
      if (data.students) {
        _students.clear();
        data.students.forEach(s => {
          if (!s.adm_no || !s.name) throw new Error('Every student needs adm_no and name.');
          _students.insert(s);
        });
      }
      if (data.transactions) {
        _txns.clear();
        data.transactions.forEach(t => _txns.insert(t));
      }
      if (data.finePayments) {
        _finePayments.clear();
        data.finePayments.forEach(p => _finePayments.insert(p));
      }
      if (data.settings) {
        const saved = saveSettings(data.settings);
        if (!saved.ok) throw new Error(saved.msg);
      }

  
      return { ok: true };
    } catch(e) {
      return { ok: false, msg: 'Could not parse backup: ' + e.message };
    }
  }

  /* ══════════════════════════════
     COMPATIBILITY SHIMS
  ══════════════════════════════ */
  function getStudentByAdmNo(adm_no) { return getStudent(adm_no); }

  function studentDisplayName(s) {
    if (!s) return '—';
    return `${s.name} (${s.adm_no})`;
  }

  function bookDisplayTitle(b) {
    if (!b) return '—';
    return `${b.document} [${b.access_no}]`;
  }

  /* ══════════════════════════════
     DATE UTILS
  ══════════════════════════════ */
  function calcLateDays(due_date) {
    if (!due_date) return 0; // Teacher loans have no due date — never "late"
    const today = new Date();
    const due   = new Date(due_date);
    if (today <= due) return 0;
    return Math.ceil((today - due) / (1000*60*60*24));
  }

  function formatDate(str) {
    if (!str) return '—';
    return new Date(str).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  }

/* ══════════════════════════════
     PUBLIC API
   ══════════════════════════════ */
  const api = {

    getSettings, saveSettings, getRosterSyncCursor, setRosterSyncCursor,

    getBooks, getBook, searchBooks, addBook, updateBookStatus,
    importBooks,

    getStudents, getStudent, getStudentByAdmNo, searchStudents, addStudent,
    upsertStudentFromCloud,
    updateStudentGroup, importStudents, studentDisplayName, bookDisplayTitle,
    VALID_GROUPS,

    getTransactions, issueBook, issueBookToTeacher, returnBook,
    getActiveTxnForBook, getActiveTransactions,
    getOverdueTransactions, getReturnedToday,
    getPendingFines, markFinePaid,
    getFinePayments, getTotalCollected, getCollectedToday,
    reportDamage, restoreBook,
    undoLastTransaction,
    undoAction: _undoAction,

    exportData, restoreData,

    calcLateDays, formatDate,

    hasBooks:    () => _books.count() > 0,
    hasStudents: () => _students.count() > 0,
    isEmpty:     () => _books.count() === 0 && _students.count() === 0,
  };
  const mutations = [
    'saveSettings', 'setRosterSyncCursor', 'addBook', 'updateBookStatus', 'importBooks', 'addStudent',
    'updateStudentGroup', 'importStudents', 'upsertStudentFromCloud', 'issueBook', 'issueBookToTeacher',
    'returnBook', 'markFinePaid', 'reportDamage', 'restoreBook',
    'undoLastTransaction', 'undoAction', 'restoreData',
  ];
  for (const name of mutations) {
    const operation = api[name];
    api[name] = (...args) => {
      const historyBefore = JSON.parse(JSON.stringify(_actionHistory));
      _pendingLogs = [];
      try {
        const result = store.transaction(() => {
          const result = operation(...args);
          if (result === false || result?.ok === false) throw { operationResult: result };
          return result;
        });
        for (const line of _pendingLogs) {
          try { appendLog(line); } catch (error) { console.warn('[ActivityLog]', error.message); }
        }
        return result;
      } catch (error) {
        _actionHistory = historyBefore;
        if (Object.hasOwn(error, 'operationResult')) return error.operationResult;
        if (name === 'updateBookStatus' || name === 'markFinePaid') return false;
        return { ok: false, msg: 'Database change was rolled back: ' + error.message };
      } finally { _pendingLogs = []; }
    };
  }
  return api;
}
module.exports = { createLibraryService };

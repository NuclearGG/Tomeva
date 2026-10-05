/**
 * app.js — Tomeva Library Management System
 * Depends on: lokijs (CDN), db.js (LibraryDB), firebase-sync.js (FirebaseSync)
 *
 * Boot order guaranteed by index.html script tags:
 *   lokijs → db.js → firebase-sync.js → app.js
 *
 * LibraryDB.onReady() is the single gate — nothing touches the DB before it fires.
 */

'use strict';

function showInstitutionConnection() {
  if (document.getElementById('institution-connect-overlay')) return;
  var overlay = document.createElement('div');
  overlay.id = 'institution-connect-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(20,26,31,.72);z-index:100000;display:grid;place-items:center;padding:24px';
  var panel = document.createElement('section');
  panel.style.cssText = 'width:min(620px,100%);background:#fffdf8;border-radius:18px;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.25)';
  var heading = document.createElement('h2'); heading.textContent = 'Connect this Librarian app';
  var detail = document.createElement('p'); detail.textContent = 'Enter your institution’s public Student Portal address. No Tomeva login is required. You may continue offline or import institution.json later from the File menu.';
  var form = document.createElement('form'); form.style.cssText = 'display:grid;gap:12px;margin-top:18px';
  var input = document.createElement('input'); input.type = 'url'; input.required = true; input.autocomplete = 'url'; input.placeholder = 'https://your-school.web.app/'; input.setAttribute('aria-label', 'Institution Student Portal URL');
  var actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap';
  var connect = document.createElement('button'); connect.type = 'submit'; connect.className = 'btn btn-primary'; connect.textContent = 'Connect institution';
  var offline = document.createElement('button'); offline.type = 'button'; offline.className = 'btn btn-ghost'; offline.textContent = 'Continue offline';
  var status = document.createElement('p'); status.setAttribute('role', 'status');
  actions.append(connect, offline); form.append(input, actions, status); panel.append(heading, detail, form); overlay.appendChild(panel); document.body.appendChild(overlay);
  offline.addEventListener('click', function() { overlay.remove(); });
  form.addEventListener('submit', async function(event) {
    event.preventDefault(); connect.disabled = true; status.textContent = 'Checking public institution setup…';
    try {
      var connected = await window.electronAPI.connectInstitution(input.value);
      status.textContent = 'Connected to ' + (connected.institutionName || connected.firebase.projectId) + '. Reloading…';
      location.reload();
    } catch (error) { status.textContent = error.message; connect.disabled = false; }
  });
}

// Public setup is optional for local circulation and never delays the database.
window.electronAPI?.getInstitution?.().then(config => {
  document.querySelectorAll('[data-institution-name]').forEach(element => {
    element.textContent = config?.institutionName || 'Library Management';
  });
  const field = document.getElementById('issue-teacher-email');
  if (field && config?.staffDomain) field.placeholder = 'e.g. teacher@' + config.staffDomain;
  if (!config?.firebase) showInstitutionConnection();
}).catch(error => console.warn('Institution display settings unavailable:', error.message));

/* ══════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════ */
function showToast(msg, type, duration) {
  type     = type     || 'default';
  duration = duration || 3200;
  var icons = { success:'✅', error:'❌', warning:'⚠️', default:'ℹ️' };
  var c = document.getElementById('toast-container');
  if (!c) return;
  var t = document.createElement('div');
  t.className = 'toast ' + type;
  var icon = document.createElement('span');
  icon.textContent = icons[type] || 'ℹ️';
  var text = document.createElement('span');
  text.textContent = String(msg || '');
  t.append(icon, text);
  c.appendChild(t);
  setTimeout(function() {
    t.style.cssText = 'opacity:0;transform:translateX(20px);transition:0.3s ease';
    setTimeout(function() { t.remove(); }, 320);
  }, duration);
}

/* ══════════════════════════════════════════════
   ROUTER  (single definition — no override needed)
══════════════════════════════════════════════ */
function navigate(page) {
  document.querySelectorAll('.page-view').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function(n)  { n.classList.remove('active'); });

  var view = document.getElementById('page-' + page);
  var nav  = document.querySelector('[data-page="' + page + '"]');
  if (view) view.classList.add('active');
  if (nav)  nav.classList.add('active');

  var titles = {
    dashboard:     ['Dashboard',      'Overview of library activity'],
    issue:         ['Issue Book',     'Lend a book to a student'],
    return:        ['Return Book',    'Process a returned book'],
    fines:         ['Fines',          'Manage overdue fines'],
    damage:        ['Report Damage',  'Record a damaged book'],
    search:        ['Search',         'Find books, students, transactions'],
    records:       ['Records',        'Full library activity history'],
    books:         ['Book Catalogue', 'All books in the library'],
    students:      ['Students',       'Manage student records'],
    notifications: ['Notifications',  'Messages between librarian and admin'],
    requests:      ['Book Requests',  'Student requests needing review'],
    settings:      ['Settings',       'System configuration & backup'],
  };
  var pair  = titles[page] || ['Library', ''];
  var h2    = document.querySelector('.page-title-area h2');
  var psub  = document.querySelector('.page-title-area p');
  if (h2)   h2.textContent   = pair[0];
  if (psub) psub.textContent = pair[1];

  /* page-specific renders */
  if (page === 'dashboard')     { if (!_checkOnboarding()) _renderDashboard(); }
  if (page === 'fines')         { _currentFinesTab = 'pending'; _renderFines(); }
  if (page === 'requests')      _renderRequests();
  if (page === 'records')       _renderRecords();
  if (page === 'books')         _renderBookCatalogue();
  if (page === 'students')      _renderStudents();
  if (page === 'notifications') { FirebaseSync.renderSentNotifications(); _loadIncomingNotifications(); }
  if (page === 'settings')      { setTimeout(_renderSyncStats, 80); setTimeout(refreshActivityLog, 80); }
  if (page === 'return')        { setTimeout(_loadCurrentlyIssued, 50); }
  if (page === 'damage')        { setTimeout(_renderDamagedList, 50); }
}

/* expose globally for HTML onclick attributes */
window.navigate = navigate;

/* ══════════════════════════════════════════════
   ONBOARDING
══════════════════════════════════════════════ */
function _checkOnboarding() {
  var noBooks    = !LibraryDB.hasBooks();
  var noStudents = !LibraryDB.hasStudents();
  if (noBooks || noStudents) {
    _showSetupScreen(noBooks, noStudents);
    return true;
  }
  return false;
}

function _showSetupScreen(noBooks, noStudents) {
  var overlay = document.getElementById('setup-overlay');
  if (!overlay) return;

  _refreshSetupCounts();

  var bookStep    = document.getElementById('setup-step-books');
  var studentStep = document.getElementById('setup-step-students');
  var bookDone    = document.getElementById('setup-books-done');
  var studentDone = document.getElementById('setup-students-done');

  if (bookStep)    bookStep.classList.toggle('step-done',    !noBooks);
  if (studentStep) studentStep.classList.toggle('step-done', !noStudents);
  if (bookDone)    bookDone.style.display    = noBooks    ? 'none' : 'flex';
  if (studentDone) studentDone.style.display = noStudents ? 'none' : 'flex';

  overlay.style.display = 'flex';
  requestAnimationFrame(function() { overlay.classList.add('visible'); });
}

function _hideSetupScreen() {
  var overlay = document.getElementById('setup-overlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  setTimeout(function() { overlay.style.display = 'none'; }, 350);
}

function _refreshSetupCounts() {
  var bc = document.getElementById('setup-book-count');
  var sc = document.getElementById('setup-student-count');
  if (bc) bc.textContent = LibraryDB.getBooks().length    + ' books';
  if (sc) sc.textContent = LibraryDB.getStudents().length + ' students';
}

function checkSetupComplete() {
  var noBooks    = !LibraryDB.hasBooks();
  var noStudents = !LibraryDB.hasStudents();

  _refreshSetupCounts();

  var bookStep    = document.getElementById('setup-step-books');
  var studentStep = document.getElementById('setup-step-students');
  var bookDone    = document.getElementById('setup-books-done');
  var studentDone = document.getElementById('setup-students-done');

  if (bookStep)    bookStep.classList.toggle('step-done',    !noBooks);
  if (studentStep) studentStep.classList.toggle('step-done', !noStudents);
  if (bookDone)    bookDone.style.display    = noBooks    ? 'none' : 'flex';
  if (studentDone) studentDone.style.display = noStudents ? 'none' : 'flex';

  if (!noBooks && !noStudents) {
    setTimeout(function() {
      _hideSetupScreen();
      showToast('Setup complete! Welcome to Tomeva 📖', 'success', 4000);
      _renderDashboard();
    }, 600);
  }
}
window.checkSetupComplete = checkSetupComplete;

/* ══════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════ */
function _renderDashboard() {
  var active        = LibraryDB.getActiveTransactions();
  var overdue       = LibraryDB.getOverdueTransactions();
  var returnedToday = LibraryDB.getReturnedToday();
  var fines         = LibraryDB.getPendingFines();
  var settings      = LibraryDB.getSettings();

  _setText('stat-issued',   active.length);
  _setText('stat-overdue',  overdue.length);
  _setText('stat-returned', returnedToday.length);
  _setText('stat-fines',    '₹' + fines.reduce(function(s,f){ return s + f.fine; }, 0));

  /* overdue list */
  var overdueEl = document.getElementById('overdue-list');
  if (overdueEl) {
    if (!overdue.length) {
      overdueEl.innerHTML = '<div class="empty-state"><span class="empty-icon">🎉</span><h4>No overdue books</h4><p>All issued books are within their due dates.</p></div>';
    } else {
      overdueEl.innerHTML = overdue.map(function(txn) {
        var student = LibraryDB.getStudent(txn.student_adm_no);
        var book    = LibraryDB.getBook(txn.book_access_no);
        var days    = LibraryDB.calcLateDays(txn.due_date);
        var fine    = days * settings.fine_per_day;
        return '<div class="search-result-item row-overdue" onclick="navigate(\'return\')">'
          + '<div class="sr-left"><h4>' + _esc(book ? book.document : txn.book_access_no) + '</h4>'
          + '<p>' + txn.book_access_no + ' · ' + _esc(student ? student.name : txn.student_adm_no) + '</p></div>'
          + '<div style="text-align:right"><div class="overdue-chip">⏰ ' + days + ' days late</div>'
          + '<div class="fine-amount mt-4">₹' + fine + '</div></div></div>';
      }).join('');
    }
  }

  /* recent activity */
  var recentEl = document.getElementById('recent-list');
  if (recentEl) {
    var all = LibraryDB.getTransactions().slice().reverse().slice(0, 8);
    if (!all.length) {
      recentEl.innerHTML = '<div class="empty-state"><span class="empty-icon">📚</span><h4>No activity yet</h4><p>Issue your first book to get started.</p></div>';
    } else {
      var badges = { Active:'<span class="badge badge-blue">Active</span>', Returned:'<span class="badge badge-green">Returned</span>', FinePending:'<span class="badge badge-coral">Fine Due</span>' };
      recentEl.innerHTML = '<table><thead><tr><th>Book</th><th>Borrower</th><th>Issued</th><th>Due</th><th>Status</th></tr></thead><tbody>'
        + all.map(function(txn) {
            var book = LibraryDB.getBook(txn.book_access_no);
            var b    = _borrowerCell(txn);
            return '<tr><td><strong>' + _esc(book ? book.document : txn.book_access_no) + '</strong><br><span class="td-id">' + txn.book_access_no + '</span></td>'
              + '<td>' + _esc(b.name) + '<br><span class="td-id">' + _esc(b.sub) + '</span></td>'
              + '<td>' + LibraryDB.formatDate(txn.issue_date) + '</td>'
              + '<td>' + _dueDateCell(txn) + '</td>'
              + '<td>' + (badges[txn.status] || '<span class="badge badge-gray">' + txn.status + '</span>') + '</td></tr>';
          }).join('')
        + '</tbody></table>';
    }
  }
}

/* ══════════════════════════════════════════════
   ISSUE BOOK
══════════════════════════════════════════════ */
var _issueMode = 'student'; // 'student' | 'teacher'

window.setIssueMode = function(mode) {
  _issueMode = mode;

  var studentBtn  = document.getElementById('issue-mode-student-btn');
  var teacherBtn   = document.getElementById('issue-mode-teacher-btn');
  var studentForm = document.getElementById('issue-form-student');
  var teacherForm = document.getElementById('issue-form-teacher');
  var card        = document.getElementById('issue-card');
  var issueBtn    = document.getElementById('issue-btn');
  var titleEl     = document.getElementById('issue-card-title');
  var subEl       = document.getElementById('issue-card-subtitle');
  var infoCard    = document.getElementById('issue-info-card');
  var infoTitle   = document.getElementById('issue-info-title');
  var infoSteps   = document.getElementById('issue-info-steps');
  var infoTerms   = document.getElementById('issue-info-terms');
  var lookupCard  = document.getElementById('quick-lookup-card');

  // Clear any previous result box when switching modes
  var resultBox = document.getElementById('issue-result');
  if (resultBox) { resultBox.className = 'result-box'; resultBox.innerHTML = ''; }

  if (mode === 'teacher') {
    studentBtn.classList.remove('active');
    teacherBtn.classList.add('active', 'teacher-active');
    studentForm.style.display = 'none';
    teacherForm.style.display = 'block';
    if (lookupCard) lookupCard.style.display = 'none';

    card.classList.add('issue-teacher-mode');
    issueBtn.className = 'btn btn-full btn-lg';
    issueBtn.style.background = 'var(--purple-dark)';
    issueBtn.style.color = 'white';
    issueBtn.textContent = '📤 Issue to Teacher';

    titleEl.textContent = '📤 Issue a Book — Staff';
    subEl.textContent = 'Enter teacher and book details';

    infoCard.style.background = 'var(--purple)';
    infoCard.style.borderColor = 'var(--purple-mid)';
    infoTitle.style.color = 'var(--purple-dark)';
    infoTitle.textContent = 'How to Issue — Staff';
    infoSteps.innerHTML =
      '<li>Enter the <strong>Teacher\'s Name</strong></li>' +
      '<li>Email is optional, for reference only</li>' +
      '<li>Enter the <strong>Access No</strong> (from inside book cover)</li>' +
      '<li>Click <strong>Issue to Teacher</strong></li>';
    infoTerms.innerHTML =
      '<strong style="color:var(--purple-dark)">Due Date:</strong> None — open until returned<br>' +
      '<strong style="color:var(--purple-dark)">Fine:</strong> Never applies to staff loans';

  } else {
    teacherBtn.classList.remove('active', 'teacher-active');
    studentBtn.classList.add('active');
    studentForm.style.display = 'block';
    teacherForm.style.display = 'none';
    if (lookupCard) lookupCard.style.display = 'block';

    card.classList.remove('issue-teacher-mode');
    issueBtn.className = 'btn btn-blue btn-full btn-lg';
    issueBtn.style.background = '';
    issueBtn.style.color = '';
    issueBtn.textContent = '📤 Issue Book';

    titleEl.textContent = '📤 Issue a Book';
    subEl.textContent = 'Enter student and book details';

    infoCard.style.background = 'var(--blue)';
    infoCard.style.borderColor = 'var(--blue-mid)';
    infoTitle.style.color = 'var(--blue-dark)';
    infoTitle.textContent = 'How to Issue';
    infoSteps.innerHTML =
      '<li>Enter the <strong>ADM No</strong> (from student card)</li>' +
      '<li>Enter the <strong>Access No</strong> (from inside book cover)</li>' +
      '<li>Verify the name shown below the field</li>' +
      '<li>Click <strong>Issue Book</strong></li>';
    var s = LibraryDB.getSettings();
    infoTerms.innerHTML =
      '<strong style="color:var(--blue-dark)">Loan Period:</strong> <span id="loan-days-display">' + s.loan_days + '</span> days<br>' +
      '<strong style="color:var(--blue-dark)">Fine:</strong> ₹<span id="fine-rate-display">' + s.fine_per_day + '</span> per day after due date';
  }
};

function _initIssuePage() {
  document.getElementById('issue-student-id').addEventListener('input', function() {
    var student = LibraryDB.getStudent(this.value.trim());
    var p = document.getElementById('student-preview');
    if (student) {
      p.textContent = '✓ ' + student.name + ' — Class ' + student.class + student.section + ' | Roll ' + student.roll_no;
      p.style.color = 'var(--green-dark)';
    } else {
      p.textContent = this.value.length ? 'Student not found' : '';
      p.style.color = 'var(--coral-dark)';
    }
  });

  document.getElementById('issue-book-id').addEventListener('input', function() {
    var book = LibraryDB.getBook(this.value.trim());
    var p = document.getElementById('book-preview');
    if (book) {
      p.textContent = (book.status === 'Available' ? '✓ ' : '✗ ') + book.document + ' — ' + book.status;
      p.style.color = book.status === 'Available' ? 'var(--green-dark)' : 'var(--coral-dark)';
    } else {
      p.textContent = this.value.length ? 'Book not found' : '';
      p.style.color = 'var(--coral-dark)';
    }
  });

  document.getElementById('issue-btn').addEventListener('click', function() {
    var ctrl = (window.FirebaseSync && FirebaseSync.getControlState) ? FirebaseSync.getControlState() : { issuance_suspended:false };
    var overrideChecked = document.getElementById('issue-override-check') && document.getElementById('issue-override-check').checked;
    if (ctrl.issuance_suspended && !overrideChecked) {
      showToast('Issuance is paused by admin (' + (ctrl.suspend_reason || 'no reason given') + '). Check the override box to issue anyway.', 'warning', 4500);
      return;
    }

    var access_no = document.getElementById('issue-book-id').value.trim();
    var box       = document.getElementById('issue-result');
    var res;

    if (_issueMode === 'teacher') {
      var teacherName  = document.getElementById('issue-teacher-name').value.trim();
      var teacherEmail = document.getElementById('issue-teacher-email').value.trim();
      res = LibraryDB.issueBookToTeacher(teacherName, teacherEmail, access_no);
    } else {
      var adm_no = document.getElementById('issue-student-id').value.trim();
      res = LibraryDB.issueBook(adm_no, access_no);
    }

    box.className = 'result-box show';

    if (res.ok) {
      box.classList.add('success'); box.classList.remove('error');

      if (_issueMode === 'teacher') {
        box.innerHTML = '<div class="result-title">✅ Book Issued to Staff</div>'
          + '<div class="result-details">'
          + '<div class="result-row"><span>Teacher</span><strong>' + _esc(res.teacherName) + (res.teacherEmail ? ' (' + _esc(res.teacherEmail) + ')' : '') + '</strong></div>'
          + '<div class="result-row"><span>Book</span><strong>' + _esc(res.book.document) + ' [' + res.book.access_no + ']</strong></div>'
          + '<div class="result-row"><span>Issue Date</span><strong>' + LibraryDB.formatDate(res.txn.issue_date) + '</strong></div>'
          + '<div class="result-row"><span>Due Date</span><strong>No due date</strong></div>'
          + '</div>';
        document.getElementById('issue-teacher-name').value = '';
        document.getElementById('issue-teacher-email').value = '';
      } else {
        box.innerHTML = '<div class="result-title">✅ Book Issued Successfully</div>'
          + '<div class="result-details">'
          + '<div class="result-row"><span>Student</span><strong>' + _esc(res.student.name) + ' (' + res.student.adm_no + ')</strong></div>'
          + '<div class="result-row"><span>Book</span><strong>' + _esc(res.book.document) + ' [' + res.book.access_no + ']</strong></div>'
          + '<div class="result-row"><span>Issue Date</span><strong>' + LibraryDB.formatDate(res.txn.issue_date) + '</strong></div>'
          + '<div class="result-row"><span>Due Date</span><strong>'   + LibraryDB.formatDate(res.txn.due_date)   + '</strong></div>'
          + '</div>';
        document.getElementById('issue-student-id').value = '';
        document.getElementById('student-preview').textContent = '';
      }

      document.getElementById('issue-book-id').value = '';
      document.getElementById('book-preview').textContent = '';
      if (document.getElementById('issue-override-check')) document.getElementById('issue-override-check').checked = false;
      showToast(_issueMode === 'teacher' ? 'Book issued to staff!' : 'Book issued successfully!', 'success');
    } else {
      box.classList.add('error'); box.classList.remove('success');
      box.innerHTML = '<div class="result-title">❌ ' + res.msg + '</div>';
      showToast(res.msg, 'error');
    }
  });
}

/* ══════════════════════════════════════════════
   RETURN BOOK
══════════════════════════════════════════════ */
function _initReturnPage() {
  document.getElementById('return-book-id').addEventListener('input', function() {
    var book    = LibraryDB.getBook(this.value.trim());
    var preview = document.getElementById('return-book-preview');
    if (!book) { preview.innerHTML = this.value.length ? '<span style="color:var(--coral-dark)">Book not found</span>' : ''; return; }
    if (book.status !== 'Issued') { preview.innerHTML = '<span style="color:var(--coral-dark)">✗ ' + _esc(book.document) + ' — ' + book.status + '</span>'; return; }
    var txn = LibraryDB.getActiveTxnForBook(this.value.trim());
    if (!txn) { preview.innerHTML = '<span style="color:var(--coral-dark)">No active transaction</span>'; return; }

    if (txn.borrower_type === 'teacher') {
      preview.innerHTML = '<div style="color:var(--green-dark)">✓ <strong>' + _esc(book.document) + '</strong> [' + book.access_no + ']<br>'
        + 'Issued to: <strong>👨‍🏫 ' + _esc(txn.teacher_name) + '</strong>' + (txn.teacher_email ? ' (' + _esc(txn.teacher_email) + ')' : '') + '<br>'
        + '<span style="color:var(--purple-dark, #6644BB)">Staff loan — no due date, no fine</span>'
        + '</div>';
      return;
    }

    var student = LibraryDB.getStudent(txn.student_adm_no);
    var days    = LibraryDB.calcLateDays(txn.due_date);
    var fine    = days * LibraryDB.getSettings().fine_per_day;
    preview.innerHTML = '<div style="color:var(--green-dark)">✓ <strong>' + _esc(book.document) + '</strong> [' + book.access_no + ']<br>'
      + 'Issued to: <strong>' + _esc(student ? student.name : txn.student_adm_no) + '</strong> (ADM: ' + txn.student_adm_no + ')<br>'
      + 'Due: <strong>' + LibraryDB.formatDate(txn.due_date) + '</strong>'
      + (days > 0 ? '<br><span style="color:var(--coral-dark)">⏰ ' + days + ' days overdue — Fine: ₹' + fine + '</span>' : '')
      + '</div>';
  });

  document.getElementById('return-btn').addEventListener('click', function() {
    var access_no = document.getElementById('return-book-id').value.trim();
    var res       = LibraryDB.returnBook(access_no);
    var box       = document.getElementById('return-result');
    box.className = 'result-box show';
    if (res.ok) {
      var isTeacher = res.borrowerType === 'teacher';
      box.classList.add(res.fine > 0 ? 'warning' : 'success');
      box.innerHTML = '<div class="result-title">' + (res.fine > 0 ? '⚠️ Returned with Fine' : '✅ Book Returned Successfully') + '</div>'
        + '<div class="result-details">'
        + '<div class="result-row"><span>Book</span><strong>' + _esc(res.book.document) + '</strong></div>'
        + '<div class="result-row"><span>' + (isTeacher ? 'Teacher' : 'Student') + '</span><strong>' + (isTeacher ? _esc(res.teacherName) : _esc(res.student ? res.student.name : res.txn.student_adm_no)) + '</strong></div>'
        + '<div class="result-row"><span>Return Date</span><strong>' + LibraryDB.formatDate(res.txn.return_date) + '</strong></div>'
        + (res.fine > 0 ? '<div class="result-row"><span>Days Late</span><strong>' + res.lateDays + ' days</strong></div>'
          + '<div class="result-row"><span>Fine</span><strong style="color:var(--coral-dark)">₹' + res.fine + '</strong></div>' : '')
        + '</div>';
      document.getElementById('return-book-id').value       = '';
      document.getElementById('return-book-preview').innerHTML = '';
      showToast(res.fine > 0 ? 'Fine of ₹' + res.fine + ' added.' : 'Book returned!', res.fine > 0 ? 'warning' : 'success');
    } else {
      box.classList.add('error');
      box.innerHTML = '<div class="result-title">❌ ' + res.msg + '</div>';
      showToast(res.msg, 'error');
    }
  });
}

/* ══════════════════════════════════════════════
   FINES  (Pending / Collected tabs)
══════════════════════════════════════════════ */
var _currentFinesTab = 'pending';

window.switchFinesTab = function(tab) {
  _currentFinesTab = tab;
  document.getElementById('fines-tab-pending').classList.toggle('tab-active', tab === 'pending');
  document.getElementById('fines-tab-collected').classList.toggle('tab-active', tab === 'collected');
  _renderFines();
};

function _renderFines() {
  var pending   = LibraryDB.getPendingFines();
  var collected = LibraryDB.getFinePayments().slice().sort(function(a,b){ return new Date(b.paid_at) - new Date(a.paid_at); });
  var tbody     = document.getElementById('fines-tbody');
  var titleEl   = document.getElementById('fines-list-title');
  var subEl     = document.getElementById('fines-list-subtitle');

  _setText('total-fines-due',       '₹' + pending.reduce(function(s,t){ return s+t.fine; }, 0));
  _setText('total-fines-collected', '₹' + LibraryDB.getTotalCollected());

  if (!tbody) return;

  if (_currentFinesTab === 'collected') {
    if (titleEl) titleEl.textContent = 'Collected Fines';
    if (subEl)   subEl.textContent   = 'Full history of fines already paid';
    if (!collected.length) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><span class="empty-icon">💸</span><h4>No fines collected yet</h4></div></td></tr>';
      return;
    }
    tbody.innerHTML = collected.map(function(p) {
      var student = LibraryDB.getStudent(p.student_adm_no);
      var book    = LibraryDB.getBook(p.book_access_no);
      return '<tr>'
        + '<td class="td-id">' + p.payment_id.slice(-8) + '</td>'
        + '<td>' + _esc(student ? student.name : p.student_adm_no) + '<br><span class="td-id">' + p.student_adm_no + '</span></td>'
        + '<td>' + _esc(book ? book.document : p.book_access_no)   + '<br><span class="td-id">' + p.book_access_no  + '</span></td>'
        + '<td>' + LibraryDB.formatDate(p.paid_date) + '</td>'
        + '<td><span class="fine-amount" style="color:var(--green-dark)">₹' + p.amount + '</span></td>'
        + '<td><span class="badge badge-green">Paid</span></td>'
        + '</tr>';
    }).join('');
    return;
  }

  /* pending tab (default) */
  if (titleEl) titleEl.textContent = 'Pending Fines';
  if (subEl)   subEl.textContent   = 'Click "Mark Paid" after collecting the fine';
  if (!pending.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><span class="empty-icon">🎊</span><h4>No pending fines</h4></div></td></tr>';
    return;
  }
  tbody.innerHTML = pending.map(function(txn) {
    var student = LibraryDB.getStudent(txn.student_adm_no);
    var book    = LibraryDB.getBook(txn.book_access_no);
    return '<tr>'
      + '<td class="td-id">' + _esc(txn.transaction_id.slice(-8)) + '</td>'
      + '<td>' + _esc(student ? student.name : txn.student_adm_no) + '<br><span class="td-id">' + _esc(txn.student_adm_no) + '</span></td>'
      + '<td>' + _esc(book ? book.document : txn.book_access_no)   + '<br><span class="td-id">' + _esc(txn.book_access_no)  + '</span></td>'
      + '<td>' + LibraryDB.formatDate(txn.return_date) + '</td>'
      + '<td><span class="fine-amount">₹' + txn.fine + '</span></td>'
      + '<td><button class="btn btn-green btn-sm" data-fine-txn-id="' + _esc(txn.transaction_id) + '">Mark Paid</button></td>'
      + '</tr>';
  }).join('');
  tbody.querySelectorAll('[data-fine-txn-id]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      payFine(btn.dataset.fineTxnId);
    });
  });
}

window.payFine = function(txn_id) {
  LibraryDB.markFinePaid(txn_id);
  _renderFines();
  showToast('Fine marked as paid.', 'success');
};

/* ══════════════════════════════════════════════
   DAMAGE
══════════════════════════════════════════════ */
function _initDamagePage() {
  var selectedSeverity = 'Minor Damage';
  document.querySelectorAll('.severity-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      document.querySelectorAll('.severity-chip').forEach(function(c){ c.classList.remove('selected'); });
      this.classList.add('selected');
      selectedSeverity = this.dataset.severity;
    });
  });

  document.getElementById('damage-book-id').addEventListener('input', function() {
    var book = LibraryDB.getBook(this.value.trim());
    var p    = document.getElementById('damage-book-preview');
    if (!book) { p.textContent = this.value.length ? 'Book not found' : ''; p.style.color='var(--coral-dark)'; return; }
    p.textContent = '✓ ' + book.document + ' — ' + book.status;
    p.style.color = 'var(--green-dark)';
  });

  document.getElementById('damage-submit').addEventListener('click', function() {
    var access_no   = document.getElementById('damage-book-id').value.trim();
    var desc        = document.getElementById('damage-desc').value.trim();
    var notes       = document.getElementById('damage-notes').value.trim();
    var responsible = document.getElementById('damage-responsible').value.trim();
    if (!access_no) { showToast('Enter a book Access No.', 'error'); return; }
    if (!desc)      { showToast('Add a damage description.', 'error'); return; }
    var res = LibraryDB.reportDamage(access_no, desc, selectedSeverity, responsible, notes);
    if (res.ok) {
      var label = selectedSeverity === 'Unusable' ? 'Lost' : selectedSeverity === 'Repair Needed' ? 'Under Repair' : 'Damaged';
      showToast('Damage reported. Book set to ' + label + '.', 'warning');
      document.getElementById('damage-form').reset();
      document.getElementById('damage-book-preview').textContent = '';
    } else { showToast(res.msg, 'error'); }
  });
}

/* ══════════════════════════════════════════════
   SEARCH
══════════════════════════════════════════════ */
function _initSearchPage() {
  document.getElementById('global-search-input').addEventListener('input', function(e) { _performSearch(e.target.value); });
}

function _performSearch(q) {
  var div = document.getElementById('search-results');
  if (!div) return;
  if (!q || !q.trim()) { div.innerHTML = ''; return; }

  var books    = LibraryDB.searchBooks(q);
  var students = LibraryDB.searchStudents(q);
  var html = '';
  var dotMap = { Available:'dot-available', Issued:'dot-issued', Damaged:'dot-damaged', 'Under Repair':'dot-repair', Lost:'dot-lost' };

  if (books.length) {
    html += '<div class="section-title" style="margin-top:0">📚 Books (' + books.length + ')</div><div class="search-results-list">'
      + books.map(function(b) {
          return '<div class="search-result-item"><div class="sr-left"><h4>' + _esc(b.document) + '</h4>'
            + '<p><span class="td-id">' + b.access_no + '</span> · ' + _esc(b.author) + ' · ' + _esc(b.publisher||'') + '</p></div>'
            + '<div><span class="status-dot ' + (dotMap[b.status]||'') + '"></span><span class="text-sm text-muted">' + b.status + '</span></div></div>';
        }).join('') + '</div>';
  }
  if (students.length) {
    html += '<div class="section-title" style="margin-top:20px">🎓 Students (' + students.length + ')</div><div class="search-results-list">'
      + students.map(function(s) {
          var active = LibraryDB.getActiveTransactions().filter(function(t){ return t.student_adm_no === s.adm_no; });
          return '<div class="search-result-item"><div class="sr-left"><h4>' + _esc(s.name) + '</h4>'
            + '<p><span class="td-id">' + s.adm_no + '</span> · Class ' + s.class + s.section + ' · Roll ' + s.roll_no + '</p></div>'
            + '<div class="text-sm text-muted">' + (active.length ? active.length + ' book(s) issued' : 'No active issues') + '</div></div>';
        }).join('') + '</div>';
  }
  if (!html) html = '<div class="empty-state"><span class="empty-icon">🔍</span><h4>No results</h4><p>Nothing found for "' + _esc(q) + '"</p></div>';
  div.innerHTML = html;
}

function _initTopbarSearch() {
  document.getElementById('topbar-search').addEventListener('input', function() {
    if (this.value.trim()) {
      navigate('search');
      document.getElementById('global-search-input').value = this.value;
      _performSearch(this.value);
    }
  });
}

/* ══════════════════════════════════════════════
   RECORDS
══════════════════════════════════════════════ */
function _renderRecords() {
  var filter = document.getElementById('records-filter').value;
  var txns   = LibraryDB.getTransactions().slice().reverse();
  if (filter !== 'all') txns = txns.filter(function(t){ return t.status === filter; });
  var tbody  = document.getElementById('records-tbody');
  if (!tbody) return;
  if (!txns.length) { tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><span class="empty-icon">📋</span><h4>No records</h4></div></td></tr>'; return; }
  var badges = { Active:'<span class="badge badge-blue">Active</span>', Returned:'<span class="badge badge-green">Returned</span>', FinePending:'<span class="badge badge-coral">Fine Due</span>' };
  tbody.innerHTML = txns.map(function(txn) {
    var book      = LibraryDB.getBook(txn.book_access_no);
    var b         = _borrowerCell(txn);
    var isOverdue = txn.status === 'Active' && LibraryDB.calcLateDays(txn.due_date) > 0;
    return '<tr' + (isOverdue ? ' class="row-overdue"' : '') + '>'
      + '<td class="td-id">' + txn.transaction_id.slice(-8) + '</td>'
      + '<td>' + _esc(book ? book.document : txn.book_access_no) + '<br><span class="td-id">' + txn.book_access_no + '</span></td>'
      + '<td>' + _esc(b.name) + '<br><span class="td-id">' + _esc(b.sub) + '</span></td>'
      + '<td>' + LibraryDB.formatDate(txn.issue_date)  + '</td>'
      + '<td>' + _dueDateCell(txn) + '</td>'
      + '<td>' + (txn.return_date ? LibraryDB.formatDate(txn.return_date) : '—') + '</td>'
      + '<td>' + (badges[txn.status] || '<span class="badge badge-gray">' + txn.status + '</span>')
      + (txn.fine > 0 ? ' <span class="fine-amount">₹' + txn.fine + '</span>' : '') + '</td></tr>';
  }).join('');
}

/* ══════════════════════════════════════════════
   BOOK CATALOGUE
══════════════════════════════════════════════ */
function _renderBookCatalogue() {
  var q      = (document.getElementById('book-search').value || '').trim();
  var books  = q ? LibraryDB.searchBooks(q) : LibraryDB.getBooks();
  var tbody  = document.getElementById('books-tbody');
  if (!tbody) return;
  if (!books.length) { tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><span class="empty-icon">📚</span><h4>No books found</h4></div></td></tr>'; return; }
  var dotMap   = { Available:'dot-available', Issued:'dot-issued', Damaged:'dot-damaged', 'Under Repair':'dot-repair', Lost:'dot-lost' };
  var badgeMap = { Available:'badge-green', Issued:'badge-blue', Damaged:'badge-coral', 'Under Repair':'badge-yellow', Lost:'badge-gray' };
  tbody.innerHTML = books.map(function(b) {
    var btn = '';
    if (b.status === 'Issued') btn = '<button class="btn btn-ghost btn-sm" onclick="navigate(\'return\')">Return</button>';
    else if (['Damaged','Under Repair','Lost'].includes(b.status))
      btn = '<button class="btn btn-green btn-sm" data-restore-access="' + _esc(b.access_no) + '" data-restore-status="' + _esc(b.status) + '">🔧 Restore</button>';
    return '<tr>'
      + '<td class="td-id">' + _esc(b.access_no) + '</td>'
      + '<td><strong>' + _esc(b.document)  + '</strong></td>'
      + '<td>' + _esc(b.author)            + '</td>'
      + '<td class="text-sm text-muted">' + _esc(b.publisher||'—') + '</td>'
      + '<td><span class="status-dot ' + (dotMap[b.status]||'') + '"></span><span class="badge ' + (badgeMap[b.status]||'badge-gray') + '">' + _esc(b.status) + '</span></td>'
      + '<td>' + btn + '</td></tr>';
  }).join('');
  tbody.querySelectorAll('[data-restore-access]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      openRestoreModal(btn.dataset.restoreAccess, btn.dataset.restoreStatus);
    });
  });
}

/* ══════════════════════════════════════════════
   STUDENTS
══════════════════════════════════════════════ */
function _renderStudents() {
  var q        = (document.getElementById('student-search').value || '').trim();
  var students = q ? LibraryDB.searchStudents(q) : LibraryDB.getStudents();
  var tbody    = document.getElementById('students-tbody');
  if (!tbody) return;
  if (!students.length) { tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><span class="empty-icon">🎓</span><h4>No students found</h4></div></td></tr>'; return; }
  var groupCls = { 'Regular':'regular', 'Literary Club':'literary-club', 'Editorial Board':'editorial-board' };
  tbody.innerHTML = students.map(function(s) {
    var active  = LibraryDB.getActiveTransactions().filter(function(t){ return t.student_adm_no === s.adm_no; });
    var overdue = active.filter(function(t){ return LibraryDB.calcLateDays(t.due_date) > 0; });
    var group   = s.group || 'Regular';
    return '<tr>'
      + '<td class="td-id">' + _esc(s.adm_no) + '</td>'
      + '<td><strong>' + _esc(s.name) + '</strong>' + (s.email ? '<br><span class="td-id">' + _esc(s.email) + '</span>' : '') + '</td>'
      + '<td>Class ' + _esc(s.class) + ' ' + _esc(s.section) + '</td>'
      + '<td>' + _esc(s.roll_no) + '</td>'
      + '<td><span class="group-badge ' + (groupCls[group]||'regular') + '">' + group + '</span></td>'
      + '<td>' + (active.length  ? '<span class="badge badge-blue">'  + active.length  + ' issued</span>'  : '<span class="badge badge-gray">None</span>') + '</td>'
      + '<td>' + (overdue.length ? '<span class="badge badge-coral">' + overdue.length + ' overdue</span>' : '—') + '</td>'
      + '<td><button class="btn btn-ghost btn-sm" data-edit-student="' + _esc(s.adm_no) + '">Edit</button> <button class="btn btn-ghost btn-sm" data-delete-student="' + _esc(s.adm_no) + '">Delete</button></td></tr>';
  }).join('');
  tbody.querySelectorAll('[data-edit-student]').forEach(function(button) {
    button.addEventListener('click', function() { _openStudentCorrection(button.dataset.editStudent); });
  });
  tbody.querySelectorAll('[data-delete-student]').forEach(function(button) {
    button.addEventListener('click', async function() {
      var student = LibraryDB.getStudentByAdmNo(button.dataset.deleteStudent);
      if (!student || !(await _confirmStudentDeletion(student))) return;
      var result = LibraryDB.deleteStudent(student.adm_no);
      showToast(result.ok ? 'Student record deleted.' : result.msg, result.ok ? 'success' : 'error');
      if (result.ok) _renderStudents();
    });
  });
}

function _confirmStudentDeletion(student) {
  return new Promise(function(resolve) {
    var overlay = document.createElement('div'); overlay.className = 'modal-overlay show';
    var modal = document.createElement('div'); modal.className = 'modal';
    var title = document.createElement('h2'); title.className = 'modal-title'; title.textContent = 'Delete student record?';
    var detail = document.createElement('p'); detail.className = 'modal-sub';
    detail.textContent = student.name + ' (' + student.adm_no + ') will be removed from this librarian roster. Past loan history remains.' + (student.cloud_synced ? ' Remove their access in Admin first to prevent the record returning during cloud sync.' : '');
    var actions = document.createElement('div'); actions.className = 'modal-actions';
    var cancel = document.createElement('button'); cancel.className = 'btn btn-ghost'; cancel.textContent = 'Keep record';
    var remove = document.createElement('button'); remove.className = 'btn btn-primary'; remove.textContent = 'Delete record';
    function done(ok) { overlay.remove(); resolve(ok); }
    cancel.addEventListener('click', function() { done(false); });
    remove.addEventListener('click', function() { done(true); });
    overlay.addEventListener('click', function(event) { if (event.target === overlay) done(false); });
    actions.append(cancel, remove); modal.append(title, detail, actions); overlay.appendChild(modal); document.body.appendChild(overlay);
    cancel.focus();
  });
}

/* ══════════════════════════════════════════════
   ADD BOOK MODAL
══════════════════════════════════════════════ */
function _initAddBookModal() {
  document.getElementById('add-book-btn').addEventListener('click', function() { document.getElementById('add-book-modal').classList.add('show'); });
  document.getElementById('close-add-book').addEventListener('click', function() { document.getElementById('add-book-modal').classList.remove('show'); });
  document.getElementById('add-book-modal').addEventListener('click', function(e) { if (e.target===this) this.classList.remove('show'); });
  document.getElementById('save-book-btn').addEventListener('click', function() {
    var access_no = document.getElementById('new-book-id').value.trim();
    var doc       = document.getElementById('new-book-title').value.trim();
    var author    = document.getElementById('new-book-author').value.trim();
    var publisher = document.getElementById('new-book-publisher').value.trim();
    var cost      = document.getElementById('new-book-cost').value.trim();
    var pages     = document.getElementById('new-book-pages').value.trim();
    if (!access_no || !doc || !author) { showToast('Access No, Title and Author are required.', 'error'); return; }
    var res = LibraryDB.addBook({ access_no:access_no, document:doc, author:author, publisher:publisher, cost:cost, pages:pages });
    if (res.ok) {
      showToast('Book added!', 'success');
      document.getElementById('add-book-modal').classList.remove('show');
      document.querySelectorAll('#add-book-modal input').forEach(function(i){ i.value=''; });
      _renderBookCatalogue();
      checkSetupComplete();
    } else { showToast(res.msg, 'error'); }
  });
}

/* ══════════════════════════════════════════════
   ADD STUDENT MODAL
══════════════════════════════════════════════ */
function _initAddStudentModal() {
  var admission = document.getElementById('new-student-adm');
  var saveButton = document.getElementById('save-student-btn');
  var matchPanel = document.getElementById('student-match-panel');
  var correctionPanel = document.getElementById('student-correction-panel');
  var editing = null;
  function resetMatch() {
    editing = null; matchPanel.hidden = true; correctionPanel.hidden = true;
    admission.readOnly = false; saveButton.textContent = 'Add Student';
  }
  function showMatch() {
    if (editing) return;
    var existing = LibraryDB.getStudentByAdmNo(admission.value.trim());
    matchPanel.hidden = !existing;
    document.getElementById('student-match-summary').textContent = existing ? existing.name + ' · ' + existing.adm_no + (existing.email ? ' · ' + existing.email : '') : '';
    saveButton.disabled = !!existing;
  }
  admission.addEventListener('input', showMatch);
  document.getElementById('student-match-yes').addEventListener('click', function() {
    resetMatch(); document.getElementById('add-student-modal').classList.remove('show');
    document.getElementById('student-search').value = admission.value.trim(); _renderStudents();
  });
  document.getElementById('student-match-no').addEventListener('click', function() { _openStudentCorrection(admission.value.trim()); });
  window._openStudentCorrection = function(admNo) {
    var student = LibraryDB.getStudentByAdmNo(admNo);
    if (!student) return;
    editing = student.adm_no; matchPanel.hidden = true; correctionPanel.hidden = false;
    admission.value = student.adm_no; admission.readOnly = true;
    ['name','email','class','section','roll'].forEach(function(field) {
      document.getElementById('new-student-' + field).value = student[field === 'roll' ? 'roll_no' : field] || '';
    });
    document.getElementById('new-student-group').value = student.group || 'Regular';
    saveButton.disabled = false; saveButton.textContent = 'Save corrections';
    document.getElementById('add-student-modal').classList.add('show');
    document.getElementById('new-student-name').focus();
  };
  document.getElementById('add-student-btn').addEventListener('click', function() {
    resetMatch(); saveButton.disabled = false;
    document.querySelectorAll('#add-student-modal input').forEach(function(input) { input.value = ''; });
    document.getElementById('new-student-group').value = 'Regular';
    document.getElementById('add-student-modal').classList.add('show');
  });
  document.getElementById('close-add-student').addEventListener('click', function() { document.getElementById('add-student-modal').classList.remove('show'); });
  document.getElementById('add-student-modal').addEventListener('click', function(e) { if (e.target===this) this.classList.remove('show'); });
  document.getElementById('save-student-btn').addEventListener('click', function() {
    var adm_no  = document.getElementById('new-student-adm').value.trim();
    var name    = document.getElementById('new-student-name').value.trim();
    var email   = document.getElementById('new-student-email').value.trim();
    var cls     = document.getElementById('new-student-class').value.trim();
    var section = document.getElementById('new-student-section').value.trim();
    var roll_no = document.getElementById('new-student-roll').value.trim();
    var group   = document.getElementById('new-student-group').value;
    if (!adm_no || !name) { showToast('ADM No and Name are required.', 'error'); return; }
    if (!editing && LibraryDB.getStudentByAdmNo(adm_no)) { showMatch(); return; }
    var details = { adm_no:adm_no, name:name, email:email, 'class':cls, section:section, roll_no:roll_no, group:group };
    var res = editing ? LibraryDB.updateStudent(editing, details) : LibraryDB.addStudent(details);
    if (res.ok) {
      showToast(editing ? 'Student details corrected.' : 'Student added!', 'success');
      document.getElementById('add-student-modal').classList.remove('show');
      resetMatch(); saveButton.disabled = false;
      document.querySelectorAll('#add-student-modal input').forEach(function(i){ i.value=''; });
      document.getElementById('new-student-group').value = 'Regular';
      _renderStudents();
      checkSetupComplete();
    } else { showToast(res.msg, 'error'); }
  });
}

/* ══════════════════════════════════════════════
   JSON IMPORT
══════════════════════════════════════════════ */
function _initImports() {
  /* Books — catalogue page */
  document.getElementById('import-books-file').addEventListener('change', function() {
    _readJsonFile(this, function(res) {
      if (res.ok) { showToast('✅ ' + res.count + ' books imported!', 'success'); _renderBookCatalogue(); checkSetupComplete(); }
      else        { showToast('❌ ' + res.msg, 'error'); }
    }, LibraryDB.importBooks);
  });

  /* Students — students page */
  document.getElementById('import-students-file').addEventListener('change', function() {
    _readJsonFile(this, function(res) {
      if (res.ok) { showToast('✅ ' + res.count + ' students imported!', 'success'); _renderStudents(); checkSetupComplete(); }
      else        { showToast('❌ ' + res.msg, 'error'); }
    }, LibraryDB.importStudents);
  });

  /* Setup overlay books */
  var sb = document.getElementById('setup-import-books');
  if (sb) sb.addEventListener('change', function() {
    _readJsonFile(this, function(res) {
      if (res.ok) { showToast('✅ ' + res.count + ' books imported!', 'success'); checkSetupComplete(); }
      else        { showToast('❌ ' + res.msg, 'error'); }
    }, LibraryDB.importBooks);
  });

  /* Setup overlay students */
  var ss = document.getElementById('setup-import-students');
  if (ss) ss.addEventListener('change', function() {
    _readJsonFile(this, function(res) {
      if (res.ok) { showToast('✅ ' + res.count + ' students imported!', 'success'); checkSetupComplete(); }
      else        { showToast('❌ ' + res.msg, 'error'); }
    }, LibraryDB.importStudents);
  });
}

function _readJsonFile(inputEl, callback, dbFn) {
  var file = inputEl.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) { callback(dbFn(e.target.result)); };
  reader.readAsText(file);
  inputEl.value = '';
}

/* ══════════════════════════════════════════════
   SETTINGS
══════════════════════════════════════════════ */
function _initSettings() {
  var s = LibraryDB.getSettings();
  var fr = document.getElementById('fine-rate');
  var ld = document.getElementById('loan-days');
  if (fr) fr.value = s.fine_per_day;
  if (ld) ld.value = s.loan_days;

  document.getElementById('save-settings').addEventListener('click', function() {
    var res = LibraryDB.saveSettings({
      fine_per_day: parseFloat(document.getElementById('fine-rate').value) || 2,
      loan_days:    parseInt(document.getElementById('loan-days').value)   || 14,
    });
    showToast(res.ok ? 'Settings saved.' : res.msg, res.ok ? 'success' : 'error');
  });

  document.getElementById('backup-btn').addEventListener('click', async function() {
    var btn = this;
    btn.disabled = true;
    var oldText = btn.textContent;
    btn.textContent = 'Backing up...';
    var res = await LibraryDB.backupData();
    btn.disabled = false;
    btn.textContent = oldText;
    if (res && res.cancelled) return;
    showToast(res && res.ok === false ? (res.msg || 'Backup failed.') : 'Backup saved.', res && res.ok === false ? 'error' : 'success');
  });

  document.getElementById('undo-btn').addEventListener('click', function() {
    var res = LibraryDB.undoLastTransaction();
    showToast(res.ok ? 'Last transaction undone.' : res.msg, res.ok ? 'success' : 'error');
  });

  document.getElementById('restore-file').addEventListener('change', function() {
    _readJsonFile(this, function(res) {
      if (res.ok) { showToast('Database restored!', 'success'); _renderDashboard(); }
      else        { showToast(res.msg, 'error'); }
    }, LibraryDB.restoreData);
  });

  /* update loan/fine hint on issue page */
  _setText('loan-days-display', s.loan_days);
  _setText('fine-rate-display', s.fine_per_day);
}

function _renderSyncStats() {
  var connEl = document.getElementById('settings-connection');
  var lastEl = document.getElementById('settings-last-sync');
  if (connEl) {
    connEl.textContent = navigator.onLine ? 'Online ✓' : 'Offline';
    connEl.style.color = navigator.onLine ? 'var(--green-dark)' : 'var(--coral-dark)';
  }
  if (lastEl && window.FirebaseSync) {
    var t = FirebaseSync.getLastSyncTime();
    lastEl.textContent = t ? t.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : '—';
  }
  var sb = document.getElementById('sync-status-badge');
  var ss = document.getElementById('sync-status-badge-settings');
  if (sb && ss) { ss.textContent = sb.textContent; ss.className = sb.className; }
  _renderKioskCredsStatus();
}

function _renderKioskCredsStatus() {
  var el = document.getElementById('kiosk-creds-status');
  if (!el || !window.FirebaseSync) return;
  try {
    if (FirebaseSync.hasKioskClaim && FirebaseSync.hasKioskClaim()) {
      el.textContent = '✅ Approved — request decisions unlocked';
      el.style.color = 'var(--green-dark)';
    } else {
      el.textContent = navigator.onLine ? '⚪ Not approved — credential missing, revoked, or awaiting verification' : '⚪ Offline — approval will be checked when connected';
      el.style.color = 'var(--text-muted)';
    }
  } catch (e) { /* never break settings render */ }
}

/* One-time kiosk provisioning — stores email/password in the OS keychain
   and signs in to get the approval token. Daily use needs nothing. */
window.saveKioskCreds = async function() {
  var emailInput = document.getElementById('kiosk-email-input');
  var passInput = document.getElementById('kiosk-password-input');
  var email = emailInput ? emailInput.value.trim() : '';
  var password = passInput ? passInput.value : '';
  if (!email || !password) {
    showToast('Enter both email and password.', 'error');
    return;
  }
  if (!window.FirebaseSync || !FirebaseSync.provisionKioskCreds) {
    showToast('Cloud sync is not loaded yet — try again in a moment.', 'error');
    return;
  }
  showToast('Activating kiosk credentials…', 'default');
  var res = await FirebaseSync.provisionKioskCreds(email, password);
  if (res.ok) {
    showToast('✅ ' + res.msg, 'success');
    if (emailInput) emailInput.value = '';
    if (passInput) passInput.value = '';
  } else {
    showToast(res.msg || 'Could not activate kiosk credentials.', 'error');
  }
  _renderKioskCredsStatus();
};

/* ══════════════════════════════════════════════
   ACTIVITY LOG  (on-disk transaction log file)
══════════════════════════════════════════════ */
window.refreshActivityLog = async function() {
  if (!window.electronAPI || !window.electronAPI.getLogInfo) {
    _setText('log-current-file', 'Not available (non-Electron preview)');
    var pre = document.getElementById('log-preview');
    if (pre) pre.textContent = 'Activity logging only runs inside the Electron desktop app.';
    return;
  }

  try {
    var info = await window.electronAPI.getLogInfo();
    _setText('log-current-file', info.currentFile ? info.currentFile.split(/[\\/]/).pop() : '—');
    _setText('log-entry-count', info.lineCount);
    _setText('log-file-size', info.sizeKb + ' KB');
    _setText('log-folder-path', info.folder);

    var lines = await window.electronAPI.readCurrentLog(50);
    var pre = document.getElementById('log-preview');
    if (pre) pre.textContent = lines && lines.trim() ? lines : 'No activity logged yet this month.';
    if (pre) pre.scrollTop = pre.scrollHeight;
  } catch (e) {
    showToast('Could not load activity log: ' + e.message, 'error');
  }
};

window.openActivityLogFolder = async function() {
  if (!window.electronAPI || !window.electronAPI.openLogFolder) {
    showToast('Log folder access requires the desktop app.', 'error');
    return;
  }
  await window.electronAPI.openLogFolder();
};

/* ══════════════════════════════════════════════
   SUSPEND BANNER  (exam-time issuance pause)
   Driven by FirebaseSync.startControlListener()
══════════════════════════════════════════════ */
function _applyControlState(state) {
  var banner = document.getElementById('suspend-banner');
  var overrideRow = document.getElementById('issue-override-row');

  if (!banner) return;

  if (state.issuance_suspended) {
    banner.style.display = 'flex';
    banner.innerHTML = '<span class="suspend-icon">🚫</span>'
      + '<span class="suspend-text">Book issuance is currently <strong>paused by admin</strong>'
      + (state.suspend_reason ? ' — <span class="suspend-reason">' + _esc(state.suspend_reason) + '</span>' : '')
      + '</span>';
    if (overrideRow) overrideRow.style.display = 'block';
  } else {
    banner.style.display = 'none';
    banner.innerHTML = '';
    if (overrideRow) {
      overrideRow.style.display = 'none';
      var chk = document.getElementById('issue-override-check');
      if (chk) chk.checked = false;
    }
  }
}

/* ══════════════════════════════════════════════
   BOOK REQUESTS  (student → librarian)
══════════════════════════════════════════════ */
var _allRequests = [];

function _renderRequests() {
  var filterVal = document.getElementById('requests-filter') ? document.getElementById('requests-filter').value : 'Pending';
  var list = _allRequests;
  if (filterVal !== 'all') list = list.filter(function(r){ return r.status === filterVal; });

  // Priority first, then newest first
  list = list.slice().sort(function(a, b) {
    if (a.priority !== b.priority) return b.priority ? 1 : -1;
    var ta = a.timestamp_iso ? new Date(a.timestamp_iso).getTime() : 0;
    var tb = b.timestamp_iso ? new Date(b.timestamp_iso).getTime() : 0;
    return tb - ta;
  });

  var pendingCount = _allRequests.filter(function(r){ return r.status === 'Pending'; }).length;
  _setText('requests-pending-count', pendingCount);

  var el = document.getElementById('requests-list');
  if (!el) return;

  if (!list.length) {
    el.innerHTML = '<div class="empty-state"><span class="empty-icon">📩</span><h4>No requests</h4><p>Student book requests will appear here.</p></div>';
    return;
  }

  var statusCls = { Pending:'status-pending', Approved:'status-approved', Declined:'status-declined', Issued:'status-issued' };
  var statusBadge = {
    Pending:  '<span class="badge badge-yellow">Pending</span>',
    Approved: '<span class="badge badge-green">Approved</span>',
    Declined: '<span class="badge badge-coral">Declined</span>',
    Issued:   '<span class="badge badge-blue">Issued</span>',
  };

  el.innerHTML = list.map(function(r) {
    var time = r.timestamp_iso ? new Date(r.timestamp_iso).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
    var actions = '';
    if (r.status === 'Pending') {
      actions = '<button class="btn btn-green btn-sm" data-request-action="approve" data-request-id="' + _esc(r.id) + '" data-book-access="' + _esc(r.book_access_no) + '" data-adm-no="' + _esc(r.adm_no) + '">✓ Approve &amp; Issue</button>'
        + '<button class="btn btn-coral btn-sm" data-request-action="decline" data-request-id="' + _esc(r.id) + '">✕ Decline</button>';
    }
    return '<div class="request-card ' + (r.priority ? 'priority ' : '') + (statusCls[r.status]||'') + '">'
      + '<div class="request-icon">' + (r.priority ? '⭐' : '📖') + '</div>'
      + '<div class="request-body">'
      + '<div class="request-top-row">'
      + '<span class="request-book-title">' + _esc(r.book_title) + '</span>'
      + (r.priority ? '<span class="priority-badge">⭐ ' + _esc(r.group) + '</span>' : '')
      + statusBadge[r.status]
      + '</div>'
      + '<div class="request-meta">' + _esc(r.student_name) + ' · ' + _esc(r.adm_no) + ' · Class ' + _esc(r.class) + _esc(r.section) + ' · Book: ' + _esc(r.book_access_no) + '</div>'
      + (r.note ? '<div class="request-note">"' + _esc(r.note) + '"</div>' : '')
      + '<div class="request-time">Requested ' + time + '</div>'
      + '</div>'
      + '<div class="request-actions">' + actions + '</div>'
      + '</div>';
  }).join('');
  el.querySelectorAll('[data-request-action]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (btn.dataset.requestAction === 'approve') {
        approveRequest(btn.dataset.requestId, btn.dataset.bookAccess, btn.dataset.admNo);
      } else {
        declineRequest(btn.dataset.requestId);
      }
    });
  });
}

window.approveRequest = async function(requestId, access_no, adm_no) {
  var book = LibraryDB.getBook(access_no);
  if (!book) { showToast('Book not found in local catalogue.', 'error'); return; }
  if (book.status !== 'Available') {
    showToast('Cannot issue — book is currently "' + book.status + '".', 'error');
    return;
  }
  var issueRes = LibraryDB.issueBook(adm_no, access_no);
  if (!issueRes.ok) { showToast(issueRes.msg, 'error'); return; }

  var decideRes = await FirebaseSync.decideRequest(requestId, 'Issued', 'Approved and issued by librarian.');
  if (decideRes.ok) {
    showToast('✅ Approved and issued: ' + issueRes.book.document, 'success');
  } else {
    showToast('Book issued locally, but request status update failed: ' + decideRes.msg, 'warning');
  }
  _renderDashboard();
};

window.declineRequest = async function(requestId) {
  var res = await FirebaseSync.decideRequest(requestId, 'Declined', 'Declined by librarian.');
  if (res.ok) showToast('Request declined.', 'default');
  else showToast(res.msg, 'error');
};

/* ══════════════════════════════════════════════
   RESTORE BOOK MODAL
══════════════════════════════════════════════ */
window.openRestoreModal = function(accessNo, currentStatus) {
  var book = LibraryDB.getBook(accessNo);
  if (!book) { showToast('Book not found.', 'error'); return; }
  _setText('restore-book-id-display',     accessNo);
  _setText('restore-book-title-display',  book.document);
  _setText('restore-book-status-display', currentStatus);
  document.getElementById('restore-book-id-hidden').value = accessNo;
  document.getElementById('restore-notes').value          = '';
  document.getElementById('restore-modal').classList.add('show');
};

window.confirmRestore = function() {
  var accessNo = document.getElementById('restore-book-id-hidden').value;
  var notes    = document.getElementById('restore-notes').value.trim();
  var res      = LibraryDB.restoreBook(accessNo, notes);
  document.getElementById('restore-modal').classList.remove('show');
  if (res.ok) { showToast('✅ "' + res.book.document + '" restored to Available.', 'success'); _renderBookCatalogue(); }
  else        { showToast(res.msg, 'error'); }
};

/* ══════════════════════════════════════════════
   NOTIFICATIONS
══════════════════════════════════════════════ */
function _initNotificationsPage() {
  var selectedType = 'MESSAGE';
  document.querySelectorAll('.notif-type-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      document.querySelectorAll('.notif-type-chip').forEach(function(c){ c.classList.remove('selected'); });
      this.classList.add('selected');
      selectedType = this.dataset.type;
    });
  });

  document.getElementById('send-notif-btn').addEventListener('click', async function() {
    var subject = document.getElementById('notif-subject').value.trim();
    var body    = document.getElementById('notif-body').value.trim();
    if (!subject) { showToast('Enter a subject.', 'error'); return; }
    if (!body)    { showToast('Enter a message body.', 'error'); return; }
    this.textContent = 'Sending…'; this.disabled = true;
    var res = await FirebaseSync.sendNotification(selectedType, subject, body);
    this.textContent = '✉️ Send to Admin'; this.disabled = false;
    if (res.ok) {
      showToast('Message sent ✓', 'success');
      document.getElementById('notif-subject').value = '';
      document.getElementById('notif-body').value    = '';
      FirebaseSync.renderSentNotifications();
    } else { showToast(res.msg || 'Failed.', 'error'); }
  });
}

function _loadIncomingNotifications() {
  if (window.FirebaseSync) { FirebaseSync.startNotificationListener(); FirebaseSync.renderSentNotifications(); }
}

window.markNotifRead = function(id, el) {
  FirebaseSync.markLocalRead(id);
  if (el) { el.classList.remove('notif-unread'); el.classList.add('notif-read'); var dot=el.querySelector('.notif-dot'); if(dot)dot.remove(); }
  FirebaseSync.updateNotifBadge(Math.max(0, FirebaseSync.getUnreadCount()-1));
};

/* ══════════════════════════════════════════════
   INLINE HELPERS  (called by HTML onclick)
══════════════════════════════════════════════ */
window.quickStudentSearch = function(q) {
  var res = document.getElementById('quick-student-results');
  if (!q) { res.innerHTML = ''; return; }
  var students = LibraryDB.searchStudents(q).slice(0, 5);
  if (!students.length) { res.innerHTML = '<p class="text-sm text-muted">No students found.</p>'; return; }
  res.innerHTML = students.map(function(s) {
    return '<div class="search-result-item" style="margin-bottom:6px;cursor:pointer" data-student-adm="' + _esc(s.adm_no) + '">'
      + '<div class="sr-left"><h4 style="font-size:13px">' + _esc(s.name) + '</h4>'
      + '<p>' + _esc(s.adm_no) + ' · Class ' + _esc(s.class) + _esc(s.section) + ' · Roll ' + _esc(s.roll_no) + '</p></div></div>';
  }).join('');
  res.querySelectorAll('[data-student-adm]').forEach(function(item) {
    item.addEventListener('click', function() {
      var input = document.getElementById('issue-student-id');
      input.value = item.dataset.studentAdm;
      input.dispatchEvent(new Event('input'));
      res.innerHTML = '';
    });
  });
};

function _loadCurrentlyIssued() {
  var el     = document.getElementById('currently-issued-list');
  var active = LibraryDB.getActiveTransactions().slice(0, 6);
  if (!active.length) { el.innerHTML = 'No books currently issued.'; return; }
  el.innerHTML = active.map(function(t) {
    var b = LibraryDB.getBook(t.book_access_no);
    var borrower = _borrowerCell(t);
    var isTeacher = t.borrower_type === 'teacher';
    var days = LibraryDB.calcLateDays(t.due_date);
    var rightSide = isTeacher
      ? '<span class="text-sm text-muted">No due date</span>'
      : (days > 0 ? '<span class="overdue-chip">+' + days + 'd</span>' : '<span class="text-sm text-muted">Due ' + LibraryDB.formatDate(t.due_date) + '</span>');
    return '<div style="padding:8px 0;border-bottom:1px solid var(--cream-dark);display:flex;justify-content:space-between;align-items:center">'
      + '<div><strong style="font-size:13px">' + _esc(b ? b.document : t.book_access_no) + '</strong><br>'
      + '<span style="font-size:11px;color:var(--text-muted)">' + t.book_access_no + ' · ' + _esc(borrower.name) + '</span></div>'
      + rightSide
      + '</div>';
  }).join('');
}

function _renderDamagedList() {
  var el      = document.getElementById('damaged-books-list');
  var damaged = LibraryDB.getBooks().filter(function(b){ return ['Damaged','Under Repair','Lost'].includes(b.status); });
  if (!damaged.length) { el.innerHTML = '<p class="text-sm text-muted">No damaged books on record.</p>'; return; }
  var bm = { Damaged:'badge-coral', 'Under Repair':'badge-yellow', Lost:'badge-gray' };
  el.innerHTML = damaged.map(function(b) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--cream-dark);font-size:13px;gap:8px">'
      + '<div style="flex:1;min-width:0"><strong>' + _esc(b.document) + '</strong><br><span class="td-id">' + _esc(b.access_no) + '</span></div>'
      + '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">'
      + '<span class="badge ' + (bm[b.status]||'badge-gray') + '">' + _esc(b.status) + '</span>'
      + '<button class="btn btn-green btn-sm" data-restore-access="' + _esc(b.access_no) + '" data-restore-status="' + _esc(b.status) + '">🔧 Restore</button>'
      + '</div></div>';
  }).join('');
  el.querySelectorAll('[data-restore-access]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      openRestoreModal(btn.dataset.restoreAccess, btn.dataset.restoreStatus);
    });
  });
}

/* ══════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════ */
function _setText(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}

function _esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/`/g,'&#96;');
}

/**
 * _borrowerCell(txn) → { name, sub }
 * Returns display strings for a transaction's borrower, whether it's a
 * student (name + ADM No) or a teacher (name + "Staff" tag, no ADM No).
 */
function _borrowerCell(txn) {
  if (txn.borrower_type === 'teacher') {
    return { name: '👨‍🏫 ' + (txn.teacher_name || 'Staff'), sub: txn.teacher_email || 'Staff loan' };
  }
  var student = LibraryDB.getStudent(txn.student_adm_no);
  return { name: student ? student.name : txn.student_adm_no, sub: txn.student_adm_no };
}

/**
 * _dueDateCell(txn) → HTML string for the due-date column/label.
 * Teacher loans have no due date and are never overdue.
 */
function _dueDateCell(txn) {
  if (txn.borrower_type === 'teacher') return 'No due date';
  return LibraryDB.formatDate(txn.due_date);
}

/* ══════════════════════════════════════════════
   BOOT  ← single DOMContentLoaded, clean sequence
══════════════════════════════════════════════ */
function _initWorkstationLock(startApp) {
  var api = window.electronAPI && window.electronAPI.workstation;
  if (!api) { startApp(); return; }
  var config = { configured: false, locked: false, idleMinutes: 10 };
  var lastActivity = Date.now();
  var booted = false;
  var busy = false;
  var overlay = document.getElementById('workstation-lock-screen');
  var background = Array.from(document.body.children).filter(function(element) {
    return element !== overlay && element.tagName !== 'SCRIPT';
  });
  var unlockInput = document.getElementById('workstation-unlock-pin');
  var unlockStatus = document.getElementById('workstation-unlock-status');
  function startOnce() { if (!booted) { booted = true; startApp(); } }
  function showLock() {
    config.locked = true;
    document.body.classList.add('workstation-is-locked');
    background.forEach(function(element) { element.inert = true; });
    overlay.hidden = false;
    unlockInput.value = '';
    unlockStatus.textContent = '';
    unlockInput.focus();
  }
  function hideLock() {
    config.locked = false;
    overlay.hidden = true;
    background.forEach(function(element) { element.inert = false; });
    document.body.classList.remove('workstation-is-locked');
    lastActivity = Date.now();
    startOnce();
  }
  function renderConfig() {
    document.getElementById('workstation-idle-minutes').value = String(config.idleMinutes);
    document.getElementById('workstation-lock-shortcut').hidden = !config.configured;
    document.getElementById('workstation-lock-now').hidden = !config.configured;
    document.getElementById('workstation-current-pin').required = config.configured;
    document.getElementById('workstation-current-label').textContent = config.configured ? '(required to change)' : '(not needed yet)';
    document.getElementById('workstation-pin-status').textContent = config.configured
      ? 'PIN enabled. Lock with Ctrl+L or after inactivity.' : 'No PIN set yet.';
  }
  async function lockNow() {
    if (!config.configured || config.locked || busy) return;
    busy = true;
    try {
      var result = await api.lock();
      if (result.ok) showLock();
      else showToast(result.msg || 'Could not lock workstation.', 'error');
    } catch (error) { showToast(error.message, 'error'); }
    finally { busy = false; }
  }
  document.getElementById('workstation-pin-form').addEventListener('submit', async function(event) {
    event.preventDefault();
    if (busy) return;
    var pin = document.getElementById('workstation-new-pin').value;
    var oldPin = document.getElementById('workstation-current-pin').value;
    var minutes = Number(document.getElementById('workstation-idle-minutes').value);
    busy = true;
    try {
      var result = await api.setPin(pin, minutes, oldPin);
      if (!result.ok) { showToast(result.msg, 'error'); return; }
      config = result;
      document.getElementById('workstation-new-pin').value = '';
      document.getElementById('workstation-current-pin').value = '';
      lastActivity = Date.now();
      renderConfig();
      showToast('Workstation PIN saved locally.', 'success');
    } catch (error) { showToast(error.message, 'error'); }
    finally { busy = false; }
  });
  document.getElementById('workstation-unlock-form').addEventListener('submit', async function(event) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    try {
      var result = await api.unlock(unlockInput.value);
      unlockInput.value = '';
      if (result.ok) { config = result; hideLock(); }
      else { unlockStatus.textContent = result.msg || 'Incorrect PIN.'; unlockInput.focus(); }
    } catch (error) { unlockStatus.textContent = error.message; }
    finally { busy = false; }
  });
  document.getElementById('workstation-lock-shortcut').addEventListener('click', lockNow);
  document.getElementById('workstation-lock-now').addEventListener('click', lockNow);
  window.addEventListener('keydown', function(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
      event.preventDefault(); event.stopPropagation(); lockNow();
    }
    if (!config.locked) lastActivity = Date.now();
  }, true);
  ['pointerdown', 'wheel', 'touchstart'].forEach(function(name) {
    window.addEventListener(name, function() { if (!config.locked) lastActivity = Date.now(); }, { passive: true });
  });
  setInterval(function() {
    if (config.configured && !config.locked && Date.now() - lastActivity >= config.idleMinutes * 60000) lockNow();
  }, 15000);
  api.status().then(function(result) {
    config = result;
    renderConfig();
    if (config.locked) showLock(); else hideLock();
  }).catch(function(error) {
    console.error('[WorkstationLock]', error);
    showToast('Could not check workstation lock.', 'error');
  });
}

document.addEventListener('DOMContentLoaded', function() {

  /* ── 1. Activate dashboard immediately so there's no blank white screen ── */
  document.querySelectorAll('.page-view').forEach(function(p){ p.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.remove('active'); });
  var dashView = document.getElementById('page-dashboard');
  var dashNav  = document.querySelector('[data-page="dashboard"]');
  if (dashView) dashView.classList.add('active');
  if (dashNav)  dashNav.classList.add('active');

  /* ── 2. Wait for SQLite and verified legacy migration ── */
  LibraryDB.onReady(function() {
    _initWorkstationLock(function() {
    const migrationNotice = LibraryDB.getMigrationNotice();
    if (migrationNotice) showToast(migrationNotice, 'success', 8000);

    /* Wire all event listeners */
    document.querySelectorAll('.nav-item').forEach(function(item) {
      item.addEventListener('click', function(){ navigate(item.dataset.page); });
    });
    _initTopbarSearch();
    _initIssuePage();
    _initReturnPage();
    _initDamagePage();
    _initSearchPage();
    _initAddBookModal();
    _initAddStudentModal();
    _initImports();
    _initSettings();
    _initNotificationsPage();
    if (window.electronAPI && window.electronAPI.onMenuBackup) {
      window.electronAPI.onMenuBackup(async function() {
        var res = await LibraryDB.backupData();
        if (!res || !res.cancelled) showToast(res && res.ok === false ? (res.msg || 'Backup failed.') : 'Backup saved.', res && res.ok === false ? 'error' : 'success');
      });
    }

    document.getElementById('records-filter').addEventListener('change', _renderRecords);
    document.getElementById('book-search').addEventListener('input', _renderBookCatalogue);
    document.getElementById('student-search').addEventListener('input', _renderStudents);
    window.addEventListener('tomeva:students-updated', function() {
      if (document.getElementById('page-students').classList.contains('active')) _renderStudents();
      if (document.getElementById('setup-overlay')?.classList.contains('visible')) checkSetupComplete();
    });
    var reqFilter = document.getElementById('requests-filter');
    if (reqFilter) reqFilter.addEventListener('change', _renderRequests);

    /* ── 3. Now render with real data ── */
    if (!_checkOnboarding()) _renderDashboard();

    /* ── 4. Start Firebase sync + listeners after UI is ready ── */
    if (window.FirebaseSync) {
      FirebaseSync.startSyncScheduler();
      FirebaseSync.startControlListener(_applyControlState);
      FirebaseSync.startRequestsListener(function(requests) {
        _allRequests = requests;
        var activeView = document.querySelector('.page-view.active');
        if (activeView && activeView.id === 'page-requests') _renderRequests();
      });
    }
    });
  });
});

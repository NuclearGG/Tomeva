
  // XSS-safe HTML escaping
  function _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/`/g, '&#96;');
  }

  // Quick student search for Issue page
  function quickStudentSearch(q) {
    const res = document.getElementById('quick-student-results');
    if (!q) { res.innerHTML = ''; return; }
    const students = LibraryDB.searchStudents(q).slice(0, 5);
    if (!students.length) { res.innerHTML = '<p class="text-sm text-muted">No students found.</p>'; return; }
    res.innerHTML = students.map(s =>
      `<div class="search-result-item" data-student-id="${_esc(s.adm_no || s.student_id)}" style="margin-bottom:6px; cursor:pointer">
        <div class="sr-left">
          <h4 style="font-size:13px">${_esc(s.name || ((s.first_name || '') + ' ' + (s.last_name || '')).trim())}</h4>
          <p>${_esc(s.adm_no || s.student_id)} · Class ${_esc(s.class)}${_esc(s.section)}</p>
        </div>
      </div>`
    ).join('');

    // Use event delegation instead of inline onclick
    res.querySelectorAll('[data-student-id]').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.studentId;
        document.getElementById('issue-student-id').value = id;
        document.getElementById('issue-student-id').dispatchEvent(new Event('input'));
        res.innerHTML = '';
        document.getElementById('quick-student-search').value = '';
      });
    });
  }

  // Currently issued list for Return page
  // NOTE: loadCurrentlyIssued() lives in app.js as _loadCurrentlyIssued()
  // (kept in sync with the current LokiJS schema — access_no/adm_no/teacher fields).

  // Damaged books for damage page
  // NOTE: LibraryDB.getSettings() must NOT be called here — LokiJS may not be
  // ready yet. The loan/fine display is handled inside LibraryDB.onReady() in app.js.
  document.addEventListener('DOMContentLoaded', () => {


  // ── SETUP OVERLAY import handlers ──
  document.getElementById('setup-import-books').addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const res = LibraryDB.importBooks(e.target.result);
      if (res.ok) {
        showToast('✅ ' + res.count + ' books imported!', 'success');
        checkSetupComplete();
      } else {
        showToast('❌ ' + res.msg, 'error');
      }
    };
    reader.readAsText(file);
    this.value = '';
  });

  document.getElementById('setup-import-students').addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const res = LibraryDB.importStudents(e.target.result);
      if (res.ok) {
        showToast('✅ ' + res.count + ' students imported!', 'success');
        checkSetupComplete();
      } else {
        showToast('❌ ' + res.msg, 'error');
      }
    };
    reader.readAsText(file);
    this.value = '';
  });

    // Load currently issued on return page nav
    document.querySelector('[data-page="return"]').addEventListener('click', () => {
      setTimeout(_loadCurrentlyIssued, 50);
    });

    // Load damaged books on damage page nav
    document.querySelector('[data-page="damage"]').addEventListener('click', () => {
      setTimeout(() => {
        const el = document.getElementById('damaged-books-list');
        const damaged = LibraryDB.getBooks().filter(b => ['Damaged','Under Repair','Lost'].includes(b.status));
        if (!damaged.length) { el.innerHTML = '<p class="text-sm text-muted">No damaged books on record.</p>'; return; }
        el.innerHTML = damaged.map(b => {
          const badgeMap = { Damaged: 'badge-coral', 'Under Repair': 'badge-yellow', Lost: 'badge-gray' };
          return `<div style="display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--cream-dark); font-size:13px; gap:8px">
            <div style="flex:1; min-width:0">
              <strong>${_esc(b.title)}</strong><br>
              <span class="td-id">${_esc(b.book_id)}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px; flex-shrink:0">
              <span class="badge ${badgeMap[b.status]}">${_esc(b.status)}</span>
              <button class="btn btn-green btn-sm" data-book-id="${_esc(b.book_id)}" data-status="${_esc(b.status)}">🔧 Restore</button>
            </div>
          </div>`;
        }).join('');

        // Event delegation for restore buttons
        el.querySelectorAll('[data-book-id]').forEach(btn => {
          btn.addEventListener('click', () => {
            openRestoreModal(btn.dataset.bookId, btn.dataset.status);
          });
        });
      }, 50);
    });
  });

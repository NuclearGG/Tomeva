// Setup imports; circulation lists and student search live in app.js.
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

  });

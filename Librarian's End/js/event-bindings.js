
// Compiled event handlers. Data attributes never contain executable code.
document.addEventListener('click', function(event) {
  const element = event.target.closest('[data-handler-click]');
  if (!element) return;
  let result;
  switch (element.dataset.handlerClick) {
    case 'h0': result = (function(event) { FirebaseSync.syncNow(true) }).call(element, event); break;
    case 'h1': result = (function(event) { navigate('issue') }).call(element, event); break;
    case 'h2': result = (function(event) { navigate('return') }).call(element, event); break;
    case 'h3': result = (function(event) { navigate('fines') }).call(element, event); break;
    case 'h4': result = (function(event) { navigate('damage') }).call(element, event); break;
    case 'h5': result = (function(event) { navigate('records') }).call(element, event); break;
    case 'h6': result = (function(event) { setIssueMode('student') }).call(element, event); break;
    case 'h7': result = (function(event) { setIssueMode('teacher') }).call(element, event); break;
    case 'h9': result = (function(event) { _loadCurrentlyIssued() }).call(element, event); break;
    case 'h10': result = (function(event) { switchFinesTab('pending') }).call(element, event); break;
    case 'h11': result = (function(event) { switchFinesTab('collected') }).call(element, event); break;
    case 'h12': result = (function(event) { loadIncomingNotifications() }).call(element, event); break;
    case 'h13': result = (function(event) { openActivityLogFolder() }).call(element, event); break;
    case 'h14': result = (function(event) { refreshActivityLog() }).call(element, event); break;
    case 'h15': result = (function(event) { FirebaseSync.syncNow(true).then(_renderSyncStats) }).call(element, event); break;
    case 'h16': result = (function(event) { saveKioskCreds() }).call(element, event); break;
    case 'h17': result = (function(event) { document.getElementById('restore-modal').classList.remove('show') }).call(element, event); break;
    case 'h18': result = (function(event) { confirmRestore() }).call(element, event); break;
    case 'h19': result = (function(event) { document.getElementById('add-book-modal').classList.add('show') }).call(element, event); break;
    case 'h20': result = (function(event) { document.getElementById('add-student-modal').classList.add('show') }).call(element, event); break;
  }
  if (result === false) event.preventDefault();
});
document.addEventListener('input', function(event) {
  const element = event.target.closest('[data-handler-input]');
  if (!element) return;
  let result;
  switch (element.dataset.handlerInput) {
    case 'h8': result = (function(event) { quickStudentSearch(this.value) }).call(element, event); break;
  }
  if (result === false) event.preventDefault();
});

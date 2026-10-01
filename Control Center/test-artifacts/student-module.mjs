
import { initializeApp }  from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getFirestore, doc, onSnapshot, collection, addDoc, setDoc, updateDoc, serverTimestamp, getDoc, query, where, getDocs, limit }
  from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";

function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

function showConfirm(message, onConfirm) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay show';
  modal.innerHTML = `
    <div class="modal" style="max-width: 400px;">
      <div class="modal-title">Confirm</div>
      <p style="margin: 16px 0; color: var(--text-muted);">${_esc(message)}</p>
      <div class="modal-actions">
        <button class="btn-ghost" id="confirm-cancel">Cancel</button>
        <button class="btn-coral" id="confirm-ok">Confirm</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('confirm-ok').addEventListener('click', () => {
    modal.remove();
    onConfirm(true);
  });
  document.getElementById('confirm-cancel').addEventListener('click', () => {
    modal.remove();
    onConfirm(false);
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
      onConfirm(false);
    }
  });
}

function showAlert(message) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay show';
  modal.innerHTML = `
    <div class="modal" style="max-width: 400px;">
      <div class="modal-title">Notice</div>
      <p style="margin: 16px 0; color: var(--text-muted);">${_esc(message)}</p>
      <div class="modal-actions">
        <button class="btn-primary" id="alert-ok">OK</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('alert-ok').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

const webConfig = window.TOMEVA_WEB_CONFIG;
const firebaseConfig = webConfig.firebase;

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const LIBRARY_ID = webConfig.libraryId;
const STAFF_DOMAIN = webConfig.staffDomain || "meacademy.in";
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    for (const registration of registrations) {
      if (registration.active?.scriptURL.endsWith('/firebase-messaging-sw.js')) registration.unregister();
    }
  }).catch(() => {});
}
let alertListeners = [];
function stopStudentAlerts() {
  for (const unsubscribe of alertListeners) unsubscribe();
  alertListeners = [];
}
function browserAlert(body, route) {
  document.getElementById('push-status').textContent = body;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const notification = new Notification('Tomeva Web', { body });
  notification.onclick = () => {
    window.focus();
    if (route === 'messages') openMyMessagesModal();
    else openMyRequestsModal();
    notification.close();
  };
}
async function enablePageAlerts() {
  const status = document.getElementById('push-status');
  if (!_currentUser || _userRole !== 'student') return;
  if (!('Notification' in window) || !window.isSecureContext) { status.textContent = 'Browser alerts are unavailable here. Your inbox still works.'; return; }
  const permission = await Notification.requestPermission();
  status.textContent = permission === 'granted'
    ? 'Alerts are enabled while this page is open.'
    : 'Alerts are off. Your requests and messages remain available here.';
}
function startStudentAlerts(user) {
  stopStudentAlerts();
  const email = user.email.toLowerCase();
  const requestStatus = new Map();
  let requestsReady = false;
  alertListeners.push(onSnapshot(query(collection(db, 'libraries', LIBRARY_ID, 'book_requests'), where('requester_email', '==', email)), snapshot => {
    if (auth.currentUser?.uid !== user.uid) return;
    for (const change of snapshot.docChanges()) {
      const next = change.doc.data().status;
      const previous = requestStatus.get(change.doc.id);
      if (requestsReady && !snapshot.metadata.hasPendingWrites && change.type === 'modified' && next !== previous && ['Approved', 'Declined', 'Issued'].includes(next)) {
        browserAlert('Your library request has been updated.', 'requests');
      }
      requestStatus.set(change.doc.id, next);
    }
    requestsReady = true;
  }, error => { document.getElementById('push-status').textContent = 'Request alerts unavailable: ' + error.message; }));
  let messagesReady = false;
  alertListeners.push(onSnapshot(query(collection(db, 'libraries', LIBRARY_ID, 'student_messages'), where('recipient_email', '==', email)), snapshot => {
    if (auth.currentUser?.uid !== user.uid) return;
    if (messagesReady && !snapshot.metadata.hasPendingWrites && snapshot.docChanges().some(change => change.type === 'added')) {
      browserAlert('You have a new library message.', 'messages');
    }
    messagesReady = true;
  }, error => { document.getElementById('push-status').textContent = 'Message alerts unavailable: ' + error.message; }));
  document.getElementById('push-status').textContent = ('Notification' in window && Notification.permission === 'granted')
    ? 'Alerts are enabled while this page is open.' : 'Requests and messages update while this page is open.';
}
document.getElementById('push-button').addEventListener('click', enablePageAlerts);

let _allBooks    = []; 
let _lastUpdated = null;
let _searchQuery = "";
let _filter      = "all"; 
let _controlState = { issuance_suspended: false, suspend_reason: "" };
let _pendingRequestBook = null; 

let _currentUser = null;       
let _userRole    = null;       
let _userGroup   = null;       

window.doGoogleSignIn = async function() {
  try { await signInWithPopup(auth, googleProvider); } catch (err) { showAlert("Sign-in failed: " + err.message); }
};

window.doSignOut = async function() {
  sessionStorage.removeItem("libra_request_form");
  stopStudentAlerts();
  await signOut(auth);
  closeRequestModal();
};

window.handleAuthChipClick = function() {
  if (_currentUser) {
    showConfirm("Sign out of " + _esc(_currentUser.email) + "?", (ok) => { if (ok) doSignOut(); });
  } else {
    doGoogleSignIn();
  }
};

window.submitLoginProfile = async function() {
  const errEl = document.getElementById("fpg-profile-error");
  const cls     = document.getElementById("fpg-profile-class").value.trim();
  const section = document.getElementById("fpg-profile-section").value.trim();
  const admNo   = document.getElementById("fpg-profile-admno").value.trim();

  if (!cls || !section || !admNo) {
    errEl.textContent = "Please enter your class, section, and admission number.";
    errEl.style.display = "block";
    return;
  }
  if (!_currentUser) return;

  const btn = document.getElementById("fpg-profile-submit");
  btn.textContent = "Saving…";
  btn.disabled = true;
  errEl.style.display = "none";

  const email = _currentUser.email.toLowerCase();
  const name  = _currentUser.displayName || _currentUser.email;

  try {
    await setDoc(doc(db, "libraries", LIBRARY_ID, "student_logins", email), {
      email, name, class: cls, section, adm_no: admNo,
      first_login_at: serverTimestamp(),
      last_login_at:  serverTimestamp(),
    });
    const emailEl = document.getElementById("fpg-unverified-email");
    if (emailEl) emailEl.textContent = _currentUser.email;
    if (window._showGateState) window._showGateState("unverified");
  } catch (err) {
    errEl.textContent = "Could not save your profile: " + err.message;
    errEl.style.display = "block";
    btn.textContent = "Continue";
    btn.disabled = false;
  }
};

async function resolveUserRole(user) {
  if (!user || !user.email) return { role: "unverified", group: null };
  const email = user.email.toLowerCase();
  if (user.emailVerified && email.endsWith("@" + STAFF_DOMAIN)) return { role: "staff", group: "Staff" };
  try {
    const snap = await getDoc(doc(db, "libraries", LIBRARY_ID, "authorized_students", email));
    if (snap.exists()) return { role: "student", group: snap.data().group || "Regular" };
  } catch (err) {}
  return { role: "unverified", group: null };
}

onAuthStateChanged(auth, async (user) => {
  _currentUser = user;
  const stateChecking   = document.getElementById("fpg-state-checking");
  const stateSignedOut  = document.getElementById("fpg-state-signedout");
  const stateProfile    = document.getElementById("fpg-state-profile");
  const stateUnverified = document.getElementById("fpg-state-unverified");
  const gateOuter       = document.getElementById("full-page-gate");
  const content         = document.getElementById("app-content");

  function showGateState(name) {
    if (stateChecking)   stateChecking.style.display   = name === "checking"   ? "block" : "none";
    if (stateSignedOut)  stateSignedOut.style.display  = name === "signedout"  ? "block" : "none";
    if (stateProfile)    stateProfile.style.display    = name === "profile"    ? "block" : "none";
    if (stateUnverified) stateUnverified.style.display = name === "unverified" ? "block" : "none";
    if (gateOuter)  gateOuter.style.display  = name === "verified" ? "none"  : "flex";
    if (content)    content.style.display    = name === "verified" ? "block" : "none";
  }
  window._showGateState = showGateState;

  if (!user) {
    stopStudentAlerts();
    _userRole = null; _userGroup = null;
    document.getElementById('push-button').style.display = 'none';
    updateAuthChip(); updateRequestModalGate(); showGateState("signedout"); return;
  }

  showGateState("checking");
  const resolved = await resolveUserRole(user);
  _userRole  = resolved.role; _userGroup = resolved.group;
  document.getElementById('push-button').style.display = _userRole === 'student' ? 'inline-block' : 'none';
  if (_userRole === 'student') startStudentAlerts(user);
  else stopStudentAlerts();
  updateAuthChip(); updateRequestModalGate();

  if (_userRole === "unverified") {
    let hasProfile = false;
    try {
      const loginSnap = await getDoc(doc(db, "libraries", LIBRARY_ID, "student_logins", user.email.toLowerCase()));
      hasProfile = loginSnap.exists();
      if (hasProfile) {
        await setDoc(doc(db, "libraries", LIBRARY_ID, "student_logins", user.email.toLowerCase()), { last_login_at: serverTimestamp() }, { merge: true });
      }
    } catch (err) {}

    if (!hasProfile) {
      document.getElementById("fpg-profile-email").textContent = user.email;
      document.getElementById("fpg-profile-error").style.display = "none";
      showGateState("profile");
      return;
    }
    const emailEl = document.getElementById("fpg-unverified-email");
    if (emailEl) emailEl.textContent = user.email;
    showGateState("unverified");
    return;
  }
  showGateState("verified");
  const view = new URLSearchParams(location.search).get('view');
  if (view === 'requests') openMyRequestsModal();
  if (view === 'messages') openMyMessagesModal();
});

function updateAuthChip() {
  const chip  = document.getElementById("auth-chip");
  const icon  = document.getElementById("auth-chip-icon");
  const label = document.getElementById("auth-chip-label");
  if (!chip) return;

  if (!_currentUser) {
    chip.className = "auth-chip auth-signed-out"; icon.textContent = "👤"; label.textContent = "Sign in"; return;
  }

  const name = _currentUser.displayName || _currentUser.email;
  if (_userRole === "staff") {
    chip.className = "auth-chip auth-signed-in-staff"; icon.textContent = "🏫"; label.textContent = name;
  } else if (_userRole === "student") {
    chip.className = "auth-chip auth-signed-in-verified"; icon.textContent = _userGroup === "Regular" ? "🎓" : "⭐"; label.textContent = name;
  } else {
    chip.className = "auth-chip auth-signed-in-unverified"; icon.textContent = "⚠️"; label.textContent = name;
  }
}

function updateRequestModalGate() {
  const gateOut    = document.getElementById("req-gate-signedout");
  const gateUnver  = document.getElementById("req-gate-unverified");
  const formOk     = document.getElementById("req-form-verified");
  if (!gateOut) return;

  gateOut.style.display = "none"; gateUnver.style.display = "none"; formOk.style.display = "none";

  if (!_currentUser) { gateOut.style.display = "block"; return; }
  if (_userRole === "unverified") {
    document.getElementById("req-unverified-email").textContent = _currentUser.email;
    gateUnver.style.display = "block"; return;
  }

  formOk.style.display = "block";
  const chip = document.getElementById("req-verified-chip");
  const hint = document.getElementById("req-priority-hint");
  const groupSelect = document.getElementById("req-group");
  groupSelect.value = _userGroup;

  if (_userRole === "staff") {
    chip.className = "verified-chip staff";
    chip.textContent = "🏫 Verified as School Staff (" + _currentUser.email + ")";
    hint.style.display = "block";
    hint.textContent = "🏫 Staff requests are automatically flagged as priority for the librarian.";
  } else {
    const isPriorityGroup = _userGroup === "Literary Club" || _userGroup === "Editorial Board";
    chip.className = "verified-chip" + (isPriorityGroup ? " staff" : "");
    chip.textContent = (isPriorityGroup ? "⭐" : "✅") + " Verified as " + _userGroup + " (" + _currentUser.email + ")";
    hint.style.display = isPriorityGroup ? "block" : "none";
  }
}

onSnapshot(doc(db, "libraries", LIBRARY_ID, "meta", "control"), (snap) => {
  if (snap.exists()) {
    const d = snap.data();
    _controlState = { issuance_suspended: !!d.issuance_suspended, suspend_reason: d.suspend_reason || "" };
  } else {
    _controlState = { issuance_suspended: false, suspend_reason: "" };
  }
  renderSuspendBanner();
});

function renderSuspendBanner() {
  const el = document.getElementById("suspend-banner");
  if (!el) return;
  if (_controlState.issuance_suspended) {
    el.style.display = "flex";
    el.innerHTML = `🚫 <span>Book issuance is currently paused${_controlState.suspend_reason ? " — " + escHtml(_controlState.suspend_reason) : ""}. You can still submit requests; the librarian will process them once issuance resumes.</span>`;
  } else {
    el.style.display = "none";
  }
}

onSnapshot(doc(db, "libraries", LIBRARY_ID, "public", "catalog"), (snap) => {
  if (!snap.exists()) { showError("No library data found yet. Please wait for the librarian to sync."); return; }

  const data = snap.data();
  _lastUpdated = data.last_synced_iso ? new Date(data.last_synced_iso) : new Date();

  const available = (data.availableList || []).map(b => ({ ...b, availability: "available", status: "Available" }));
  const issued    = (data.issuedList    || []).map(b => ({ ...b, availability: "unavailable", status: "Issued" }));
  const damaged   = (data.damagedList   || []).map(b => ({ ...b, availability: "unavailable", status: b.status }));

  const seen = new Set();
  _allBooks = [];
  for (const b of [...available, ...issued, ...damaged]) {
    if (!seen.has(b.book_id)) { seen.add(b.book_id); _allBooks.push(b); }
  }

  const stats = data.stats || {};
  setText("stat-available", stats.available ?? available.length);
  setText("stat-issued",    stats.issued    ?? issued.length);
  setText("stat-total",     stats.total_books ?? _allBooks.length);

  const timeStr = _lastUpdated.toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" });
  setText("last-updated", `Last updated by librarian: ${timeStr}`);
  setLive(true);
  renderResults();
}, (err) => {
  setLive(false);
  showError("Could not connect to the library. Check your internet connection.");
});

window.doSearch = function() { _searchQuery = document.getElementById("search-input").value.trim(); renderResults(); };
window.setSearch = function(q) { document.getElementById("search-input").value = q; _searchQuery = q; renderResults(); };
window.setFilter = function(f, el) {
  _filter = f;
  document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
  if (el) el.classList.add("active");
  renderResults();
};

document.getElementById("search-input").addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });
document.getElementById("search-input").addEventListener("input", e => { _searchQuery = e.target.value.trim(); renderResults(); });

function renderResults() {
  const container = document.getElementById("results-container");
  const q = _searchQuery.toLowerCase();
  let books = _allBooks;

  if (q) {
    books = books.filter(b => (b.title || "").toLowerCase().includes(q) || (b.author || "").toLowerCase().includes(q) || (b.book_id|| "").toLowerCase().includes(q));
  }

  if (_filter === "available")   books = books.filter(b => b.availability === "available");
  if (_filter === "unavailable") books = books.filter(b => b.availability === "unavailable");

  if (_allBooks.length === 0) return;

  const allCount   = _allBooks.length;
  const availCount = _allBooks.filter(b => b.availability === "available").length;
  const issuedCount= _allBooks.filter(b => b.availability === "unavailable").length;

  let html = `<div class="filter-row">
    <span class="filter-label">Filter:</span>
    <span class="filter-chip ${_filter==="all"?"active":""}" onclick="setFilter('all', this)">All Books (${allCount})</span>
    <span class="filter-chip green-chip ${_filter==="available"?"active green-chip":""}" onclick="setFilter('available', this)">✅ Available (${availCount})</span>
    <span class="filter-chip coral-chip ${_filter==="unavailable"?"active coral-chip":""}" onclick="setFilter('unavailable', this)">📤 Issued Out (${issuedCount})</span>
  </div>`;

  if (q) {
    html += `<div class="section-header"><div class="section-title">Search Results</div><div class="results-count">${books.length} book${books.length!==1?"s":""} found</div></div>`;
    if (books.length === 0) {
      html += `<div class="no-results"><span style="font-size:48px;display:block;margin-bottom:14px">📭</span><div style="font-family:'Fraunces',serif;font-size:20px;font-weight:700;margin-bottom:8px">No books found</div><div style="font-size:14px;color:var(--text-muted)">No results for "<strong>${escHtml(q)}</strong>".<br>Try a different title, author name, or book ID.</div></div>`;
    } else {
      html += `<div class="book-list">` + books.map(b => bookListItem(b, q)).join("") + `</div>`;
    }
  } else {
    html += `<div class="section-header"><div class="section-title">${_filter === "available" ? "📗 Available Books" : _filter === "unavailable" ? "📤 Issued Out" : "📚 All Books"}</div><div class="results-count">${books.length} book${books.length!==1?"s":""}</div></div>`;
    if (books.length === 0) {
      html += `<div class="state-card"><span class="state-icon">📭</span><div class="state-title">Nothing here</div><div class="state-sub">No books match this filter.</div></div>`;
    } else {
      html += `<div class="book-grid">` + books.map(b => bookCard(b)).join("") + `</div>`;
    }
  }

  container.innerHTML = html;
  container.querySelectorAll(".request-btn[data-book-id]").forEach(btn => {
    btn.addEventListener("click", () => { openRequestModal(btn.dataset.bookId, btn.dataset.bookTitle); });
  });
}

function bookCard(b) {
  const avail = b.availability === "available";
  const icons = ["📘","📗","📙","📕","📒","📔"];
  const icon  = icons[hashStr(b.book_id || b.title) % icons.length];
  const footerText = avail ? "✅ Available now" : `📤 ${b.status === "Issued" ? "Currently issued out" : b.status}`;
  return `<div class="book-card ${b.availability}">
    <div class="book-card-top">
      <div class="book-icon">${icon}</div>
      <div class="availability-badge ${b.availability}"><div class="badge-dot"></div>${avail ? "Available" : "Not Available"}</div>
    </div>
    <div>
      <div class="book-title">${escHtml(b.title || b.book_id)}</div>
      ${b.author ? `<div class="book-author">✍️ ${escHtml(b.author)}</div>` : ""}
    </div>
    <div class="book-id">${escHtml(b.book_id)}</div>
    <div class="book-card-footer">${footerText}</div>
    <button class="request-btn" data-book-id="${escHtml(b.book_id)}" data-book-title="${escHtml(b.title || b.book_id)}">📩 Request This Book</button>
  </div>`;
}

function bookListItem(b, q) {
  const avail = b.availability === "available";
  const icons = ["📘","📗","📙","📕","📒","📔"];
  const icon  = icons[hashStr(b.book_id || b.title) % icons.length];
  return `<div class="book-list-item ${b.availability}">
    <div class="bli-icon">${icon}</div>
    <div class="bli-info">
      <div class="bli-title">${highlight(b.title || b.book_id, q)}</div>
      <div class="bli-meta">${b.author ? `<span>✍️ ${highlight(b.author, q)}</span><span class="sep">·</span>` : ""}<span class="book-id">${highlight(b.book_id, q)}</span></div>
    </div>
    <div class="bli-right">
      <div class="availability-badge ${b.availability}"><div class="badge-dot"></div>${avail ? "Available" : b.status === "Issued" ? "Issued Out" : b.status}</div>
      <button class="request-btn request-btn-sm" data-book-id="${escHtml(b.book_id)}" data-book-title="${escHtml(b.title || b.book_id)}">📩 Request</button>
    </div>
  </div>`;
}

window.openRequestModal = function(bookId, bookTitle) {
  _pendingRequestBook = { id: bookId, title: bookTitle };
  document.getElementById("req-modal-book-title").textContent = bookTitle;
  document.getElementById("req-modal-book-id").textContent    = bookId;
  document.getElementById("req-modal-error").style.display = "none";
  document.getElementById("request-modal-overlay").classList.add("show");
  try {
    const saved = JSON.parse(sessionStorage.getItem("libra_request_form") || "{}");
    if (saved.adm_no)  document.getElementById("req-adm-no").value  = saved.adm_no;
    if (saved.name)    document.getElementById("req-name").value    = saved.name;
    if (saved.class)   document.getElementById("req-class").value   = saved.class;
    if (saved.section) document.getElementById("req-section").value = saved.section;
  } catch {}
  updateRequestModalGate();
};

window.closeRequestModal = function() {
  document.getElementById("request-modal-overlay").classList.remove("show");
  document.getElementById("req-note").value = "";
};

window.submitBookRequest = async function() {
  const errEl = document.getElementById("req-modal-error");
  if (!_currentUser || _userRole === "unverified") {
    errEl.textContent = "You must be signed in and verified to submit a request.";
    errEl.style.display = "block"; return;
  }
  const adm_no  = document.getElementById("req-adm-no").value.trim();
  const name    = document.getElementById("req-name").value.trim();
  const cls     = document.getElementById("req-class").value.trim();
  const section = document.getElementById("req-section").value.trim();
  const note    = document.getElementById("req-note").value.trim();
  const group      = _userGroup;
  const isPriority = group === "Literary Club" || group === "Editorial Board" || group === "Staff";

  if (!adm_no || !name) { errEl.textContent = "Please enter your Admission Number and Name."; errEl.style.display = "block"; return; }
  if (!_pendingRequestBook) return;

  try {
    const q = query(collection(db, "libraries", LIBRARY_ID, "book_requests"), where("requester_email", "==", _currentUser.email), where("book_access_no", "==", _pendingRequestBook.id), where("status", "==", "Pending"), limit(1));
    const snapshot = await getDocs(q);
    if (!snapshot.empty) { errEl.textContent = "You already have a pending request for this book."; errEl.style.display = "block"; return; }
  } catch (e) {}

  const submitBtn = document.getElementById("req-submit-btn");
  submitBtn.textContent = "Submitting…";
  submitBtn.disabled = true; errEl.style.display = "none";

  try {
    await addDoc(collection(db, "libraries", LIBRARY_ID, "book_requests"), {
      adm_no, student_name: name, class: cls, section, group, priority: isPriority, book_access_no: _pendingRequestBook.id, book_title: _pendingRequestBook.title, note, status: "Pending", timestamp: serverTimestamp(), timestamp_iso: new Date().toISOString(), requester_email: _currentUser.email,
    });
    sessionStorage.setItem("libra_request_form", JSON.stringify({ adm_no, name, class: cls, section }));
    submitBtn.textContent = "📩 Submit Request"; submitBtn.disabled = false; closeRequestModal(); showRequestSuccessToast(isPriority);
  } catch (err) {
    errEl.textContent = "Could not submit request: " + err.message; errEl.style.display = "block"; submitBtn.textContent = "📩 Submit Request"; submitBtn.disabled = false;
  }
};

function showRequestSuccessToast(isPriority) {
  const t = document.createElement("div"); t.className = "success-toast";
  t.innerHTML = (isPriority ? "⭐ Priority request" : "📩 Request") + " sent to the librarian!";
  document.body.appendChild(t); requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 3200);
}

window.openMyRequestsModal = async function() {
  document.getElementById("my-requests-overlay").classList.add("show");
  const el = document.getElementById("my-requests-list");
  if (!_currentUser || _userRole === 'unverified') { el.textContent = 'Sign in as an authorized student or staff member to view your requests.'; return; }
  const email = _currentUser.email;
  el.textContent = 'Loading your requests…';
  try {
    const snapshot = await getDocs(query(collection(db, 'libraries', LIBRARY_ID, 'book_requests'), where('requester_email', '==', email)));
    if (_currentUser?.email !== email) return;
    const rows = snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
      .sort((a, b) => (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0));
    if (!rows.length) { el.textContent = 'No requests yet. Requests you submit will appear here.'; return; }
    const statusMap = { Pending: '⏳ Pending', Approved: '✅ Approved', Declined: '❌ Declined', Issued: '📚 Issued to you', Cancelled: '❌ Cancelled by you' };
    el.replaceChildren();
    for (const row of rows) {
      const card = document.createElement('div'); card.className = 'my-request-item';
      const body = document.createElement('div'); body.className = 'mri-body';
      const title = document.createElement('div'); title.className = 'mri-title'; title.textContent = row.book_title || 'Book request';
      const meta = document.createElement('div'); meta.className = 'mri-meta';
      const date = row.timestamp?.toDate?.() || new Date(row.timestamp_iso || 0);
      meta.textContent = `${row.book_access_no || ''} · ${date.toLocaleString('en-IN')}`;
      const status = document.createElement('div'); status.className = 'mri-status'; status.textContent = statusMap[row.status] || row.status || 'Pending';
      body.append(title, meta); card.append(body, status);
      if (row.status === 'Pending') {
        const cancel = document.createElement('button'); cancel.className = 'request-btn request-btn-sm';
        cancel.textContent = 'Cancel'; cancel.addEventListener('click', () => cancelMyRequest(row.id, row.book_title || 'this book'));
        card.append(cancel);
      }
      el.append(card);
    }
  } catch (error) { el.textContent = 'Could not load requests: ' + error.message; }
};

window.closeMyRequestsModal = function() { document.getElementById("my-requests-overlay").classList.remove("show"); };

window.openMyMessagesModal = async function() {
  if (!_currentUser || _userRole !== 'student') { showAlert('Sign in as an authorized student to read messages.'); return; }
  const overlay = document.getElementById('my-messages-overlay');
  const list = document.getElementById('my-messages-list');
  overlay.classList.add('show');
  list.textContent = 'Loading messages…';
  try {
    const snapshot = await getDocs(query(collection(db, 'libraries', LIBRARY_ID, 'student_messages'),
      where('recipient_email', '==', _currentUser.email.toLowerCase())));
    const messages = snapshot.docs.map(item => item.data())
      .sort((a, b) => (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0));
    if (!messages.length) { list.textContent = 'No messages yet.'; return; }
    list.replaceChildren();
    for (const message of messages) {
      const card = document.createElement('div');
      card.className = 'my-request-item';
      const body = document.createElement('div');
      body.className = 'mri-body';
      body.textContent = message.body || '';
      card.appendChild(body);
      list.appendChild(card);
    }
  } catch (error) { list.textContent = 'Could not load messages: ' + error.message; }
};
window.closeMyMessagesModal = function() { document.getElementById('my-messages-overlay').classList.remove('show'); };

window.cancelMyRequest = async function(requestId, bookTitle) {
  if (!_currentUser || _userRole === "unverified") {
    showAlert("You must be signed in to cancel a request.");
    return;
  }
  const confirmed = await new Promise(resolve => {
    showConfirm(`Cancel your request for "${escHtml(bookTitle)}"?`, resolve);
  });
  if (!confirmed) return;
  try {
    await updateDoc(doc(db, "libraries", LIBRARY_ID, "book_requests", requestId), {
      status: "Cancelled",
      decision_note: "Cancelled by student",
      decided_at: serverTimestamp(),
      decided_at_iso: new Date().toISOString(),
    });
    // Refresh the modal
    openMyRequestsModal();
    showAlert("Request cancelled.");
  } catch (err) {
    showAlert("Could not cancel request: " + err.message);
  }
};

function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function escHtml(str) { return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/`/g,"&#96;"); }
function escapeRegExp(str) { return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function highlight(str, q) {
  if (!q || !str) return escHtml(str);
  const safe = escHtml(str), safeQ = escHtml(q);
  return safe.replace(new RegExp(escapeRegExp(safeQ), "gi"), m => `<mark>${m}</mark>`);
}
function hashStr(s) { let h = 0; for (let i = 0; i < (s||"").length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xFFFFFF; return Math.abs(h); }
function setLive(online) {
  const dot = document.getElementById("live-dot"), status = document.getElementById("header-status");
  if (online) { dot.style.background = "var(--green-dark)"; status.textContent = "Live"; } else { dot.style.background = "var(--coral-dark)"; status.textContent = "Offline"; }
}
function showError(msg) { document.getElementById("results-container").innerHTML = `<div class="state-card"><span class="state-icon">📡</span><div class="state-title">Connection Issue</div><div class="state-sub">${escHtml(msg)}</div></div>`; setLive(false); }
window.addEventListener("offline", () => setLive(false)); window.addEventListener("online", () => setLive(true));

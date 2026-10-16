
import '../Librarian\'s End/js/cloud-shards.js';
import admissionKeys from '../desktop-integration/admission-key.cjs';
import { createSnapshotPager, fetchSnapshotPage } from './snapshot-pages.mjs';
import { createAuditedFirestore } from '../desktop-integration/admin-audit.mjs';
import { createDirectoryPager } from './directory-pages.mjs';
const { admissionKey } = admissionKeys;
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
// Cloud data is untrusted. Do not coerce strings, objects or non-finite values
// into financial amounts, and never interpolate a raw amount into HTML.
function money(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER / 100
    ? '₹' + value.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : '—';
}

const institution = await window.tomevaAdmin?.getInstitution?.();
if (!institution?.firebase) {
  const panel = document.createElement('main'); panel.className = 'admin-setup-screen'; const layout=document.createElement('div'); layout.className='admin-setup-layout'; const brand=document.createElement('section'); brand.className='admin-setup-brand'; const mark=document.createElement('img'); mark.src='assets/logo.png'; mark.alt='Tomeva'; const brandName=document.createElement('strong'); brandName.textContent='Tomeva Admin'; const brandCopy=document.createElement('p'); brandCopy.textContent='A clear view of your collection, your readers, and the work at the library desk.'; brand.append(mark,brandName,brandCopy); const content=document.createElement('section'); content.className='admin-setup-form';
  const heading = document.createElement('h1'); heading.textContent = 'Set up Tomeva Admin';
  const detail = document.createElement('p'); detail.textContent = 'Enter the public Student Portal address supplied by your institution. No Tomeva account is required.';
  const form = document.createElement('form'); form.className='form-group';
  const label = document.createElement('label'); label.textContent = 'Institution Student Portal URL';
  const input = document.createElement('input'); input.type = 'url'; input.required = true; input.autocomplete = 'url'; input.placeholder = 'https://your-school.web.app/'; input.style.cssText = 'display:block;width:100%;margin-top:8px';
  const button = document.createElement('button'); button.type = 'submit'; button.className = 'btn btn-primary'; button.textContent = 'Connect institution';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const fileHelp = document.createElement('p'); fileHelp.textContent = 'You can also choose Setup → Import institution setup to use institution.json from Control Center.';
  fileHelp.className='setup-file-help'; label.appendChild(input); form.append(label, button, status); content.append(heading, detail, form, fileHelp); layout.append(brand,content); panel.append(layout); document.body.replaceChildren(panel);
  form.addEventListener('submit', async event => {
    event.preventDefault(); button.disabled = true; status.textContent = 'Checking public institution setup…';
    try {
      const connected = await window.tomevaAdmin.connectInstitution(input.value);
      status.textContent = `Connected to ${connected.institutionName || connected.firebase.projectId}. Reloading…`;
      location.reload();
    } catch (error) { status.textContent = error.message; button.disabled = false; }
  });
} else {
const { setupKioskManagement } = await import('./kiosk-management.js');
const { parseRosterFile, rosterImportErrorMessage } = await import('./roster-import.mjs');
const { initializeApp } = await import("firebase/app");
const firestoreSdk = await import("firebase/firestore");
const {
  getFirestore, doc, collection,
  onSnapshot, Timestamp, serverTimestamp,
  query, orderBy, limit, where, getDoc, getDocs, getDocFromServer
} = firestoreSdk;
const {
  getAuth, GoogleAuthProvider, signOut, onAuthStateChanged, signInWithCredential, signInWithPopup
} = await import("firebase/auth");
document.querySelectorAll('[data-institution-name]').forEach(element => {
  element.textContent = institution.institutionName || 'Library Dashboard';
});
const firebaseConfig = institution.firebase;

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);
const { addDoc, setDoc, updateDoc, deleteDoc, runTransaction } = createAuditedFirestore({ db, actor: () => auth.currentUser, sdk: firestoreSdk });
const googleProvider = new GoogleAuthProvider();
const LIBRARY_ID = "main";
window.TomevaAppearance.load(firebaseConfig.projectId, { institutionName:institution.institutionName });
onSnapshot(doc(db, 'libraries', LIBRARY_ID, 'public', 'appearance'), { includeMetadataChanges:true }, snapshot => {
  try { window.TomevaAppearance.receive(firebaseConfig.projectId, snapshot, { institutionName:institution.institutionName }); }
  catch (error) { console.warn('[Appearance]', error.message); }
}, error => console.warn('[Appearance] Keeping cached appearance:', error.code));
const STAFF_DOMAIN = institution.staffDomain.trim().toLowerCase();
document.querySelectorAll('[data-staff-domain]').forEach(element => {
  element.textContent = '@' + STAFF_DOMAIN;
});

let _data = null, _publicData = null, _restrictedData = null, _restrictedUnsub = null;
let _lastUpdated = null, _unreadCount = 0, _adminSelectedType = "MESSAGE";
let _controlState = { issuance_suspended: false, suspend_reason: "" };
let _allRequests  = [];
let _adminCurrentUser = null;
let _isStaffVerified  = false;
let _isKioskAdmin = false;
let _allAuthorizedStudents = [];
let _allPendingLogins = [];
let _admissionRoster = [];
let _pendingRosterRows = [];
let _staffListeners = [];
let _auditEntries = [];
function startAdminAuditListener() {
  return onSnapshot(query(collection(db, 'libraries', LIBRARY_ID, 'admin_audit'), orderBy('at', 'desc'), limit(50)), snapshot => {
    _auditEntries = snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }));
    const tbody = document.getElementById('admin-audit-tbody');
    tbody.innerHTML = _auditEntries.map(entry => `<tr><td>${_esc(entry.at?.toDate?.().toLocaleString() || 'Just now')}</td><td>${_esc(entry.actorEmail)}</td><td>${_esc(entry.operation)} · ${_esc(entry.target)}</td><td>${entry.operation === 'DELETE' && ['authorized_students', 'student_logins', 'admission_roster'].includes(entry.kind) ? `<button class="btn btn-ghost btn-sm" data-recover-event="${_esc(entry.id)}">Restore record</button>` : 'Recorded'}</td></tr>`).join('');
    tbody.querySelectorAll('[data-recover-event]').forEach(button => button.addEventListener('click', async () => {
      const entry = _auditEntries.find(event => event.id === button.dataset.recoverEvent);
      if (!entry || !(await showConfirm('Restore this deleted record? Any current record and admission ownership will be preserved.'))) return;
      button.disabled = true;
      try {
        await runTransaction(db, async transaction => {
          const ref = doc(db, 'libraries', LIBRARY_ID, entry.kind, entry.documentId);
          if ((await transaction.get(ref)).exists()) throw new Error('A current record already exists. It was not overwritten.');
          const admission = entry.before.adm_no;
          if (admission && entry.before.email) {
            const claimRef = doc(db, 'libraries', LIBRARY_ID, 'adm_claims', admissionKey(admission));
            const claim = await transaction.get(claimRef);
            if (claim.exists() && claim.data().email !== entry.before.email) throw new Error('This admission number now belongs to another account.');
            transaction.set(claimRef, { adm_no: admission, email: entry.before.email });
          }
          transaction.set(ref, entry.before);
        });
        showToast('Deleted record restored and recovery recorded.', 'success');
        refreshDirectories();
      } catch (error) { showToast(error.message, 'error'); button.disabled = false; }
    }));
  }, error => { document.getElementById('admin-audit-tbody').textContent = 'Administration history unavailable: ' + error.message; });
}
function startDeletionRequestsListener() {
  return onSnapshot(query(collection(db, 'libraries', LIBRARY_ID, 'account_deletion_requests'), where('status', '==', 'Pending'), limit(25)), snapshot => {
    const container = document.getElementById('account-deletion-list'); container.replaceChildren();
    for (const entry of snapshot.docs) {
      const row = document.createElement('div'); row.className = 'list-card-header';
      const label = document.createElement('span'); label.textContent = entry.id;
      const button = document.createElement('button'); button.className = 'btn btn-ghost'; button.textContent = 'Mark completed after removal';
      button.onclick = async () => {
        try { await updateDoc(entry.ref, { status: 'Completed', completedAt: serverTimestamp(), completedBy: auth.currentUser.uid }); showToast('Deletion request completed.', 'success'); }
        catch (error) { showToast('Remove library access and the sign-in profile first. ' + error.message, 'error'); }
      };
      row.append(label, button); container.append(row);
    }
  }, error => { document.getElementById('account-deletion-list').textContent = error.message; });
}
const tableKeys = { available: 'availableList', issued: 'issuedList', damaged: 'damagedList', overdue: 'overdueList', fines: 'finesList' };
let tableView = null;
let tableEpoch = 0;
let searchTimer;
// Remove the older persistent public catalogue cache from previous builds.
try { localStorage.removeItem('tomeva-public-catalog-cache'); } catch {}
function closeTableView() {
  clearTimeout(searchTimer); tableEpoch++;
  if (tableView) {
    tableView.pager.clear();
    tableView.abort?.abort();
    document.getElementById(tableView.id + '-tbody')?.replaceChildren();
    document.getElementById(tableView.id + '-paging')?.remove();
  }
  tableView = null;
}
window.addEventListener('pagehide', closeTableView);
function tableRows(id) { return tableView?.id === id ? tableView.rows : []; }
async function loadTablePage(id, page = 0, search = '') {
  const restricted = ['issued', 'overdue', 'fines'].includes(id);
  const manifest = restricted ? _restrictedData : _publicData;
  if (!manifest || (restricted && !_isStaffVerified)) return;
  if (tableView?.id !== id || tableView.manifest !== manifest) {
    closeTableView();
    const name = restricted ? 'circulation_shards' : 'catalog_shards';
    const view = { id, manifest, rows: [] };
    view.pager = createSnapshotPager(async (generation, index) => fetchSnapshotPage({
      projectId: firebaseConfig.projectId, apiKey: firebaseConfig.apiKey,
      token: auth.currentUser ? await auth.currentUser.getIdToken() : null,
      collection: name, generation, index, signal: view.abort.signal,
    }));
    tableView = view;
  }
  const current = tableView, ticket = ++tableEpoch;
  current.abort?.abort(); current.abort = new AbortController();
  current.pager.cancel();
  current.page = page; current.search = search; current.loading = true;
  const tbody = document.getElementById(id + '-tbody');
  tbody.setAttribute('aria-busy', 'true');
  tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state" role="status">Loading 25 records…</div></td></tr>';
  let controls = document.getElementById(id + '-paging');
  if (!controls) { controls = document.createElement('div'); controls.id = id + '-paging'; controls.className = 'list-card-header'; tbody.closest('.list-card').appendChild(controls); }
  controls.replaceChildren();
  try {
    const result = await current.pager.read(manifest, tableKeys[id], page, search);
    if (ticket !== tableEpoch || current !== tableView) return;
    current.rows = result.rows; current.loading = false;
    ({ available: renderAvailable, issued: renderIssued, damaged: renderDamaged, overdue: renderOverdue, fines: renderFines })[id]();
    if (search && !result.rows.length) { tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">No matching records in this catalogue.</div></td></tr>'; }
    const previous = document.createElement('button'), next = document.createElement('button'), status = document.createElement('span');
    previous.className = next.className = 'btn btn-ghost btn-sm';
    previous.textContent = 'Previous 25'; next.textContent = 'Next 25';
    previous.disabled = page === 0; next.disabled = !result.hasMore;
    status.setAttribute('role', 'status');
    status.textContent = result.rows.length ? `Showing ${page * 25 + 1}–${page * 25 + result.rows.length}${search ? ' matching records' : ''}` : (search ? 'No matching records' : 'No records');
    previous.onclick = () => loadTablePage(id, page - 1, search);
    next.onclick = () => loadTablePage(id, page + 1, search);
    controls.replaceChildren(previous, status, next);
  } catch (error) {
    if (ticket !== tableEpoch || current !== tableView) return;
    current.loading = false;
    tbody.replaceChildren();
    const row = tbody.insertRow(), cell = row.insertCell(); cell.colSpan = 7; cell.textContent = error.message;
    const retry = document.createElement('button'); retry.className = 'btn btn-ghost'; retry.textContent = 'Retry'; retry.onclick = () => loadTablePage(id, page, search); controls.replaceChildren(retry);
  } finally { if (ticket === tableEpoch) tbody.setAttribute('aria-busy', 'false'); }
}

/* ── TOAST ── */
function showToast(msg, type="default", dur=3200) {
  const icons={success:"✅",error:"❌",warning:"⚠️",default:"ℹ️"};
  const c=document.getElementById("toast-container");
  const t=document.createElement("div");
  t.className=`toast ${type}`;
  const icon=document.createElement("span");
  icon.textContent=icons[type]||"ℹ️";
  const text=document.createElement("span");
  text.textContent=String(msg||"");
  t.append(icon,text);
  c.appendChild(t);
  setTimeout(()=>{t.style.opacity="0";t.style.transform="translateX(20px)";t.style.transition="0.3s";setTimeout(()=>t.remove(),320);},dur);
}

function showConfirm(message) {
  return new Promise(resolve => {
    const modal=document.createElement("div");
    modal.className="modal-overlay show";
    modal.innerHTML=`
      <div class="modal" style="max-width:400px">
        <div class="modal-title">Confirm</div>
        <p style="margin:16px 0;color:var(--text-muted)">${_esc(message)}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-confirm="cancel">Cancel</button>
          <button class="btn btn-coral" data-confirm="ok">Confirm</button>
        </div>
      </div>`;
    const done=(ok)=>{modal.remove();resolve(ok);};
    modal.addEventListener("click",e=>{
      if(e.target===modal) done(false);
      if(e.target.dataset.confirm==="cancel") done(false);
      if(e.target.dataset.confirm==="ok") done(true);
    });
    document.body.appendChild(modal);
  });
}

/* ── CONNECTION ── */
function setConnection(online) {
  const el=document.getElementById("connection-indicator");
  const dot=el.querySelector(".online-dot");
  const ban=document.getElementById("offline-banner");
  if(online){
    el.className="online-indicator";
    el.querySelector("span:last-child").textContent="Live";
    dot.style.background="var(--green-dark)";
    if(ban) ban.style.display="none";
  } else {
    el.className="online-indicator offline-indicator";
    el.querySelector("span:last-child").textContent="Offline";
    dot.style.background="var(--text-muted)";
    if(ban) ban.style.display="flex";
  }
}
window.addEventListener("online",()=>setConnection(true));
window.addEventListener("offline",()=>setConnection(false));
setConnection(navigator.onLine);

/* ══════════════════════════════
   COUNT-UP ANIMATION
══════════════════════════════ */
function countUp(el, target, prefix="", duration=900) {
  if (!el) return;
  const start = Date.now();
  const from  = 0;
  const isFloat = String(target).includes('.');

  function tick() {
    const elapsed = Date.now() - start;
    const progress = Math.min(elapsed / duration, 1);
    // ease-out-cubic
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = from + (target - from) * ease;
    el.textContent = prefix + (isFloat ? current.toFixed(0) : Math.round(current));
    if (progress < 1) requestAnimationFrame(tick);
    else el.textContent = prefix + target;
  }
  requestAnimationFrame(tick);
}

/* ══════════════════════════════
   DONUT CHART (SVG, animated)
══════════════════════════════ */
function buildDonut(segments, total, centerLabel, centerSub) {
  const R = 60, CX = 80, CY = 80;
  const circumference = 2 * Math.PI * R;

  // Build SVG paths with stroke-dasharray animation
  let offset = 0;
  const paths = segments.map(seg => {
    const pct   = total > 0 ? seg.val / total : 0;
    const dash  = pct * circumference;
    const gap   = circumference - dash;
    const path  = `<circle
      cx="${CX}" cy="${CY}" r="${R}"
      fill="none"
      stroke="${seg.color}"
      stroke-width="20"
      stroke-dasharray="${dash} ${gap}"
      stroke-dashoffset="${-offset}"
      style="transition: stroke-dasharray 1.1s cubic-bezier(.4,0,.2,1)"
    />`;
    offset += dash;
    return path;
  });

  // Legend
  const legend = segments.map(seg => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${seg.color}"></div>
      <span class="legend-label">${seg.label}</span>
      <span class="legend-val">${seg.val}</span>
    </div>
  `).join("");

  return `
    <div class="donut-wrap">
      <div class="donut-svg-wrap">
        <svg class="donut-svg" width="160" height="160" viewBox="0 0 160 160">
          <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--cream-dark)" stroke-width="20"/>
          ${paths.join("")}
        </svg>
        <div class="donut-center-label">
          <div class="donut-center-val" id="donut-center-num">0</div>
          <div class="donut-center-sub">${centerSub}</div>
        </div>
      </div>
      <div class="donut-legend">${legend}</div>
    </div>`;
}

/* ══════════════════════════════
   ANIMATED PROGRESS BARS
══════════════════════════════ */
function buildProgressBars(rows) {
  return rows.map(r => {
    const id = "pb-" + r.label.replace(/\s/g,"");
    return `
      <div class="bar-row">
        <div class="bar-row-header">
          <span style="font-size:13px;font-weight:600;color:var(--text)">${r.label}</span>
          <span class="bar-val">${r.val ?? 0} <span style="font-size:11px;color:var(--text-light)">(${r.pct}%)</span></span>
        </div>
        <div class="progress-wrap">
          <div class="progress-bar" id="${id}" style="background:${r.color}"></div>
        </div>
      </div>`;
  }).join("");
}

function animateBars(rows) {
  // Small delay so DOM is painted
  requestAnimationFrame(() => {
    setTimeout(() => {
      rows.forEach(r => {
        const el = document.getElementById("pb-" + r.label.replace(/\s/g,""));
        if (el) el.style.width = r.pct + "%";
      });
    }, 80);
  });
}

/* ══════════════════════════════
   STAT CARDS HTML
══════════════════════════════ */
function buildStatCards(s) {
  const cards = [
    { id:'s-available', val:s.available, label:'On the shelf' },
    { id:'s-issued', val:s.issued, label:'On loan' },
    { id:'s-overdue', val:s.overdue_count, label:'Overdue', tone:'exception' },
    { id:'s-students', val:s.total_students, label:'Students' },
    { id:'s-fines-count', val:s.pending_fines, label:'Pending fines' },
    { id:'s-fines-amt', val:s.total_fine_amt, label:'Fine amount', prefix:'₹' },
    { id:'s-collected', val:s.collected_total, label:'Collected, all time', prefix:'₹' },
    { id:'s-damaged', val:(s.damaged||0)+(s.under_repair||0)+(s.lost||0), label:'Damaged / lost' },
  ];
  const node = document.getElementById('overview-stats');
  node.className = 'overview-ledger';
  node.innerHTML = '<div class="collection-total"><div class="slip-label"><span class="t-icon" data-icon="books" aria-hidden="true"></span> COLLECTION LEDGER</div><div class="stat-value" id="s-total">'+_esc(s.total_books??0)+'</div><div class="stat-label">Books in your collection</div><p class="ledger-meta">On the shelf, on loan,<br>or awaiting care.</p></div><div class="overview-ledger-items">'
    + cards.map(c => '<div class="ledger-item" data-tone="'+(c.tone||'neutral')+'"><div class="stat-value" id="'+c.id+'">'+(c.prefix ? money(c.val ?? 0) : _esc(c.val??0))+'</div><div class="stat-label">'+c.label+'</div></div>').join('')+'</div>';
}

function renderOverview() {
  if (!_data) return;
  const s = _data.stats || {};
  buildStatCards(s);
  const total = s.total_books || 0;
  const statuses = [
    {label:'Available to borrow', val:s.available||0, icon:'book-open'},
    {label:'Currently on loan', val:s.issued||0, icon:'arrow-up-right'},
    {label:'Damaged or under repair', val:(s.damaged||0)+(s.under_repair||0), icon:'gear-six'},
    {label:'Lost copies', val:s.lost||0, icon:'warning-circle'},
  ];
  const updated = _lastUpdated ? _lastUpdated.toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : 'No sync received';
  const overdue = (_data.overdueList||[]).slice().sort((a,b)=>b.days_overdue-a.days_overdue).slice(0,5);
  const fines = (_data.finesList||[]).slice().sort((a,b)=>b.fine_amount-a.fine_amount).slice(0,5);
  const pendingRequests = _allRequests.filter(r=>r.status==='Pending').length;
  document.getElementById('charts-row').innerHTML = '<section class="card"><div class="card-header"><div><div class="card-title">Where the collection is</div><div class="card-subtitle">Each copy belongs to one collection state.</div></div><span class="slip-id">'+_esc(total)+' copies</span></div><div class="collection-state">'
    + statuses.map(row=>'<div class="collection-state-row"><span class="t-icon" data-icon="'+row.icon+'" aria-hidden="true"></span><strong>'+row.label+'</strong><span>'+_esc(row.val)+'<small>'+Math.round(total?row.val/total*100:0)+'%</small></span></div>').join('')
    + '</div></section><section class="card attention-slip"><div class="slip-label"><span class="t-icon" data-icon="tray" aria-hidden="true"></span> FOLLOW THROUGH</div><div class="card-title">Needs your attention</div><div class="attention-rows">'
    + [{page:'overdue',label:'Overdue books',detail:'Copies waiting to come back.',value:s.overdue_count||0},{page:'fines',label:'Pending fines',detail:'Review outstanding collections.',value:s.pending_fines||0},{page:'requests',label:'Book requests',detail:'Borrowing requests for the desk.',value:pendingRequests}].map(row=>'<button class="attention-row" data-workspace-page="'+row.page+'"><span><strong>'+row.label+'</strong><small>'+row.detail+'</small></span><span>'+_esc(row.value)+'<span class="t-icon" data-icon="arrow-right" aria-hidden="true"></span></span></button>').join('')
    + '</div><p class="overview-queue-caption">Latest library sync: '+_esc(updated)+'. Circulation records are managed at the librarian desk.</p></section>';
  const overdueHTML = !Array.isArray(_data.overdueList) && s.overdue_count > 0 ? '<p class="overview-queue-caption">Open Overdue Books to load these records, 25 at a time.</p>' : overdue.length ? overdue.map(o=>'<div class="collection-state-row"><span class="t-icon" data-icon="clock" aria-hidden="true"></span><div><strong>'+_esc(o.book_title)+'</strong><br><span class="td-id">'+_esc(o.student_name)+' · '+_esc(o.student_class)+'</span></div><span class="overdue-chip">'+_esc(o.days_overdue)+'d</span></div>').join('') : '<div class="empty-state"><span class="empty-icon"><span class="t-icon" data-icon="check-circle" aria-hidden="true"></span></span><h4>No overdue books</h4><p>The collection is returning on time.</p></div>';
  const finesHTML = !Array.isArray(_data.finesList) && s.pending_fines > 0 ? '<p class="overview-queue-caption">Open Pending Fines to load these records, 25 at a time.</p>' : fines.length ? fines.map(f=>'<div class="collection-state-row"><span class="t-icon" data-icon="coins" aria-hidden="true"></span><div><strong>'+_esc(f.student_name)+'</strong><br><span class="td-id">'+_esc(f.book_title)+'</span></div><span>'+money(f.fine_amount)+'</span></div>').join('') : '<div class="empty-state"><span class="empty-icon"><span class="t-icon" data-icon="check-circle" aria-hidden="true"></span></span><h4>No pending fines</h4><p>Outstanding balances will appear here.</p></div>';
  document.getElementById('bottom-row').innerHTML = '<section class="list-card"><div class="list-card-header"><div><div class="card-title">Overdue reading list</div><div class="card-subtitle">Open the list to review outstanding loans</div></div><button class="btn btn-ghost btn-sm" data-workspace-page="overdue">View All</button></div><div style="padding:0 24px">'+overdueHTML+'</div></section><section class="list-card"><div class="list-card-header"><div><div class="card-title">Outstanding fines</div><div class="card-subtitle">Open the list to review outstanding balances</div></div><button class="btn btn-ghost btn-sm" data-workspace-page="fines">View All</button></div><div style="padding:0 24px">'+finesHTML+'</div></section>';
}

/* ── OTHER PAGE RENDERERS (unchanged logic, no skeleton needed) ── */
function renderIssued() {
  if (!_data) return;
  const list = tableRows('issued');
  setText("issued-count-label",`${_data.stats?.issued || 0} books currently issued · 25 per page`);
  const tbody = document.getElementById("issued-tbody");
  if (!list.length){tbody.innerHTML=`<tr><td colspan="7"><div class="empty-state"><span class="empty-icon">📤</span><h4>No books issued</h4></div></td></tr>`;return;}
  tbody.innerHTML = list.map(b=>{
    const ov=b.is_overdue;
    return `<tr class="${ov?"row-overdue":""}">
      <td class="td-id">${_esc(b.book_id)}</td><td><strong>${_esc(b.book_title)}</strong></td>
      <td>${_esc(b.student_name)}<br><span class="td-id">${_esc(b.student_id)}</span></td>
      <td><span class="badge badge-blue">${_esc(b.student_class)}</span></td>
      <td>${fmtDate(b.issue_date)}</td><td>${fmtDate(b.due_date)}</td>
      <td>${ov?'<span class="overdue-chip">⏰ Overdue</span>':'<span class="badge badge-green">On Time</span>'}</td>
    </tr>`;
  }).join("");
}

function renderAvailable() {
  if (!_data) return;
  const list = tableRows('available');
  setText("available-count-label",`${_data.stats?.available || 0} books on shelf · 25 per page`);
  const tbody = document.getElementById("available-tbody");
  if (!list.length){tbody.innerHTML=`<tr><td colspan="4"><div class="empty-state"><span class="empty-icon">📗</span><h4>No books available</h4></div></td></tr>`;return;}
  tbody.innerHTML=list.map(b=>`<tr>
    <td class="td-id">${_esc(b.book_id)}</td><td><strong>${_esc(b.title)}</strong></td><td>${_esc(b.author)}</td>
    <td><span class="status-dot dot-available"></span><span class="badge badge-green">Available</span></td>
  </tr>`).join("");
}

function renderOverdue() {
  if (!_data) return;
  const list = tableRows('overdue');
  setText("overdue-total",_data.stats?.overdue_count || 0);
  const tbody=document.getElementById("overdue-tbody");
  if (!list.length){tbody.innerHTML=`<tr><td colspan="6"><div class="empty-state"><span class="empty-icon">🎉</span><h4>No overdue books!</h4></div></td></tr>`;return;}
  tbody.innerHTML=list.map(o=>`<tr class="row-overdue">
    <td><strong>${_esc(o.book_title)}</strong><br><span class="td-id">${_esc(o.book_id)}</span></td>
    <td>${_esc(o.student_name)}<br><span class="td-id">${_esc(o.student_id)}</span></td>
    <td><span class="badge badge-blue">${_esc(o.student_class)}</span></td>
    <td>${fmtDate(o.due_date)}</td>
    <td><span class="overdue-chip">⏰ ${_esc(o.days_overdue)} days</span></td>
    <td style="color:var(--coral-dark);font-family:var(--font-display);font-size:15px;font-weight:700">${money(o.fine_accrued)}</td>
  </tr>`).join("");
}

function renderFines() {
  if (!_data) return;
  const list=tableRows('fines');
  const total=_data.stats?.total_fine_amt || 0;
  setText("fines-total-amt",money(total));
  setText("fines-total-count",_data.stats?.pending_fines || 0);
  const tbody=document.getElementById("fines-tbody");
  if (!list.length){tbody.innerHTML=`<tr><td colspan="5"><div class="empty-state"><span class="empty-icon">🎊</span><h4>No pending fines</h4></div></td></tr>`;return;}
  tbody.innerHTML=list.map(f=>`<tr>
    <td><strong>${_esc(f.book_title)}</strong><br><span class="td-id">${_esc(f.book_id)}</span></td>
    <td>${_esc(f.student_name)}<br><span class="td-id">${_esc(f.student_id)}</span></td>
    <td><span class="badge badge-blue">${_esc(f.student_class)}</span></td>
    <td>${fmtDate(f.return_date)}</td>
    <td style="color:var(--yellow-dark);font-family:var(--font-display);font-size:16px;font-weight:700">${money(f.fine_amount)}</td>
  </tr>`).join("");
}

function renderDamaged() {
  if (!_data) return;
  const list=tableRows('damaged');
  const tbody=document.getElementById("damaged-tbody");
  if (!list.length){tbody.innerHTML=`<tr><td colspan="4"><div class="empty-state"><span class="empty-icon">📗</span><h4>No damaged books</h4></div></td></tr>`;return;}
  const bm={Damaged:"badge-coral","Under Repair":"badge-yellow",Lost:"badge-gray"};
  const dm={Damaged:"dot-damaged","Under Repair":"dot-repair",Lost:"dot-lost"};
  tbody.innerHTML=list.map(b=>`<tr>
    <td class="td-id">${_esc(b.book_id)}</td><td><strong>${_esc(b.title)}</strong></td><td>${_esc(b.author)}</td>
    <td><span class="status-dot ${dm[b.status]||""}"></span><span class="badge ${bm[b.status]||"badge-gray"}">${_esc(b.status)}</span></td>
  </tr>`).join("");
}

function renderLibrarianMessages(notifs, readIds) {
  const el=document.getElementById("admin-incoming-list");
  if (!el) return;
  if (!notifs.length){el.innerHTML=`<div class="empty-state"><span class="empty-icon">🔔</span><h4>No messages from librarian</h4></div>`;return;}
  const tc={MESSAGE:{icon:"💬",cls:"notif-message",label:"Message"},ALERT:{icon:"🚨",cls:"notif-alert",label:"Alert"},WARNING:{icon:"⚠️",cls:"notif-warning",label:"Warning"}};
  el.innerHTML=notifs.map(n=>{
    const cfg=tc[n.type]||tc.MESSAGE;
    const isRead=readIds.includes(n.id);
    const t=n.timestamp_iso?new Date(n.timestamp_iso).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"Just now";
    return `<div class="notif-item ${cfg.cls} ${isRead?"notif-read":"notif-unread"}" data-id="${_esc(n.id)}">
      <div class="notif-icon-col">${cfg.icon}</div>
      <div class="notif-body-col">
        <div class="notif-header-row"><span class="notif-type-label">${cfg.label}</span>${!isRead?'<span class="notif-dot"></span>':''}<span class="notif-time">${t}</span></div>
        <div class="notif-subject">${_esc(n.subject||"")}</div>
        <div class="notif-text">${_esc(n.body||"")}</div>
      </div>
    </div>`;
  }).join("");

  // Event delegation for mark as read
  el.querySelectorAll('[data-id]').forEach(item => {
    item.addEventListener('click', () => {
      markAdminNotifRead(item.dataset.id, item);
    });
  });
}

function renderAdminSent() {
  const el=document.getElementById("admin-sent-list");
  if (!el) return;
  let sent=[];
  try{sent=JSON.parse(localStorage.getItem("admin_sent"))||[];}catch{}
  if (!sent.length){el.innerHTML=`<div class="empty-state"><span class="empty-icon">📭</span><h4>No messages sent yet</h4></div>`;return;}
  const icons={MESSAGE:"💬",ALERT:"🚨",WARNING:"⚠️"};
  el.innerHTML=sent.map(n=>{
    const t=n.timestamp_iso?new Date(n.timestamp_iso).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"";
    return `<div class="notif-item notif-sent">
      <div class="notif-icon-col">${icons[n.type]||"💬"}</div>
      <div class="notif-body-col">
        <div class="notif-header-row"><span class="notif-type-label">${_esc(n.type)}</span><span class="notif-time">${t}</span></div>
        <div class="notif-subject">${_esc(n.subject)}</div>
        <div class="notif-text">${_esc(n.body)}</div>
      </div>
    </div>`;
  }).join("");
}

/* ── UTILS ── */
function setText(id,val){const el=document.getElementById(id);if(el)el.textContent=val;}
function fmtDate(str){if(!str)return"—";return new Date(str).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});}

/* ── FIREBASE LISTENERS ── */
function startLibraryListener() {
  setSyncBadge("loading","Connecting…");
  let readVersion = 0;
  onSnapshot(doc(db,"libraries",LIBRARY_ID,"public","catalog"),async (snap)=>{
    if (!snap.exists()){setSyncBadge("error","No data yet");return;}
    const version = ++readVersion;
    let value;
    try { value = await hydrateSnapshot(snap.data(), 'catalog_shards'); }
    catch (error) { setSyncBadge('error', error.message); return; }
    if (version !== readVersion) return;
    _publicData=value;
    _lastUpdated=_publicData.last_synced_iso?new Date(_publicData.last_synced_iso):new Date();
    refreshDashboardData();
    const t=_lastUpdated.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"});
    setSyncBadge("live","Live");
    setText("admin-sync-time",`Updated: ${t}`);
    setConnection(true);
    renderCurrentPage();
  },(err)=>{console.error("[Admin]",err);setSyncBadge("error","Connection error");});
}

async function hydrateSnapshot(manifest, name) {
  // Keep only summary metadata here. Table views fetch bounded pages on demand.
  return manifest;
}

function refreshDashboardData() {
  // The public document contains only catalog availability; borrower and fine
  // rows are read exclusively through the staff-gated circulation document.
  _data = _publicData ? { ..._publicData, ...(_restrictedData || {}) } : null;
  if (_data) renderCurrentPage();
}

function startRestrictedListener() {
  if (_restrictedUnsub) _restrictedUnsub();
  const uid = _adminCurrentUser?.uid;
  let readVersion = 0;
  _restrictedUnsub = onSnapshot(doc(db,"libraries",LIBRARY_ID,"restricted","circulation"),async (snap)=>{
    const version = ++readVersion;
    let value;
    try { value = snap.exists() ? await hydrateSnapshot(snap.data(), 'circulation_shards') : null; }
    catch (error) { setSyncBadge('error', error.message); return; }
    if (!_isStaffVerified || _adminCurrentUser?.uid !== uid || version !== readVersion) return;
    _restrictedData = value;
    refreshDashboardData();
  },(err)=>{
    console.error("[Admin circulation]",err);
    if (tableView && ['issued', 'overdue', 'fines'].includes(tableView.id)) closeTableView();
    _restrictedData = null; refreshDashboardData();
    setSyncBadge("error","Circulation unavailable");
  });
}

function startLibrarianNotifListener() {
  const q=query(collection(db,"libraries",LIBRARY_ID,"notifications"),orderBy("timestamp","desc"),limit(30));
  let initialized = false;
  return onSnapshot(q,(snap)=>{
    const readIds=getAdminReadIds();
    const notifs=[];
    snap.forEach(d=>notifs.push({id:d.id,...d.data()}));
    _unreadCount=notifs.filter(n=>!readIds.includes(n.id)).length;
    updateAdminBadge(_unreadCount);
    renderLibrarianMessages(notifs,readIds);
    snap.docChanges().forEach(change=>{
      if(initialized && _isStaffVerified && change.type==="added"&&!snap.metadata.hasPendingWrites){
        const d=change.doc.data();
        if(!getAdminReadIds().includes(change.doc.id)){
          const ic={MESSAGE:"💬",ALERT:"🚨",WARNING:"⚠️"};
          showToast(`${ic[d.type]||"🔔"} Librarian: ${d.subject}`,d.type==="ALERT"?"error":d.type==="WARNING"?"warning":"default");
          window.tomevaAdmin?.notify('LIBRARIAN_MESSAGE');
        }
      }
    });
    initialized = true;
  });
}

async function sendToLibrarian(type,subject,body){
  try{
    await addDoc(collection(db,"libraries",LIBRARY_ID,"admin_notifications"),{from:"admin",to:"librarian",type,subject,body,read:false,timestamp:serverTimestamp(),timestamp_iso:new Date().toISOString()});
    saveAdminSentHistory({type,subject,body,timestamp_iso:new Date().toISOString()});
    return{ok:true};
  }catch(err){return{ok:false,msg:err.message};}
}

/* ── LOCAL HELPERS ── */
function getAdminReadIds(){try{return JSON.parse(localStorage.getItem("admin_read_ids"))||[];}catch{return[];}}
function markAdminRead(id,el){
  const ids=getAdminReadIds();
  if(!ids.includes(id)){ids.push(id);localStorage.setItem("admin_read_ids",JSON.stringify(ids));}
  if(el){el.classList.remove("notif-unread");el.classList.add("notif-read");const dot=el.querySelector(".notif-dot");if(dot)dot.remove();}
  _unreadCount=Math.max(0,_unreadCount-1);updateAdminBadge(_unreadCount);
}
window.markAdminNotifRead=markAdminRead;

function saveAdminSentHistory(msg){
  let sent=[];try{sent=JSON.parse(localStorage.getItem("admin_sent"))||[];}catch{}
  sent.unshift(msg);if(sent.length>50)sent=sent.slice(0,50);
  localStorage.setItem("admin_sent",JSON.stringify(sent));
}
function updateAdminBadge(count){
  const b=document.getElementById("admin-notif-badge");if(!b)return;
  b.textContent=count>9?"9+":count;b.style.display=count>0?"inline-flex":"none";
}
function setSyncBadge(type,label){
  const el=document.getElementById("admin-sync-badge");if(!el)return;
  el.textContent=label;el.className=`sync-badge sync-${type}`;
}

/* ── RENDER DISPATCHER ── */
function renderCurrentPage(){
  const active=document.querySelector(".page-view.active");
  if(!active)return;
  const id=active.id.replace("page-","");
  if (tableKeys[id]) {
    const manifest = ['issued', 'overdue', 'fines'].includes(id) ? _restrictedData : _publicData;
    if (!manifest) {
      closeTableView();
      const tbody = document.getElementById(id + '-tbody');
      const row = tbody.insertRow(), cell = row.insertCell(); cell.colSpan = 7;
      cell.textContent = ['issued', 'overdue', 'fines'].includes(id) && !_isStaffVerified ? 'Sign in as authorized staff to load circulation.' : 'Waiting for the next library sync.';
      return;
    }
    if (tableView?.id !== id || tableView.manifest !== manifest) loadTablePage(id);
    return;
  }
  if(id==="overview")   renderOverview();
  if(id==="issued")     renderIssued();
  if(id==="available")  renderAvailable();
  if(id==="overdue")    renderOverdue();
  if(id==="fines")      renderFines();
  if(id==="damaged")    renderDamaged();
  if(id==="requests")   renderAdminRequests();
  if(id==="control")    renderControlPage();
  if(id==="access")     renderAccessPage();
  if(id==="kiosk")      renderKioskPage();
  if(id==="issued" || id==="available") {
    const input=document.getElementById(id==="issued"?"issued-search":"avail-search");
    if(input) window.adminApp?.filterTable(id==="issued"?"issued-tbody":"available-tbody",input.value);
  }
}

/* ── APP CONTROLLER ── */
window.adminApp={
  navigate(page){
    if (tableView?.id !== page) closeTableView();
    document.querySelectorAll(".page-view").forEach(v=>v.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach(n=>n.classList.remove("active"));
    const view=document.getElementById("page-"+page);
    const nav=document.querySelector(`[data-page="${page}"]`);
    if(view)view.classList.add("active");
    if(nav)nav.classList.add("active");
    const titles={
      overview:["Library Overview","Live data from the library — read only"],
      issued:["Issued Books","Currently borrowed books"],
      available:["Available Books","On shelf and ready to issue"],
      overdue:["Overdue Books","Books past their due date"],
      fines:["Pending Fines","Outstanding fines — cleared by librarian"],
      damaged:["Damaged & Lost","Books marked as damaged or lost"],
      requests:["Book Requests","Student borrowing requests — reviewed by librarian"],
      control:["Issuance Control","Pause or resume book issuance library-wide"],
      access:["Student Access","Manage which students can submit book requests"],
      notifications:["Notifications","Messages between admin and librarian"],
      updates:["Update approvals","Review and authorize institution software rollout"],
      kiosk:["Kiosk Provisioning","Create and revoke kiosk email/password credentials"],
    };
    const[h,s]=titles[page]||["Tomeva Admin",""];
    setText("page-heading",h);setText("page-sub",s);
    renderCurrentPage();
    if(page==="notifications"){renderAdminSent();adminApp.loadLibrarianMessages();}
  },
  refresh(){
    closeTableView();
    renderCurrentPage();
    showToast("Refreshed ✓","success",1500);
  },
  filterTable(tbodyId,q){
    const id = tbodyId.replace('-tbody', '');
    if (tableKeys[id]) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadTablePage(id, 0, q), 300);
      return;
    }
    const tbody=document.getElementById(tbodyId);if(!tbody)return;
    tbody.querySelector('.filter-empty')?.remove();
    q=q.trim().toLowerCase();
    const rows=[...tbody.querySelectorAll("tr")];
    let visible=0;
    rows.forEach(row=>{const show=!!row.querySelector('.empty-state') || row.textContent.toLowerCase().includes(q);row.style.display=show?"":"none";if(show)visible++;});
    if(q && rows.length && !visible){
      const row=document.createElement('tr');row.className='filter-empty';
      const cell=document.createElement('td');cell.colSpan=tbody.closest('table').querySelectorAll('thead th').length;
      cell.innerHTML='<div class="empty-state"><h4>No matching books</h4><p>Try another title, book ID, author, or student name.</p></div>';
      row.appendChild(cell);tbody.appendChild(row);
    }
  },
  loadLibrarianMessages(){}
};

/* ── SEND BUTTON ── */
document.getElementById("admin-send-btn").addEventListener("click",async()=>{
  const subject=document.getElementById("admin-notif-subject").value.trim();
  const body=document.getElementById("admin-notif-body").value.trim();
  if(!subject){showToast("Enter a subject.","error");return;}
  if(!body){showToast("Enter a message.","error");return;}
  const btn=document.getElementById("admin-send-btn");
  btn.textContent="Sending…";btn.disabled=true;
  const res=await sendToLibrarian(_adminSelectedType,subject,body);
  btn.textContent="✉️ Send to Librarian";btn.disabled=false;
  if(res.ok){showToast("Message sent ✓","success");document.getElementById("admin-notif-subject").value="";document.getElementById("admin-notif-body").value="";renderAdminSent();}
  else showToast(res.msg||"Failed.","error");
});

/* ── NAV CHIPS ── */
document.querySelectorAll(".notif-type-chip").forEach(chip=>{
  chip.addEventListener("click",function(){
    document.querySelectorAll(".notif-type-chip").forEach(c=>c.classList.remove("selected"));
    this.classList.add("selected");_adminSelectedType=this.dataset.type;
  });
});


document.querySelectorAll(".nav-item").forEach(item=>{
  item.addEventListener("click",()=>adminApp.navigate(item.dataset.page));
});

/* ══════════════════════════════
   BOOK REQUESTS  (read-only for admin)
══════════════════════════════ */
function renderAdminRequests() {
  const pending = _allRequests.filter(r => r.status === "Pending");
  setText("admin-requests-pending-count", pending.length);
  updateRequestsBadge(pending.length);

  const el = document.getElementById("admin-requests-list");
  if (!el) return;

  const list = _allRequests.slice().sort((a,b) => {
    if (a.priority !== b.priority) return b.priority ? 1 : -1;
    const ta = a.timestamp_iso ? new Date(a.timestamp_iso).getTime() : 0;
    const tb = b.timestamp_iso ? new Date(b.timestamp_iso).getTime() : 0;
    return tb - ta;
  });

  if (!list.length) {
    el.innerHTML = `<div class="empty-state"><span class="empty-icon">📩</span><h4>No requests yet</h4></div>`;
    return;
  }

  const statusCls   = { Pending:"status-pending", Approved:"status-approved", Declined:"status-declined", Issued:"status-issued" };
  const statusBadge = {
    Pending:  '<span class="badge badge-yellow">Pending</span>',
    Approved: '<span class="badge badge-green">Approved</span>',
    Declined: '<span class="badge badge-coral">Declined</span>',
    Issued:   '<span class="badge badge-blue">Issued</span>',
  };

  el.innerHTML = list.map(r => {
    const time = r.timestamp_iso ? new Date(r.timestamp_iso).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}) : "";
    return `<div class="request-card ${r.priority?"priority ":""}${statusCls[r.status]||""}">
      <div class="request-icon">${r.priority ? "⭐" : "📖"}</div>
      <div class="request-body">
        <div class="request-top-row">
          <span class="request-book-title">${_esc(r.book_title)}</span>
          ${r.priority ? `<span class="priority-badge">⭐ ${_esc(r.group)}</span>` : ""}
          ${statusBadge[r.status]||""}
        </div>
        <div class="request-meta">${_esc(r.student_name)} · ${_esc(r.adm_no)} · Class ${_esc(r.class)}${_esc(r.section)} · Book: ${_esc(r.book_access_no)}</div>
        ${r.note ? `<div class="request-note">"${_esc(r.note)}"</div>` : ""}
        <div class="request-time">Requested ${time}</div>
      </div>
    </div>`;
  }).join("");
}

function updateRequestsBadge(count) {
  const b = document.getElementById("admin-requests-badge");
  if (!b) return;
  b.textContent = count > 9 ? "9+" : count;
  b.style.display = count > 0 ? "inline-flex" : "none";
}

function startRequestsListener() {
  const q = query(
    collection(db, "libraries", LIBRARY_ID, "book_requests"),
    orderBy("timestamp", "desc"),
    limit(100)
  );
  let initialized = false;
  return onSnapshot(q, snap => {
    _allRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateRequestsBadge(_allRequests.filter(r => r.status === "Pending").length);
    const active = document.querySelector(".page-view.active");
    if (active && active.id === "page-requests") renderAdminRequests();
    if (active && active.id === "page-overview") renderOverview();
    if (initialized && _isStaffVerified && !snap.metadata.hasPendingWrites && snap.docChanges().some(change => change.type === 'added' && change.doc.data().status === 'Pending')) window.tomevaAdmin?.notify('NEW_REQUEST');
    initialized = true;
  }, err => console.warn("[Requests]", err.message));
}

/* ══════════════════════════════
   ISSUANCE CONTROL  (exam-time suspend toggle)
══════════════════════════════ */
function startControlListener() {
  onSnapshot(doc(db, "libraries", LIBRARY_ID, "meta", "control"), snap => {
    if (snap.exists()) {
      const d = snap.data();
      _controlState = { issuance_suspended: !!d.issuance_suspended, suspend_reason: d.suspend_reason || "" };
    } else {
      _controlState = { issuance_suspended: false, suspend_reason: "" };
    }
    renderSuspendStatusBanner();
    const active = document.querySelector(".page-view.active");
    if (active && active.id === "page-control") renderControlPage();
  }, err => console.warn("[Control]", err.message));
}

function renderSuspendStatusBanner() {
  const el = document.getElementById("admin-suspend-status");
  if (!el) return;
  if (_controlState.issuance_suspended) {
    el.style.display = "block";
    el.innerHTML = `<div class="suspend-active-banner">
      🚫 <span>Book issuance is currently <strong>suspended</strong>${_controlState.suspend_reason ? " — " + _esc(_controlState.suspend_reason) : ""}.
      <a href="#" data-handler-click="h11" style="color:var(--coral-dark);text-decoration:underline;margin-left:6px">Manage →</a></span>
    </div>`;
  } else {
    el.style.display = "none";
    el.innerHTML = "";
  }
}

function renderControlPage() {
  const statusEl  = document.getElementById("control-current-status");
  const suspendBtn = document.getElementById("suspend-issuance-btn");
  const resumeBtn  = document.getElementById("resume-issuance-btn");
  const reasonInput = document.getElementById("suspend-reason-input");

  if (_controlState.issuance_suspended) {
    statusEl.innerHTML = `<div class="suspend-active-banner">🚫 <span>Issuance is currently <strong>SUSPENDED</strong>${_controlState.suspend_reason ? " — " + _esc(_controlState.suspend_reason) : ""}</span></div>`;
    suspendBtn.style.display = "none";
    resumeBtn.style.display  = "inline-flex";
    reasonInput.value = _controlState.suspend_reason;
  } else {
    statusEl.innerHTML = `<div class="suspend-inactive-banner">✅ <span>Issuance is currently <strong>ACTIVE</strong> — books can be issued normally</span></div>`;
    suspendBtn.style.display = "inline-flex";
    resumeBtn.style.display  = "none";
  }
}

document.getElementById("suspend-issuance-btn").addEventListener("click", async () => {
  const reason = document.getElementById("suspend-reason-input").value.trim();
  if (!reason) { showToast("Enter a reason for the suspension.", "error"); return; }
  try {
    await setDoc(doc(db, "libraries", LIBRARY_ID, "meta", "control"), {
      issuance_suspended: true,
      suspend_reason: reason,
      updated_at: serverTimestamp(),
      updated_by: "admin",
    });
    showToast("Issuance suspended.", "warning");
  } catch (err) { showToast("Failed: " + err.message, "error"); }
});

document.getElementById("resume-issuance-btn").addEventListener("click", async () => {
  try {
    await setDoc(doc(db, "libraries", LIBRARY_ID, "meta", "control"), {
      issuance_suspended: false,
      suspend_reason: "",
      updated_at: serverTimestamp(),
      updated_by: "admin",
    });
    showToast("Issuance resumed.", "success");
    document.getElementById("suspend-reason-input").value = "";
  } catch (err) { showToast("Failed: " + err.message, "error"); }
});

/* ══════════════════════════════
   STAFF AUTHENTICATION  (gates the Student Access page)
══════════════════════════════ */
window.doAdminGoogleSignIn = async function() {
  try {
    // Electron opens the hosted Firebase sign-in page in the system browser.
    if (window.tomevaAdmin?.signInWithGoogle) {
      window.tomevaAdmin.signInWithGoogle();
      return;
    }
    // Fallback for web/non-Electron: use popup
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    console.error("[Auth]", err);
    showToast("Sign-in failed: " + err.message, "error");
  }
};

window.doAdminSignOut = async function() {
  closeTableView();
  await signOut(auth);
};

// Listen for OAuth callback from main process
if (window.tomevaAdmin?.onOAuthCallback) {
  window.tomevaAdmin.onOAuthCallback(async (data) => {
    if (data.error) {
      console.error("[OAuth]", data.error);
      showToast("Sign-in failed: " + (data.errorDescription || data.error), "error");
      return;
    }
    if (data.credential || data.accessToken) {
      try {
        const credential = GoogleAuthProvider.credential(data.credential || null, data.accessToken || null);
        await signInWithCredential(auth, credential);
      } catch (err) {
        console.error("[Auth]", err);
        showToast("Sign-in failed: " + err.message, "error");
      }
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  closeTableView();
  _staffListeners.forEach(stop => stop()); _staffListeners = [];
  _adminCurrentUser = user;
  _isStaffVerified = false;
  _isKioskAdmin = false;
  if (_restrictedUnsub) { _restrictedUnsub(); _restrictedUnsub = null; }
  _restrictedData = null;
  _allRequests = []; _allAuthorizedStudents = []; _allPendingLogins = []; _admissionRoster = [];
  refreshDashboardData();
  renderAccessPage();
  document.getElementById('approval-save').disabled = true;
  if (user?.emailVerified && user.email?.toLowerCase().endsWith('@' + STAFF_DOMAIN)) {
    try {
      const [staff, identity] = await Promise.all([getDocFromServer(doc(db, 'staff_accounts', user.email.toLowerCase())), user.getIdTokenResult()]);
      if (auth.currentUser?.uid !== user.uid) return;
      _isStaffVerified = identity.claims.firebase?.sign_in_provider === 'google.com' && staff.exists() && staff.data().active === true;
      if (_isStaffVerified && user.providerData?.some(provider => provider.providerId === 'google.com')) {
        const grant = await getDoc(doc(db, 'kiosk_admins', user.uid));
        if (auth.currentUser?.uid !== user.uid) return;
        _isKioskAdmin = grant.exists() && grant.data().enabled === true && grant.data().libraryId === LIBRARY_ID;
      }
    } catch (error) { console.warn('[StaffAccess]', error.message); }
  }
  refreshDashboardData();
  if (_isStaffVerified) {
    startRestrictedListener();
    _staffListeners = [startApprovalListener(), startLibrarianNotifListener(), startRequestsListener(), startAuthorizedStudentsListener(), startPendingLoginsListener(), startAdmissionRosterListener(), startAdminAuditListener(), startDeletionRequestsListener()];
  } else {
    _auditEntries = [];
    document.getElementById('admin-audit-tbody').replaceChildren();
    document.getElementById('account-deletion-list').replaceChildren();
    _allRequests = []; _allAuthorizedStudents = []; _allPendingLogins = []; _admissionRoster = [];
    renderAdminRequests(); updateRequestsBadge(0); updateAdminBadge(0);
    document.getElementById('admin-incoming-list').textContent = 'Sign in as verified staff to read library messages.';
  }
  renderAccessPage();
  document.getElementById('approval-save').disabled = !_isKioskAdmin;
});

function renderAccessPage() {
  const gateOut     = document.getElementById("access-gate-signedout");
  const gateDenied  = document.getElementById("access-gate-denied");
  const management  = document.getElementById("access-management");
  if (!gateOut) return; // page not in DOM

  gateOut.style.display    = "none";
  gateDenied.style.display = "none";
  management.style.display = "none";

  if (!_adminCurrentUser) {
    gateOut.style.display = "block";
    return;
  }

  if (!_isStaffVerified) {
    document.getElementById("access-denied-email").textContent = _adminCurrentUser.email;
    gateDenied.style.display = "block";
    return;
  }

  management.style.display = "block";
  document.getElementById("access-signed-in-as").textContent = "Signed in as " + _adminCurrentUser.email;
  renderAuthorizedStudents();
  renderPendingVerification();
}

const kioskManager = setupKioskManagement({ app, db, auth, libraryId: LIBRARY_ID, staffDomain: STAFF_DOMAIN, showToast, showConfirm });
function renderKioskPage() { kioskManager.render(); }
const updateLabels = { librarian: 'Librarian', admin: 'Admin' };
const updateIcons = { librarian: '▣', admin: '⌘' };
function updateBadge(text, className) {
  const badge = document.createElement('span');
  badge.className = 'badge ' + className;
  badge.textContent = text;
  return badge;
}
function selectApproval(component, version, policy = 'approved', notBefore = null) {
  document.getElementById('approval-component').value = component;
  document.getElementById('approval-version').value = version || '';
  document.getElementById('approval-policy').value = policy;
  if (notBefore) {
    const date = new Date(notBefore.getTime() - notBefore.getTimezoneOffset() * 60000);
    document.getElementById('approval-start').value = date.toISOString().slice(0, 16);
  } else document.getElementById('approval-start').value = '';
  document.getElementById('approval-version').focus();
}
function releaseCard(component, release) {
  const card = document.createElement('article'); card.className = 'release-card';
  const head = document.createElement('div'); head.className = 'release-card-head';
  const appName = document.createElement('div'); appName.className = 'release-app';
  const icon = document.createElement('span'); icon.className = 'release-app-icon'; icon.textContent = updateIcons[component];
  const label = document.createElement('span'); label.textContent = updateLabels[component];
  appName.append(icon, label);
  const available = release?.state === 'current-release' && /^\d+\.\d+\.\d+$/.test(release.version || '');
  head.append(appName, updateBadge(available ? 'Available' : release?.state === 'error' ? 'Error' : 'Unavailable', available ? 'badge-green' : release?.state === 'error' ? 'badge-coral' : 'badge-gray'));
  const version = document.createElement('div'); version.className = 'release-version'; version.textContent = available ? `v${release.version}` : 'No release';
  const meta = document.createElement('div'); meta.className = 'release-meta';
  meta.textContent = available && release.publishedAt ? `Published ${new Date(release.publishedAt).toLocaleString()}` : 'The publisher channel did not return a usable stable release.';
  const notes = document.createElement('div'); notes.className = 'release-notes'; notes.textContent = releaseText(release?.notes || release?.message || 'No release notes available.');
  const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'btn btn-ghost'; choose.textContent = available ? 'Use this version' : 'Release unavailable'; choose.disabled = !available;
  if (available) choose.addEventListener('click', () => selectApproval(component, release.version));
  card.append(head, version, meta, notes, choose);
  return card;
}
function releaseText(value) {
  const source = String(value || '').replace(/<\/(?:p|div|li|h[1-6]|ul|ol)>/gi, '$&\n').replace(/<br\s*\/?\s*>/gi, '\n');
  const document = new DOMParser().parseFromString(source, 'text/html');
  document.querySelectorAll('script,style,iframe,object').forEach(node => node.remove());
  return (document.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}
function renderReleaseReview(releases) {
  const container = document.getElementById('release-review'); container.replaceChildren();
  for (const component of ['librarian', 'admin']) container.appendChild(releaseCard(component, releases?.[component]));
  document.getElementById('release-status').textContent = `Checked ${new Date().toLocaleString()}. Choose “Use this version” to prepare an approval.`;
}
function renderApprovalPolicy(documents) {
  const policies = new Map(documents.map(item => [item.id, item.data()]));
  const container = document.getElementById('approval-current'); container.replaceChildren();
  for (const component of ['librarian', 'admin']) {
    const value = policies.get(component);
    const card = document.createElement('article'); card.className = 'approval-card' + (value ? ` is-${value.policy}` : '');
    const head = document.createElement('div'); head.className = 'approval-card-head';
    const appName = document.createElement('div'); appName.className = 'release-app';
    const icon = document.createElement('span'); icon.className = 'release-app-icon'; icon.textContent = updateIcons[component];
    const label = document.createElement('span'); label.textContent = updateLabels[component]; appName.append(icon, label);
    head.append(appName, updateBadge(value ? value.policy : 'Not set', value?.policy === 'approved' ? 'badge-green' : value?.policy === 'paused' ? 'badge-yellow' : 'badge-gray'));
    const version = document.createElement('div'); version.className = 'approval-version'; version.textContent = value?.version ? `v${value.version}` : 'No version approved';
    const time = document.createElement('div'); time.className = 'approval-time';
    const start = value?.notBefore?.toDate?.();
    time.textContent = value ? `${value.policy === 'approved' ? 'Installation allowed' : 'Installation blocked'}${start ? ` from ${start.toLocaleString()}` : '.'}` : 'Choose an available release to create a policy.';
    card.append(head, version, time);
    if (value) {
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn btn-ghost btn-sm'; edit.textContent = 'Edit policy';
      edit.addEventListener('click', () => selectApproval(component, value.version, value.policy, start)); card.appendChild(edit);
    }
    container.appendChild(card);
  }
}
function startApprovalListener() {
  return onSnapshot(collection(db, 'libraries', 'main', 'update_approvals'), snap => {
    renderApprovalPolicy(snap.docs);
  }, error => showToast(error.message, 'error'));
}
document.getElementById('review-releases').addEventListener('click', async () => {
  const button = document.getElementById('review-releases');
  button.disabled = true; button.textContent = 'Checking GitHub…';
  document.getElementById('release-status').textContent = 'Reading the official release channel…';
  try {
    const releases = await window.tomevaAdmin.reviewReleases();
    renderReleaseReview(releases);
  } catch (error) {
    document.getElementById('release-status').textContent = 'Release check failed. Try again when GitHub is reachable.';
    showToast(error.message, 'error');
  } finally { button.disabled = false; button.textContent = '↻ Check GitHub releases'; }
});
document.getElementById('approval-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!_isKioskAdmin) return showToast('An enabled institution administrator grant is required to approve updates.', 'error');
  const component = document.getElementById('approval-component').value;
  const version = document.getElementById('approval-version').value.trim();
  const policy = document.getElementById('approval-policy').value;
  const start = document.getElementById('approval-start').value;
  if (!/^[0-9]+[.][0-9]+[.][0-9]+$/.test(version)) return showToast('Enter a stable release version.', 'error');
  const button = document.getElementById('approval-save');
  const status = document.getElementById('approval-save-status');
  button.disabled = true; button.textContent = 'Saving policy…'; status.textContent = '';
  try {
    await setDoc(doc(db, 'libraries', 'main', 'update_approvals', component), { version, policy, notBefore: Timestamp.fromDate(start ? new Date(start) : new Date()), updatedAt: serverTimestamp() });
    status.textContent = `${updateLabels[component]} v${version} is now ${policy}.`;
    showToast('Institution update policy saved.', 'success');
  } catch (error) { status.textContent = 'Policy was not saved.'; showToast(error.message, 'error'); }
  finally { button.disabled = false; button.textContent = 'Save update policy'; }
});

document.getElementById('student-message-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!_isStaffVerified) { showToast('Sign in as verified staff to send a message.', 'error'); return; }
  const email = document.getElementById('student-message-email').value.trim().toLowerCase();
  const body = document.getElementById('student-message-body').value.trim();
  if (!body || body.length > 2000) return;
  const button = event.currentTarget.querySelector('button'); button.disabled = true;
  try {
    await addDoc(collection(db, 'libraries', LIBRARY_ID, 'student_messages'), { recipient_email: email, eventType: 'STUDENT_MESSAGE', body, timestamp: serverTimestamp() });
    document.getElementById('student-message-body').value = '';
    showToast('Message sent to the student inbox.', 'success');
  } catch (error) { showToast('Could not send message: ' + error.message, 'error'); }
  finally { button.disabled = false; }
});

/* ══════════════════════════════
   AUTHORIZED STUDENTS  (Firestore collection, staff-managed)
══════════════════════════════ */
function startAuthorizedStudentsListener() {
  return startDirectory('authorized_students', 'access', rows => { _allAuthorizedStudents = rows; renderAuthorizedStudents(); });
}

function startPendingLoginsListener() {
  return startDirectory('student_logins', 'pending', rows => { _allPendingLogins = rows; renderPendingVerification(); }, async rows => Promise.all(rows.map(async row => {
    const [access, roster] = await Promise.all([
      getDocFromServer(doc(db, 'libraries', LIBRARY_ID, 'authorized_students', row.id)),
      row.adm_no ? getDocFromServer(doc(db, 'libraries', LIBRARY_ID, 'admission_roster', encodeURIComponent(String(row.adm_no).trim().toLowerCase()))) : null,
    ]);
    return { ...row, authorized: access.exists(), roster: roster?.data() || null };
  })));
}

function startAdmissionRosterListener() {
  return startDirectory('admission_roster', 'roster', rows => {
    _admissionRoster = rows;
    document.getElementById('roster-count').textContent = `${rows.length} on this page`;
    renderAdmissionRoster();
    if (!_pendingRosterRows.length) document.getElementById('roster-status').textContent = 'Choose a CSV or JSON roster to pre-register admission numbers.';
  });
}

const directoryViews = new Map();
function startDirectory(kind, id, receive, enrich) {
  const body = document.getElementById(id === 'access' ? 'access-tbody' : id === 'pending' ? 'pending-tbody' : 'roster-tbody');
  const controls = document.createElement('div'); controls.className = 'list-card-header';
  body.closest('.table-wrap').after(controls);
  let rosterSearch;
  if (id === 'roster') {
    rosterSearch = document.createElement('input'); rosterSearch.type = 'search'; rosterSearch.maxLength = 128;
    rosterSearch.placeholder = 'Find admission number by prefix…'; rosterSearch.setAttribute('aria-label', 'Find admission number by prefix');
    rosterSearch.oninput = () => searchDirectory(id, encodeURIComponent(rosterSearch.value.trim().toLowerCase()));
    controls.before(rosterSearch);
  }
  const view = { prefix: '' };
  view.pager = createDirectoryPager({ sdk: firestoreSdk, reference: collection(db, 'libraries', LIBRARY_ID, kind), enrich,
    receive(result) {
      view.prefix = result.prefix; receive(result.rows); controls.replaceChildren();
      const previous = document.createElement('button'), next = document.createElement('button'), label = document.createElement('span');
      previous.className = next.className = 'btn btn-ghost btn-sm'; previous.textContent = 'Previous 25'; next.textContent = 'Next 25';
      previous.disabled = result.page === 0; next.disabled = !result.hasMore;
      previous.onclick = () => view.pager.load(result.page - 1); next.onclick = () => view.pager.load(result.page + 1);
      label.textContent = `Page ${result.page + 1} · ${result.rows.length} records${id === 'pending' ? ' (verified profiles hidden)' : ''}`; label.setAttribute('role', 'status');
      controls.append(previous, label, next);
    }, failure(error) { body.textContent = 'Directory unavailable: ' + error.message; controls.replaceChildren(); },
  });
  directoryViews.set(id, view); view.pager.load();
  return () => { clearTimeout(view.timer); view.pager.clear(); directoryViews.delete(id); controls.remove(); rosterSearch?.remove(); body.replaceChildren(); };
}
function searchDirectory(id, value) {
  const view = directoryViews.get(id); if (!view) return;
  clearTimeout(view.timer);
  view.timer = setTimeout(() => { view.prefix = String(value).trim().toLowerCase(); view.pager.load(0, view.prefix); }, 200);
}
function refreshDirectories() { for (const view of directoryViews.values()) view.pager.load(0, view.prefix); }

function rosterMatch(admissionNumber) {
  const wanted = String(admissionNumber || '').trim().toLowerCase();
  return wanted ? _admissionRoster.find(row => String(row.adm_no || '').trim().toLowerCase() === wanted) : null;
}

function admissionOwner(admissionNumber, email = '') {
  const key = String(admissionNumber || '').trim().toLowerCase();
  const targetEmail = String(email || '').trim().toLowerCase();
  if (!key) return null;
  return _allAuthorizedStudents.find(student => String(student.adm_no || '').trim().toLowerCase() === key && student.id !== targetEmail) ||
    _admissionRoster.find(student => String(student.adm_no || '').trim().toLowerCase() === key && student.email && student.email !== targetEmail) || null;
}

async function saveAuthorizedStudent(email, data) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const admission = String(data.adm_no).trim();
  if (!admission || admission.length > 40) throw new Error('Invalid admission number. Use at most 40 characters.');
  const claimRef = doc(db, 'libraries', LIBRARY_ID, 'adm_claims', admissionKey(admission));
  const rosterRef = doc(db, 'libraries', LIBRARY_ID, 'admission_roster', encodeURIComponent(admission.toLowerCase()));
  const accessRef = doc(db, 'libraries', LIBRARY_ID, 'authorized_students', normalizedEmail);
  await runTransaction(db, async transaction => {
    const [roster, access, claim] = await Promise.all([transaction.get(rosterRef), transaction.get(accessRef), transaction.get(claimRef)]);
    if (claim.exists() && claim.data().email !== normalizedEmail) throw new Error('This admission number is already linked to another account.');
    const claimedEmail = String(roster.data()?.email || '').trim().toLowerCase();
    if (claimedEmail && claimedEmail !== normalizedEmail) throw new Error(`Admission number ${admission} is already linked to ${claimedEmail}.`);
    if (access.exists() && String(access.data().adm_no || '').trim().toLowerCase() !== admission.toLowerCase()) throw new Error(`${normalizedEmail} is already linked to another admission number.`);
    const previous = roster.data() || {};
    transaction.set(rosterRef, {
      adm_no: admission, name: data.name || previous.name || '', email: normalizedEmail,
      class: data.class || previous.class || '', section: data.section || previous.section || '',
      group: data.group || previous.group || 'Regular',
      added_by: previous.added_by || _adminCurrentUser.email,
      added_at: previous.added_at || serverTimestamp(), updated_at: serverTimestamp(),
    });
    transaction.set(accessRef, data);
    transaction.set(claimRef, { email: normalizedEmail, adm_no: admission });
  });
}

function renderAdmissionRoster() {
  const tbody = document.getElementById('roster-tbody');
  if (!tbody) return;
  tbody.innerHTML = _admissionRoster.length ? _admissionRoster.slice().sort((a, b) => String(a.adm_no).localeCompare(String(b.adm_no))).map(row => `<tr><td class="td-id">${_esc(row.adm_no)}</td><td>${_esc(row.name || '—')}</td><td>${_esc(row.email || '—')}</td><td><button class="btn btn-ghost btn-sm" data-roster-delete="${_esc(row.id)}">Delete</button></td></tr>`).join('') : '<tr><td colspan="4" class="text-sm text-muted">No admission numbers registered yet.</td></tr>';
  tbody.querySelectorAll('[data-roster-delete]').forEach(button => button.addEventListener('click', async () => {
    const row = _admissionRoster.find(entry => entry.id === button.dataset.rosterDelete);
    if (!row || !(await showConfirm(`Delete admission number ${row.adm_no} from the pre-registration roster?`))) return;
    try { await deleteDoc(doc(db, 'libraries', LIBRARY_ID, 'admission_roster', row.id)); showToast('Roster entry deleted.', 'success'); }
    catch (error) { showToast('Could not delete roster entry: ' + error.message, 'error'); }
  }));
}

function renderRosterPreview(rows) {
  const preview = document.getElementById('roster-preview');
  const body = document.getElementById('roster-preview-body');
  const withEmail = rows.filter(row => row.email).length;
  document.getElementById('roster-summary').textContent = `${rows.length} valid admission number${rows.length === 1 ? '' : 's'} · ${withEmail} row${withEmail === 1 ? '' : 's'} include an email address · showing the first ${Math.min(rows.length, 20)}`;
  body.innerHTML = rows.slice(0, 20).map(row => `<tr><td class="td-id">${_esc(row.adm_no)}</td><td>${_esc(row.name || '—')}</td><td class="text-sm text-muted">${_esc(row.email || '—')}</td><td>${_esc([row.class, row.section].filter(Boolean).join(' ') || '—')}</td><td>${_esc(row.group)}</td></tr>`).join('');
  preview.hidden = false;
}

document.getElementById('roster-file').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  _pendingRosterRows = []; document.getElementById('roster-import').disabled = true; document.getElementById('roster-preview').hidden = true;
  if (!file) return;
  const status = document.getElementById('roster-status'); status.textContent = `Checking ${file.name}…`;
  try {
    _pendingRosterRows = await parseRosterFile(file);
    renderRosterPreview(_pendingRosterRows);
    status.textContent = `${file.name} is ready to import. Review the preview before continuing.`;
    document.getElementById('roster-import').disabled = false;
  } catch (error) { status.textContent = error.message; showToast(error.message, 'error'); }
});

document.getElementById('roster-template').addEventListener('click', () => {
  const csv = 'adm_no,name,email,class,section,group\n2026-001,Example Student,student@example.com,10,A,Regular\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = document.createElement('a'); link.href = url; link.download = 'tomeva-admission-roster-template.csv'; link.click(); URL.revokeObjectURL(url);
});

document.getElementById('roster-import').addEventListener('click', async () => {
  if (!_isStaffVerified || !_pendingRosterRows.length) return showToast('Choose a valid roster first.', 'error');
  const button = document.getElementById('roster-import'); const status = document.getElementById('roster-status');
  const authorize = document.getElementById('roster-authorize-email').checked;
  button.disabled = true; button.textContent = 'Importing…';
  try {
    for (const row of _pendingRosterRows) {
      const owner = admissionOwner(row.adm_no, row.email);
      if (owner) throw new Error(`Admission number ${row.adm_no} is already assigned to ${owner.name || owner.email || owner.id}. Review that record before importing.`);
      const current = rosterMatch(row.adm_no);
      if (current && current.email && row.email && current.email !== row.email) throw new Error(`Admission number ${row.adm_no} belongs to ${current.email}.`);
      if (authorize && row.email) {
        const existingEmail = _allAuthorizedStudents.find(student => student.id === row.email);
        if (existingEmail && String(existingEmail.adm_no || '').trim().toLowerCase() !== row.adm_no.toLowerCase()) throw new Error(`${row.email} is already linked to admission number ${existingEmail.adm_no}.`);
      }
    }
    let authorized = 0;
    for (let offset = 0; offset < _pendingRosterRows.length; offset += 1) {
      const rows = _pendingRosterRows.slice(offset, offset + 1);
      await runTransaction(db, async transaction => {
        const refs = rows.map(row => {
          if (!row.adm_no || row.adm_no.length > 40) throw new Error('Invalid admission number: ' + row.adm_no);
          return { row, roster: doc(db, 'libraries', LIBRARY_ID, 'admission_roster', encodeURIComponent(row.adm_no.toLowerCase())), claim: row.email ? doc(db, 'libraries', LIBRARY_ID, 'adm_claims', admissionKey(row.adm_no)) : null, access: authorize && row.email ? doc(db, 'libraries', LIBRARY_ID, 'authorized_students', row.email) : null };
        });
        const existing = await Promise.all(refs.map(async ref => ({ roster: await transaction.get(ref.roster), claim: ref.claim ? await transaction.get(ref.claim) : null, access: ref.access ? await transaction.get(ref.access) : null })));
        for (let index = 0; index < refs.length; index++) {
          const { row, roster, access, claim } = refs[index];
          const previous = existing[index];
          if (previous.claim?.exists() && previous.claim.data().email !== row.email) throw new Error(`Admission number ${row.adm_no} is already linked to another account.`);
          const claimedEmail = String(previous.roster.data()?.email || '').trim().toLowerCase();
          if (claimedEmail && claimedEmail !== row.email) throw new Error(`Admission number ${row.adm_no} is already linked to ${claimedEmail}.`);
          if (previous.access?.exists() && String(previous.access.data().adm_no || '').trim().toLowerCase() !== row.adm_no.toLowerCase()) throw new Error(`${row.email} is already linked to another admission number.`);
          const audit = { added_by: previous.roster.data()?.added_by || _adminCurrentUser.email, added_at: previous.roster.data()?.added_at || serverTimestamp(), updated_at: serverTimestamp() };
          transaction.set(roster, { ...row, ...audit });
          if (access) transaction.set(access, { ...row, name: row.name || row.adm_no, ...audit });
          if (claim) transaction.set(claim, { email: row.email, adm_no: row.adm_no });
        }
      });
      if (authorize) authorized += rows.filter(row => row.email).length;
      status.textContent = `Imported ${Math.min(offset + 1, _pendingRosterRows.length)} of ${_pendingRosterRows.length}…`;
    }
    status.textContent = `Imported ${_pendingRosterRows.length} admission numbers${authorize ? ` and authorized ${authorized} students with email addresses` : ''}.`;
    showToast('Admission roster imported.', 'success');
    _pendingRosterRows = []; document.getElementById('roster-file').value = ''; document.getElementById('roster-preview').hidden = true;
  } catch (error) {
    const message = rosterImportErrorMessage(error);
    status.textContent = 'Import stopped: ' + message;
    showToast(message, 'error', 9000);
  }
  finally { button.disabled = !_pendingRosterRows.length; button.textContent = 'Import roster'; }
});

function renderPendingVerification() {
  const tbody = document.getElementById("pending-tbody");
  const badge = document.getElementById("pending-count-badge");
  if (!tbody) return;

  let list = _allPendingLogins.filter(p => !p.authorized);
  list.sort((a,b) => (a.name||"").localeCompare(b.name||""));

  if (badge) {
    badge.textContent = list.length;
    badge.style.display = list.length > 0 ? "inline-flex" : "none";
  }

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><h4>No waiting profiles on this page</h4><p>Use Next 25 or search by email prefix to check other profiles.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(p => {
    const roster = p.roster; const group = roster?.group || 'Regular';
    return `<tr>
    <td><strong>${_esc(roster?.name || p.name || "—")}</strong><br><span class="text-sm text-muted">${_esc(p.email || p.id)}</span></td>
    <td>${_esc(roster?.class || p.class || "—")}</td>
    <td>${_esc(roster?.section || p.section || "—")}</td>
    <td class="td-id">${_esc(p.adm_no || "—")}${roster ? '<br><span class="badge badge-green">Roster match</span>' : ''}</td>
    <td>
      <select id="pending-group-${cssSafe(p.id)}" style="padding:6px 10px; border-radius:8px; border:1.5px solid var(--cream-dark); font-size:13px">
        <option value="Regular" ${group === 'Regular' ? 'selected' : ''}>Regular Student</option>
        <option value="Literary Club" ${group === 'Literary Club' ? 'selected' : ''}>⭐ Literary Club</option>
        <option value="Editorial Board" ${group === 'Editorial Board' ? 'selected' : ''}>⭐ Editorial Board</option>
      </select>
    </td>
    <td><button class="btn btn-green btn-sm" data-email="${_esc(p.id)}" data-name="${_esc(p.name||"")}">Approve</button> <button class="btn btn-ghost btn-sm" data-delete-pending="${_esc(p.id)}">Delete profile</button></td>
  </tr>`;
  }).join("");

  // Event delegation for approve buttons
  tbody.querySelectorAll('[data-email]').forEach(btn => {
    btn.addEventListener('click', () => {
      approvePendingStudent(btn.dataset.email, btn.dataset.name);
    });
  });
  tbody.querySelectorAll('[data-delete-pending]').forEach(btn => btn.addEventListener('click', async () => {
    const email = btn.dataset.deletePending;
    if (!(await showConfirm(`Delete the Tomeva sign-in profile for ${email}?`))) return;
    try { await deleteDoc(doc(db, 'libraries', LIBRARY_ID, 'student_logins', email)); showToast('Sign-in profile deleted.', 'success'); }
    catch (error) { showToast('Could not delete profile: ' + error.message, 'error'); }
  }));
}

function cssSafe(str) {
  return String(str).replace(/[^a-zA-Z0-9]/g, "_");
}

window.approvePendingStudent = async function(email, name) {
  if (!_isStaffVerified) { showToast("You must be signed in as staff.", "error"); return; }

  const groupSelect = document.getElementById("pending-group-" + cssSafe(email));
  const group = groupSelect ? groupSelect.value : "Regular";
  const pending = _allPendingLogins.find(student => student.id === email) || {};
  if (!String(pending.adm_no || '').trim()) { showToast('This student has no admission number in their portal profile.', 'error'); return; }
  const roster = pending.roster;
  const owner = admissionOwner(pending.adm_no, email);
  if (owner) { showToast(`Admission number ${pending.adm_no} is already assigned to ${owner.name || owner.email || owner.id}.`, 'error', 7000); return; }

  try {
    await saveAuthorizedStudent(email, {
      email, name: roster?.name || name || email, group,
      adm_no: (pending.adm_no || "").trim(),
      class: (roster?.class || pending.class || "").trim(),
      section: (roster?.section || pending.section || "").trim(),
      added_by: _adminCurrentUser.email,
      added_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    showToast(name + " approved as " + group + " ✓", "success");
    refreshDirectories();
    // The authorized_students listener will re-render both lists automatically,
    // removing this row from Pending Verification.
  } catch (err) {
    showToast("Failed: " + err.message, "error");
  }
};

function renderAuthorizedStudents() {
  const tbody = document.getElementById("access-tbody");
  if (!tbody) return;

  let list = _allAuthorizedStudents.slice().sort((a,b) => (a.name||a.email||"").localeCompare(b.name||b.email||""));

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><span class="empty-icon">🔐</span><h4>No authorized students yet</h4><p>Add a student above to get started.</p></div></td></tr>`;
    return;
  }

  const groupBadge = {
    "Regular": '<span class="badge badge-gray">Regular</span>',
    "Literary Club": '<span class="badge badge-purple">⭐ Literary Club</span>',
    "Editorial Board": '<span class="badge badge-blue">⭐ Editorial Board</span>',
  };

  tbody.innerHTML = list.map(s => `<tr>
    <td><strong>${_esc(s.name || "—")}</strong></td>
    <td class="td-id">${_esc(s.adm_no || "—")}</td>
    <td class="text-sm text-muted">${_esc(s.email)}</td>
    <td>${groupBadge[s.group] || _esc(s.group)}</td>
    <td class="text-sm text-muted">${_esc(s.added_by || "—")}</td>
    <td><button class="btn btn-coral btn-sm" data-email="${_esc(s.id)}">Delete access & profile</button></td>
  </tr>`).join("");

  // Event delegation for remove buttons
  tbody.querySelectorAll('[data-email]').forEach(btn => {
    btn.addEventListener('click', () => {
      removeAuthorizedStudent(btn.dataset.email);
    });
  });
}

window.addAuthorizedStudent = async function() {
  if (!_isStaffVerified) { showToast("You must be signed in as staff.", "error"); return; }

  const nameInput  = document.getElementById("new-access-name");
  const emailInput = document.getElementById("new-access-email");
  const groupSelect = document.getElementById("new-access-group");
  const name  = nameInput.value.trim();
  const email = emailInput.value.trim().toLowerCase();
  const group = groupSelect.value;
  const adm_no = document.getElementById("new-access-adm").value.trim();
  const studentClass = document.getElementById("new-access-class").value.trim();
  const section = document.getElementById("new-access-section").value.trim();

  if (!name)  { showToast("Enter the student's name.", "error"); return; }
  if (!email || !email.includes("@")) { showToast("Enter a valid email address.", "error"); return; }
  if (!adm_no) { showToast("Enter the student's admission number.", "error"); return; }
  const owner = admissionOwner(adm_no, email);
  if (owner) { showToast(`Admission number ${adm_no} is already assigned to ${owner.name || owner.email || owner.id}.`, 'error', 7000); return; }
  const currentEmail = _allAuthorizedStudents.find(student => student.id === email);
  if (currentEmail && String(currentEmail.adm_no || '').trim().toLowerCase() !== adm_no.toLowerCase()) { showToast(`${email} is already linked to admission number ${currentEmail.adm_no}.`, 'error', 7000); return; }

  try {
    await saveAuthorizedStudent(email, {
      email, name, group,
      adm_no, class: studentClass, section,
      added_by: _adminCurrentUser.email,
      added_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    showToast("Student authorized ✓", "success");
    nameInput.value = "";
    emailInput.value = "";
    document.getElementById("new-access-adm").value = "";
    document.getElementById("new-access-class").value = "";
    document.getElementById("new-access-section").value = "";
    groupSelect.value = "Regular";
  } catch (err) {
    showToast("Failed: " + err.message, "error");
  }
};

window.removeAuthorizedStudent = async function(email) {
  if (!(await showConfirm("Delete Tomeva access and sign-in profile for " + email + "? Historical requests will remain."))) return;
  try {
    await runTransaction(db, async transaction => {
      const accessRef = doc(db, 'libraries', LIBRARY_ID, 'authorized_students', email);
      const account = await transaction.get(accessRef);
      const admission = String(account.data()?.adm_no || '').trim();
      const rosterRef = admission ? doc(db, 'libraries', LIBRARY_ID, 'admission_roster', encodeURIComponent(admission.toLowerCase())) : null;
      const claimRef = admission ? doc(db, 'libraries', LIBRARY_ID, 'adm_claims', admissionKey(admission)) : null;
      const roster = rosterRef ? await transaction.get(rosterRef) : null;
      const claim = claimRef ? await transaction.get(claimRef) : null;
      transaction.delete(accessRef);
      transaction.delete(doc(db, "libraries", LIBRARY_ID, "student_logins", email));
      if (claim?.exists() && claim.data().email === email) transaction.delete(claimRef);
      if (roster?.exists() && String(roster.data().email || '').trim().toLowerCase() === email) transaction.update(rosterRef, { email: '', updated_at: serverTimestamp() });
    });
    showToast("Tomeva access and profile deleted.", "success");
  } catch (err) {
    showToast("Failed: " + err.message, "error");
  }
};

/* ── BOOT ── */
startLibraryListener();
startControlListener();
window.tomevaAdmin?.onNavigate(page => { if (_isStaffVerified) adminApp.navigate(page); });

// Compiled event handlers. Data attributes never contain executable code.
document.addEventListener('click', function(event) {
  const element = event.target.closest('[data-handler-click]');
  if (!element) return;
  let result;
  switch (element.dataset.handlerClick) {
    case 'h0': result = (function(event) { adminApp.refresh() }).call(element, event); break;
    case 'h3': result = (function(event) { doAdminGoogleSignIn() }).call(element, event); break;
    case 'h4': result = (function(event) { doAdminSignOut() }).call(element, event); break;
    case 'h5': result = (function(event) { addAuthorizedStudent() }).call(element, event); break;
    case 'h8': result = (function(event) { adminApp.loadLibrarianMessages() }).call(element, event); break;
    case 'h9': result = (function(event) { adminApp.navigate('overdue') }).call(element, event); break;
    case 'h10': result = (function(event) { adminApp.navigate('fines') }).call(element, event); break;
    case 'h11': result = (function(event) { adminApp.navigate('control');return false; }).call(element, event); break;
  }
  if (result === false) event.preventDefault();
});
document.addEventListener('input', function(event) {
  const element = event.target.closest('[data-handler-input]');
  if (!element) return;
  let result;
  switch (element.dataset.handlerInput) {
    case 'h1': result = (function(event) { adminApp.filterTable('issued-tbody',this.value) }).call(element, event); break;
    case 'h2': result = (function(event) { adminApp.filterTable('available-tbody',this.value) }).call(element, event); break;
    case 'h6': result = (function(event) { searchDirectory('pending', this.value) }).call(element, event); break;
    case 'h7': result = (function(event) { searchDirectory('access', this.value) }).call(element, event); break;
  }
  if (result === false) event.preventDefault();
});

}


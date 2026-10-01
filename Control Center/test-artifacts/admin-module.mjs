
import { setupKioskManagement } from './kiosk-management.js';
import { initializeApp }   from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import {
  getFirestore, doc, collection,
  onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
  query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import {
  getAuth, GoogleAuthProvider, signOut, onAuthStateChanged, signInWithCredential, signInWithPopup
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";

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

const institution = await window.tomevaAdmin?.getInstitution?.();
const firebaseConfig = institution?.firebase || {
  apiKey: "AIzaSyDNwTtjjWUeLy3oPXPrEukCb2Cp2CjAn5w",
  authDomain: "library-ebac8.firebaseapp.com",
  databaseURL: "https://library-ebac8-default-rtdb.firebaseio.com",
  projectId: "library-ebac8",
  storageBucket: "library-ebac8.firebasestorage.app",
  messagingSenderId: "1059472715236",
  appId: "1:1059472715236:web:c806d1901e1b912d5f6bf1",
  measurementId: "G-EY6745WVQN"
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const LIBRARY_ID = "main";
const STAFF_DOMAIN = institution?.staffDomain || "meacademy.in";

let _data = null, _publicData = null, _restrictedData = null, _restrictedUnsub = null;
let _lastUpdated = null, _unreadCount = 0, _adminSelectedType = "MESSAGE";
let _controlState = { issuance_suspended: false, suspend_reason: "" };
let _allRequests  = [];
let _adminCurrentUser = null;
let _isStaffVerified  = false;
let _allAuthorizedStudents = [];
let _allPendingLogins = [];
let _staffListeners = [];

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
    { cls:"blue",   icon:"📚", id:"s-total",       val: s.total_books    ?? 0, label:"Total Books" },
    { cls:"green",  icon:"📗", id:"s-available",   val: s.available      ?? 0, label:"Available" },
    { cls:"blue",   icon:"📤", id:"s-issued",      val: s.issued         ?? 0, label:"Issued Out" },
    { cls:"coral",  icon:"⏰", id:"s-overdue",     val: s.overdue_count  ?? 0, label:"Overdue" },
    { cls:"yellow", icon:"💰", id:"s-fines-count", val: s.pending_fines  ?? 0, label:"Pending Fines" },
    { cls:"yellow", icon:"₹",  id:"s-fines-amt",   val: s.total_fine_amt ?? 0, label:"Fine Amount", prefix:"₹" },
    { cls:"green",  icon:"✅", id:"s-collected",   val: s.collected_total ?? 0, label:"Fines Collected (All-time)", prefix:"₹" },
    { cls:"coral",  icon:"⚠️", id:"s-damaged",     val: (s.damaged||0)+(s.under_repair||0)+(s.lost||0), label:"Damaged/Lost" },
    { cls:"purple", icon:"🎓", id:"s-students",    val: s.total_students ?? 0, label:"Students" },
  ];

  document.getElementById("overview-stats").innerHTML = cards.map(c => `
    <div class="stat-card ${c.cls}">
      <span class="stat-icon">${c.icon}</span>
      <div class="stat-value" id="${c.id}">0</div>
      <div class="stat-label">${c.label}</div>
    </div>`).join("");

  // Trigger count-up after DOM paint
  requestAnimationFrame(() => {
    setTimeout(() => {
      cards.forEach(c => {
        countUp(document.getElementById(c.id), c.val, c.prefix || "");
      });
    }, 120);
  });
}

/* ══════════════════════════════
   RENDER OVERVIEW (with charts)
══════════════════════════════ */
function renderOverview() {
  if (!_data) return;
  const s = _data.stats || {};
  const total = s.total_books || 1;

  // Stat cards with count-up
  buildStatCards(s);

  // Sync label
  if (_lastUpdated) {
    const timeStr = _lastUpdated.toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
    const syncLabel = `<span style="font-size:12px;color:var(--text-muted)">Synced ${timeStr}</span>`;

    // ── DONUT CHART ──
    const donutSegments = [
      { label:"Available",    val: s.available      ?? 0, color:"var(--green-dark)"  },
      { label:"Issued",       val: s.issued          ?? 0, color:"var(--blue-dark)"   },
      { label:"Overdue",      val: s.overdue_count   ?? 0, color:"var(--coral-dark)"  },
      { label:"Damaged/Lost", val: (s.damaged||0)+(s.under_repair||0)+(s.lost||0), color:"var(--yellow-dark)" },
    ];
    const donutTotal = donutSegments.reduce((a,b)=>a+b.val,0) || 1;

    const donutCard = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">📊 Book Status</div>
          ${syncLabel}
        </div>
        ${buildDonut(donutSegments, donutTotal, s.total_books ?? 0, "Total Books")}
      </div>`;

    // ── PROGRESS BAR CHART ──
    const barRows = [
      { label:"Available",   val:s.available,     pct:Math.round((s.available||0)/total*100),     color:"var(--green-dark)"  },
      { label:"Issued",      val:s.issued,          pct:Math.round((s.issued||0)/total*100),          color:"var(--blue-dark)"   },
      { label:"Overdue",     val:s.overdue_count,  pct:Math.round((s.overdue_count||0)/total*100),  color:"var(--coral-dark)"  },
      { label:"Damaged",     val:(s.damaged||0)+(s.under_repair||0)+(s.lost||0), pct:Math.round(((s.damaged||0)+(s.under_repair||0)+(s.lost||0))/total*100), color:"var(--yellow-dark)" },
    ];

    const barCard = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">📈 Distribution</div>
          <span style="font-size:12px;color:var(--text-muted)">${s.total_books ?? 0} books total</span>
        </div>
        ${buildProgressBars(barRows)}
      </div>`;

    document.getElementById("charts-row").innerHTML = donutCard + barCard;

    // Animate bars & donut center
    animateBars(barRows);
    setTimeout(()=>{ countUp(document.getElementById("donut-center-num"), s.total_books ?? 0); }, 200);

    // ── OVERDUE PREVIEW ──
    const overdue = (_data.overdueList||[]).slice().sort((a,b)=>b.days_overdue-a.days_overdue).slice(0,5);
    const overdueHTML = overdue.length
      ? overdue.map(o=>`
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--cream-dark);font-size:13px;align-items:center">
            <div><strong>${_esc(o.book_title)}</strong><br><span class="td-id">${_esc(o.student_name)} · ${_esc(o.student_class)}</span></div>
            <div style="text-align:right">
              <span class="overdue-chip">⏰ ${o.days_overdue}d</span>
              <div style="color:var(--coral-dark);font-weight:700;font-size:12px;margin-top:3px">₹${o.fine_accrued}</div>
            </div>
          </div>`).join("")
      : `<div class="empty-state" style="padding:28px 16px"><span class="empty-icon" style="font-size:32px">🎉</span><h4>No overdue books</h4></div>`;

    // ── FINES PREVIEW ──
    const fines = (_data.finesList||[]).slice().sort((a,b)=>b.fine_amount-a.fine_amount).slice(0,5);
    const finesHTML = fines.length
      ? fines.map(f=>`
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--cream-dark);font-size:13px;align-items:center">
            <div><strong>${_esc(f.student_name)}</strong><br><span class="td-id">${_esc(f.book_title)} · ${_esc(f.student_class)}</span></div>
            <span class="fine-amount-big">₹${f.fine_amount}</span>
          </div>`).join("")
      : `<div class="empty-state" style="padding:28px 16px"><span class="empty-icon" style="font-size:32px">🎊</span><h4>No pending fines</h4></div>`;

    document.getElementById("bottom-row").innerHTML = `
      <div class="list-card">
        <div class="list-card-header">
          <div><div class="card-title">⏰ Overdue (Top 5)</div><div class="card-subtitle">Most days overdue first</div></div>
          <button class="btn btn-ghost btn-sm" onclick="adminApp.navigate('overdue')">View All →</button>
        </div>
        <div style="padding:0 24px 8px">${overdueHTML}</div>
      </div>
      <div class="list-card">
        <div class="list-card-header">
          <div><div class="card-title">💰 Top Fines</div><div class="card-subtitle">Highest pending fines</div></div>
          <button class="btn btn-ghost btn-sm" onclick="adminApp.navigate('fines')">View All →</button>
        </div>
        <div style="padding:0 24px 8px">${finesHTML}</div>
      </div>`;
  }
}

/* ── OTHER PAGE RENDERERS (unchanged logic, no skeleton needed) ── */
function renderIssued() {
  if (!_data) return;
  const list = _data.issuedList || [];
  setText("issued-count-label",`${list.length} books currently issued`);
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
  const list = _data.availableList || [];
  setText("available-count-label",`${list.length} books on shelf`);
  const tbody = document.getElementById("available-tbody");
  if (!list.length){tbody.innerHTML=`<tr><td colspan="4"><div class="empty-state"><span class="empty-icon">📗</span><h4>No books available</h4></div></td></tr>`;return;}
  tbody.innerHTML=list.map(b=>`<tr>
    <td class="td-id">${_esc(b.book_id)}</td><td><strong>${_esc(b.title)}</strong></td><td>${_esc(b.author)}</td>
    <td><span class="status-dot dot-available"></span><span class="badge badge-green">Available</span></td>
  </tr>`).join("");
}

function renderOverdue() {
  if (!_data) return;
  const list = (_data.overdueList||[]).slice().sort((a,b)=>b.days_overdue-a.days_overdue);
  setText("overdue-total",list.length);
  const tbody=document.getElementById("overdue-tbody");
  if (!list.length){tbody.innerHTML=`<tr><td colspan="6"><div class="empty-state"><span class="empty-icon">🎉</span><h4>No overdue books!</h4></div></td></tr>`;return;}
  tbody.innerHTML=list.map(o=>`<tr class="row-overdue">
    <td><strong>${_esc(o.book_title)}</strong><br><span class="td-id">${_esc(o.book_id)}</span></td>
    <td>${_esc(o.student_name)}<br><span class="td-id">${_esc(o.student_id)}</span></td>
    <td><span class="badge badge-blue">${_esc(o.student_class)}</span></td>
    <td>${fmtDate(o.due_date)}</td>
    <td><span class="overdue-chip">⏰ ${o.days_overdue} days</span></td>
    <td style="color:var(--coral-dark);font-family:'Fraunces',serif;font-size:15px;font-weight:700">₹${o.fine_accrued}</td>
  </tr>`).join("");
}

function renderFines() {
  if (!_data) return;
  const list=(_data.finesList||[]).slice().sort((a,b)=>b.fine_amount-a.fine_amount);
  const total=list.reduce((s,f)=>s+(f.fine_amount||0),0);
  setText("fines-total-amt","₹"+total);
  setText("fines-total-count",list.length);
  const tbody=document.getElementById("fines-tbody");
  if (!list.length){tbody.innerHTML=`<tr><td colspan="5"><div class="empty-state"><span class="empty-icon">🎊</span><h4>No pending fines</h4></div></td></tr>`;return;}
  tbody.innerHTML=list.map(f=>`<tr>
    <td><strong>${_esc(f.book_title)}</strong><br><span class="td-id">${_esc(f.book_id)}</span></td>
    <td>${_esc(f.student_name)}<br><span class="td-id">${_esc(f.student_id)}</span></td>
    <td><span class="badge badge-blue">${_esc(f.student_class)}</span></td>
    <td>${fmtDate(f.return_date)}</td>
    <td style="color:var(--yellow-dark);font-family:'Fraunces',serif;font-size:16px;font-weight:700">₹${f.fine_amount}</td>
  </tr>`).join("");
}

function renderDamaged() {
  if (!_data) return;
  const list=_data.damagedList||[];
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
  onSnapshot(doc(db,"libraries",LIBRARY_ID,"public","catalog"),(snap)=>{
    if (!snap.exists()){setSyncBadge("error","No data yet");return;}
    _publicData=snap.data();
    _lastUpdated=_publicData.last_synced_iso?new Date(_publicData.last_synced_iso):new Date();
    refreshDashboardData();
    const t=_lastUpdated.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"});
    setSyncBadge("live","Live");
    setText("admin-sync-time",`Updated: ${t}`);
    setConnection(true);
    renderCurrentPage();
  },(err)=>{console.error("[Admin]",err);setSyncBadge("error","Connection error");});
}

function refreshDashboardData() {
  // The public document contains only catalog availability; borrower and fine
  // rows are read exclusively through the staff-gated circulation document.
  _data = _publicData ? { ..._publicData, ...(_restrictedData || {}) } : null;
  if (_data) renderCurrentPage();
}

function startRestrictedListener() {
  if (_restrictedUnsub) _restrictedUnsub();
  _restrictedUnsub = onSnapshot(doc(db,"libraries",LIBRARY_ID,"restricted","circulation"),(snap)=>{
    _restrictedData = snap.exists() ? snap.data() : null;
    refreshDashboardData();
  },(err)=>{console.error("[Admin circulation]",err);setSyncBadge("error","Circulation unavailable");});
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
}

/* ── APP CONTROLLER ── */
window.adminApp={
  navigate(page){
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
      kiosk:["Kiosk Provisioning","Create and revoke kiosk email/password credentials"],
    };
    const[h,s]=titles[page]||["Tomeva Admin",""];
    setText("page-heading",h);setText("page-sub",s);
    renderCurrentPage();
    if(page==="notifications"){renderAdminSent();adminApp.loadLibrarianMessages();}
  },
  refresh(){
    renderCurrentPage();
    showToast("Refreshed ✓","success",1500);
  },
  filterTable(tbodyId,q){
    const tbody=document.getElementById(tbodyId);if(!tbody)return;
    q=q.toLowerCase();
    tbody.querySelectorAll("tr").forEach(row=>{row.style.display=row.textContent.toLowerCase().includes(q)?"":"none";});
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
      <a href="#" onclick="adminApp.navigate('control');return false;" style="color:var(--coral-dark);text-decoration:underline;margin-left:6px">Manage →</a></span>
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

onAuthStateChanged(auth, (user) => {
  _staffListeners.forEach(stop => stop()); _staffListeners = [];
  _adminCurrentUser = user;
  _isStaffVerified = !!(user && user.email && user.emailVerified && user.email.toLowerCase().endsWith("@" + STAFF_DOMAIN));
  if (_restrictedUnsub) { _restrictedUnsub(); _restrictedUnsub = null; }
  _restrictedData = null;
  refreshDashboardData();
  if (_isStaffVerified) {
    startRestrictedListener();
    _staffListeners = [startLibrarianNotifListener(), startRequestsListener(), startAuthorizedStudentsListener(), startPendingLoginsListener()];
  } else {
    _allRequests = []; _allAuthorizedStudents = []; _allPendingLogins = [];
    renderAdminRequests(); updateRequestsBadge(0); updateAdminBadge(0);
    document.getElementById('admin-incoming-list').textContent = 'Sign in as verified staff to read library messages.';
  }
  renderAccessPage();
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
  return onSnapshot(collection(db, "libraries", LIBRARY_ID, "authorized_students"), (snap) => {
    _allAuthorizedStudents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const active = document.querySelector(".page-view.active");
    if (active && active.id === "page-access") { renderAuthorizedStudents(); renderPendingVerification(); }
  }, err => console.warn("[AuthorizedStudents]", err.message));
}

function startPendingLoginsListener() {
  return onSnapshot(collection(db, "libraries", LIBRARY_ID, "student_logins"), (snap) => {
    _allPendingLogins = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const active = document.querySelector(".page-view.active");
    if (active && active.id === "page-access") renderPendingVerification();
  }, err => console.warn("[PendingLogins]", err.message));
}

function renderPendingVerification() {
  const tbody = document.getElementById("pending-tbody");
  const badge = document.getElementById("pending-count-badge");
  if (!tbody) return;

  const authorizedEmails = new Set(_allAuthorizedStudents.map(s => s.id));
  const q = (document.getElementById("pending-search")?.value || "").toLowerCase().trim();

  // Pending = anyone who's logged in but not yet in authorized_students.
  let list = _allPendingLogins.filter(p => !authorizedEmails.has(p.id));
  if (q) list = list.filter(p =>
    (p.name||"").toLowerCase().includes(q) ||
    (p.class||"").toLowerCase().includes(q) ||
    (p.section||"").toLowerCase().includes(q) ||
    (p.adm_no||"").toLowerCase().includes(q)
  );
  list.sort((a,b) => (a.name||"").localeCompare(b.name||""));

  if (badge) {
    badge.textContent = list.length;
    badge.style.display = list.length > 0 ? "inline-flex" : "none";
  }

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><span class="empty-icon">✅</span><h4>Nobody waiting</h4><p>All signed-in students have been verified.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(p => `<tr>
    <td><strong>${_esc(p.name || "—")}</strong><br><span class="text-sm text-muted">${_esc(p.email || p.id)}</span></td>
    <td>${_esc(p.class || "—")}</td>
    <td>${_esc(p.section || "—")}</td>
    <td class="td-id">${_esc(p.adm_no || "—")}</td>
    <td>
      <select id="pending-group-${cssSafe(p.id)}" style="padding:6px 10px; border-radius:8px; border:1.5px solid var(--cream-dark); font-size:13px">
        <option value="Regular">Regular Student</option>
        <option value="Literary Club">⭐ Literary Club</option>
        <option value="Editorial Board">⭐ Editorial Board</option>
      </select>
    </td>
    <td><button class="btn btn-green btn-sm" data-email="${_esc(p.id)}" data-name="${_esc(p.name||"")}">✓ Approve</button></td>
  </tr>`).join("");

  // Event delegation for approve buttons
  tbody.querySelectorAll('[data-email]').forEach(btn => {
    btn.addEventListener('click', () => {
      approvePendingStudent(btn.dataset.email, btn.dataset.name);
    });
  });
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

  try {
    await setDoc(doc(db, "libraries", LIBRARY_ID, "authorized_students", email), {
      email, name: name || email, group,
      adm_no: (pending.adm_no || "").trim(),
      class: (pending.class || "").trim(),
      section: (pending.section || "").trim(),
      added_by: _adminCurrentUser.email,
      added_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    showToast(name + " approved as " + group + " ✓", "success");
    // The authorized_students listener will re-render both lists automatically,
    // removing this row from Pending Verification.
  } catch (err) {
    showToast("Failed: " + err.message, "error");
  }
};

function renderAuthorizedStudents() {
  const tbody = document.getElementById("access-tbody");
  if (!tbody) return;

  const q = (document.getElementById("access-search")?.value || "").toLowerCase().trim();
  let list = _allAuthorizedStudents.slice().sort((a,b) => (a.name||a.email||"").localeCompare(b.name||b.email||""));
  if (q) list = list.filter(s =>
    (s.email||"").toLowerCase().includes(q) ||
    (s.name||"").toLowerCase().includes(q)
  );

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><span class="empty-icon">🔐</span><h4>No authorized students yet</h4><p>Add a student above to get started.</p></div></td></tr>`;
    return;
  }

  const groupBadge = {
    "Regular": '<span class="badge badge-gray">Regular</span>',
    "Literary Club": '<span class="badge badge-purple">⭐ Literary Club</span>',
    "Editorial Board": '<span class="badge badge-blue">⭐ Editorial Board</span>',
  };

  tbody.innerHTML = list.map(s => `<tr>
    <td><strong>${_esc(s.name || "—")}</strong></td>
    <td class="text-sm text-muted">${_esc(s.email)}</td>
    <td>${groupBadge[s.group] || _esc(s.group)}</td>
    <td class="text-sm text-muted">${_esc(s.added_by || "—")}</td>
    <td><button class="btn btn-coral btn-sm" data-email="${_esc(s.id)}">Remove</button></td>
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

  try {
    await setDoc(doc(db, "libraries", LIBRARY_ID, "authorized_students", email), {
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
  if (!(await showConfirm("Remove access for " + email + "? They will no longer be able to submit book requests."))) return;
  try {
    await deleteDoc(doc(db, "libraries", LIBRARY_ID, "authorized_students", email));
    showToast("Access removed.", "default");
  } catch (err) {
    showToast("Failed: " + err.message, "error");
  }
};

/* ── BOOT ── */
startLibraryListener();
startControlListener();
window.tomevaAdmin?.onNavigate(page => { if (_isStaffVerified) adminApp.navigate(page); });


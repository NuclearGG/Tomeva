/**
 * firebase-sync.js  —  Tomeva ↔ Admin ↔ Student  via Firestore
 *
 * Loaded as a classic <script> (NOT a module) so it shares globals with
 * db.js and app.js. Uses the Firebase compat SDK (window.firebase),
 * loaded from the installed Firebase package before this file.
 *
 * Responsibilities on the TOMEVA side:
 *   • Push the 60-min sync snapshot (books/fines/stats) to Firestore
 *   • Send/receive notifications with the admin
 *   • Listen for the admin's exam-suspend control flag
 *   • Listen for incoming student book requests
 *   • Let Tomeva approve/decline/mark-issued a request
 *
 * Authentication (Revised PRB-01):
 *   • Anonymous auth for aggregate sync (public catalog + main doc) — no PII
 *   • Registered email/password for restricted/circulation sync + book request decisions
 *   • One-time kiosk provisioning: librarian enters email/password once at setup
 *   • Transparent sign-in on init; Firebase refreshes tokens automatically
 *   • Offline: defer writes, set badge to 'offline', retry on 'online' event
 */

(function () {
  'use strict';

  let _institutionConfigured = false;

  const SYNC_INTERVAL_MS = 60 * 60 * 1000;
  const LIBRARY_ID       = 'main';
  const WORKSTATION_ID   = 'ws-main';  // Provisioned per library; could be configurable

  let _db              = null;
  let _auth            = null;
  let _syncTimer       = null;
  let _lastSyncTime    = null;
  let _syncStatus      = 'idle';
  let _notifUnsub      = null;
  let _controlUnsub    = null;
  let _requestsUnsub   = null;
  let _unreadCount     = 0;
  let _pendingRequestCount = 0;
  let _studentSyncInFlight = null;
  let _controlState    = { issuance_suspended: false, suspend_reason: '' };
  let _kioskCreds      = null;      // {email, password} from OS keychain
  let _authInitialized = false;     // Prevent duplicate auth init
  let _hasKioskClaim   = false;     // Whether the UID has an active registry entry
  let _requestCallback = null;

  /* ══════════════════════════════
     FIREBASE INIT + DUAL AUTH
  ══════════════════════════════ */

  async function _initFirebase() {
    if (_db && _auth) return true;
    if (typeof firebase === 'undefined') {
      console.error('[Sync] Firebase compat SDK not loaded.');
      return false;
    }
    try {
      if (!firebase.apps.length) {
        const provisioned = await window.electronAPI?.getInstitution?.();
        if (!provisioned?.firebase) { _setStatus('idle', 'Import institution setup from the File menu'); return false; }
        _institutionConfigured = true;
        const projectLabel = document.getElementById('sync-project-id');
        if (projectLabel) projectLabel.textContent = provisioned.firebase.projectId;
        if (firebase.apps.length) { _db = firebase.firestore(); _auth = firebase.auth(); return true; }
        firebase.initializeApp(provisioned.firebase);
      }
      _db = firebase.firestore();
      _auth = firebase.auth();
      return true;
    } catch (e) {
      console.error('[Sync] Firebase init error:', e);
      return false;
    }
  }

  let _authInitPromise = null;
  let _authUnsub = null;
  let _kioskAccessUnsub = null;

  function _setKioskAccess(approved) {
    const changed = approved !== _hasKioskClaim;
    _hasKioskClaim = approved; // Keep the public API compatible with Settings.
    if (changed && approved) {
      startNotificationListener();
      startRequestsListener(_requestCallback);
    } else if (!approved) {
      stopNotificationListener(); stopRequestsListener();
      updateNotifBadge(0); updateRequestBadge(0);
      if (_requestCallback) _requestCallback([]);
      renderIncomingNotifications([], []);
    }
    if (typeof _renderKioskCredsStatus === 'function') _renderKioskCredsStatus();
  }

  function _isApprovedRecord(snapshot, user) {
    const data = snapshot.exists ? snapshot.data() : null;
    return !!(data && data.active === true && data.libraryId === LIBRARY_ID && data.email === user.email);
  }

  function _watchKioskAccess(user) {
    if (_kioskAccessUnsub) _kioskAccessUnsub();
    _kioskAccessUnsub = null;
    _setKioskAccess(false);
    if (!user || user.isAnonymous) return;
    _kioskAccessUnsub = _db.collection('kiosk_accounts').doc(user.uid)
      .onSnapshot({ includeMetadataChanges: true }, snapshot => {
        if (_auth.currentUser?.uid !== user.uid) return;
        _setKioskAccess(navigator.onLine && !snapshot.metadata.fromCache && _isApprovedRecord(snapshot, user));
      }, () => { if (_auth.currentUser?.uid === user.uid) _setKioskAccess(false); });
  }

  async function _refreshKioskAccess() {
    const user = _auth && _auth.currentUser;
    if (!navigator.onLine || !user || user.isAnonymous) { _setKioskAccess(false); return false; }
    try {
      const snapshot = await _db.collection('kiosk_accounts').doc(user.uid).get({ source: 'server' });
      if (_auth.currentUser?.uid !== user.uid) return false;
      _setKioskAccess(_isApprovedRecord(snapshot, user));
    } catch (_) { _setKioskAccess(false); }
    return _hasKioskClaim;
  }

  async function _initDualAuth() {
    if (_authInitialized) return true;
    if (_authInitPromise) return _authInitPromise;
    _authInitPromise = (async () => {
      if (!(await _initFirebase())) return false;
      // Wait for Firebase to restore its persisted session before selecting one.
      await new Promise(resolve => {
        const unsubscribe = _auth.onAuthStateChanged(() => { unsubscribe(); resolve(); });
      });
      if (!_authUnsub) _authUnsub = _auth.onAuthStateChanged(_watchKioskAccess);
      _kioskCreds = await _getKioskCreds();
      if (_kioskCreds && navigator.onLine) await _signInWithKioskCreds();
      if (!_auth.currentUser) {
        try { await _auth.signInAnonymously(); }
        catch (_) { _setStatus(navigator.onLine ? 'error' : 'offline'); return false; }
      }
      _authInitialized = true;
      return true;
    })();
    try { return await _authInitPromise; }
    finally { _authInitPromise = null; }
  }

  async function _getKioskCreds() {
    try { return await window.electronAPI?.getKioskCreds(WORKSTATION_ID) || null; }
    catch (_) { return null; }
  }

  async function _signInWithKioskCreds() {
    _setKioskAccess(false);
    if (!navigator.onLine || !_kioskCreds?.email || !_kioskCreds?.password) return false;
    try {
      await _auth.signInWithEmailAndPassword(_kioskCreds.email, _kioskCreds.password);
      return await _refreshKioskAccess();
    } catch (_) {
      // A failed replacement must not keep the previous kiosk's approval.
      try { await _auth.signOut(); await _auth.signInAnonymously(); } catch (_) { /* retry on next sync */ }
      return false;
    }
  }

  async function _ensureKioskAuth() {
    if (!navigator.onLine) { _setKioskAccess(false); return false; }
    if (!(await _initDualAuth())) return false;
    if (!_kioskCreds) _kioskCreds = await _getKioskCreds();
    if (_kioskCreds && _auth.currentUser?.email !== _kioskCreds.email) return _signInWithKioskCreds();
    return _refreshKioskAccess();
  }

  // Store only in Electron's encrypted credential store, never in Firestore.
  async function provisionKioskCreds(email, password) {
    email = (email || '').trim().toLowerCase();
    if (!email.includes('@') || !password) return { ok: false, msg: 'Enter the kiosk email and password from the Admin app.' };
    await _initDualAuth();
    try {
      if (!window.electronAPI?.setKioskCreds) return { ok: false, msg: 'Kiosk credential storage requires the Electron app.' };
      const result = await window.electronAPI.setKioskCreds(WORKSTATION_ID, email, password);
      if (result?.ok === false) return { ok: false, msg: result.msg || 'Could not store kiosk credentials.' };
    } catch (error) { return { ok: false, msg: 'Could not store kiosk credentials: ' + error.message }; }
    _kioskCreds = { email, password };
    _setKioskAccess(false);
    if (!navigator.onLine) return { ok: true, pending: true, msg: 'Credentials saved. Approval will be checked once online.' };
    if (await _signInWithKioskCreds()) return { ok: true, msg: 'Kiosk approved - request decisions unlocked.' };
    return { ok: false, msg: 'Credentials saved but not approved. Check the email/password and that this credential is Active in the Admin app.' };
  }

  async function _signOutAll() {
    _authUnsub?.(); _authUnsub = null;
    _kioskAccessUnsub?.(); _kioskAccessUnsub = null;
    _authInitialized = false;
    _setKioskAccess(false);
    if (_auth) await _auth.signOut();
  }

  /* ══════════════════════════════
     STATUS BADGE
  ══════════════════════════════ */

  function _setStatus(status, detail) {
    _syncStatus = status;
    const labels = { idle:'Sync Ready', syncing:'Syncing…', success:'Synced', error:'Sync Error', offline:'Offline' };
    const text = detail ? `${labels[status]||status} — ${detail}` : (labels[status]||status);
    ['sync-status-badge', 'sync-status-badge-settings'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = text;
      el.className   = `sync-badge sync-${status}`;
    });
  }

  function _toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'default');
  }

  function _cloudTime(value) {
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value === 'string') return Date.parse(value) || 0;
    return 0;
  }

  async function syncIncomingStudents() {
    if (!navigator.onLine) return { ok: false, reason: 'offline' };
    if (_studentSyncInFlight) return _studentSyncInFlight;
    _studentSyncInFlight = (async () => {
      if (!(await _initDualAuth())) return { ok: false, reason: 'auth_failed' };
      try {
        // Query the server so a cached authorization never becomes local authority.
        const snapshot = await _db.collection('libraries').doc(LIBRARY_ID)
          .collection('authorized_students').get({ source: 'server' });
        const cursor = LibraryDB.getRosterSyncCursor();
        const locals = LibraryDB.getStudents();
        let newest = cursor;
        let created = 0;
        let changed = 0;
        let failed = false;
        for (const doc of snapshot.docs) {
          const data = doc.data();
          const email = String(data.email || doc.id).trim().toLowerCase();
          let admNo = String(data.adm_no || '').trim();
          if (!admNo) {
            try {
              // Older approvals contain only email/name/group. The portal
              // profile has the admission number entered by the student.
              const login = await _db.collection('libraries').doc(LIBRARY_ID)
                .collection('student_logins').doc(email).get({ source: 'server' });
              if (login.exists) admNo = String(login.data().adm_no || '').trim();
            } catch (error) { console.warn('[StudentSync] Could not resolve admission number:', error.message); }
          }
          const timestamp = _cloudTime(data.updated_at || data.added_at);
          const local = locals.find(s => String(s.email || '').trim().toLowerCase() === email ||
            (admNo && s.adm_no === admNo));
          if (timestamp && timestamp <= cursor && local?.cloud_synced && local.group === data.group &&
              !local.adm_no.startsWith('WEB-') && (!admNo || local.adm_no === admNo)) continue;
          if (!admNo && (!local || local.adm_no.startsWith('WEB-'))) {
            console.warn(`[StudentSync] Skipping ${email}: no admission number in authorization or portal profile.`);
            continue;
          }
          const result = LibraryDB.upsertStudentFromCloud({
            email, name: data.name, group: data.group, adm_no: admNo,
            class: data.class, section: data.section, roll_no: data.roll_no,
            cloud_updated_at: timestamp ? new Date(timestamp).toISOString() : null,
          });
          if (!result.ok) { failed = true; console.warn('[StudentSync]', result.msg); continue; }
          if (result.created) created++;
          else changed++;
          newest = Math.max(newest, timestamp);
        }
        if (!failed && newest > cursor) LibraryDB.setRosterSyncCursor(newest);
        if (created) _toast(`${created} new student${created === 1 ? '' : 's'} added from cloud.`, 'success');
        if (created || changed) window.dispatchEvent(new Event('tomeva:students-updated'));
        return { ok: !failed, created, changed };
      } catch (error) {
        console.warn('[StudentSync] Deferred:', error.message);
        return { ok: false, reason: error.message };
      }
    })();
    try { return await _studentSyncInFlight; }
    finally { _studentSyncInFlight = null; }
  }

  function _esc(str) {
    return String(str || '')
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, '\u0027')
      .replace(/`/g, '&#96;');
  }

  /* ══════════════════════════════
     BUILD SYNC PAYLOAD (split: public + restricted)
  ══════════════════════════════ */

  function _buildPayload() {
    const books        = LibraryDB.getBooks();
    const txns         = LibraryDB.getTransactions();
    const students     = LibraryDB.getStudents();
    const settings     = LibraryDB.getSettings();
    const overdue      = LibraryDB.getOverdueTransactions();
    const finesPending = LibraryDB.getPendingFines();
    const collected    = LibraryDB.getFinePayments();
    const collectedToday = LibraryDB.getCollectedToday();

    const stats = {
      total_books:        books.length,
      available:          books.filter(b => b.status === 'Available').length,
      issued:             books.filter(b => b.status === 'Issued').length,
      damaged:            books.filter(b => b.status === 'Damaged').length,
      under_repair:       books.filter(b => b.status === 'Under Repair').length,
      lost:               books.filter(b => b.status === 'Lost').length,
      total_students:     students.length,
      active_issues:      txns.filter(t => t.status === 'Active').length,
      overdue_count:      overdue.length,
      pending_fines:      finesPending.length,
      total_fine_amt:     finesPending.reduce((s, t) => s + (t.fine || 0), 0),
      collected_total:    LibraryDB.getTotalCollected(),
      collected_count:    collected.length,
      collected_today_amt:   collectedToday.amount,
      collected_today_count: collectedToday.count,
    };

    // ── PUBLIC CATALOG (no PII) ──
    const availableList = books
      .filter(b => b.status === 'Available')
      .map(b => ({ book_id: b.access_no, title: b.document, author: b.author }));

    // Availability comes from the catalog, never from transactions or borrowers.
    const issuedList = books
      .filter(b => b.status === 'Issued')
      .map(b => ({ book_id: b.access_no, title: b.document, author: b.author }));

    const damagedList = books
      .filter(b => ['Damaged', 'Under Repair', 'Lost'].includes(b.status))
      .map(b => ({ book_id: b.access_no, title: b.document, author: b.author, status: b.status }));

    const publicPayload = {
      stats: {
        total_books: stats.total_books, available: stats.available,
        issued: stats.issued, damaged: stats.damaged,
        under_repair: stats.under_repair, lost: stats.lost,
      },
      availableList,
      issuedList,
      damagedList,
      last_synced:     firebase.firestore.FieldValue.serverTimestamp(),
      last_synced_iso: new Date().toISOString(),
      sync_version:    6,  // Version 6 = public catalog contains no circulation records
    };

    // ── RESTRICTED CIRCULATION (contains PII) ──
    const overdueList = overdue.map(txn => {
      const book    = LibraryDB.getBook(txn.book_access_no);
      const student = LibraryDB.getStudent(txn.student_adm_no);
      const days    = LibraryDB.calcLateDays(txn.due_date);
      return {
        book_id: txn.book_access_no, book_title: book ? book.document : txn.book_access_no,
        student_id: txn.student_adm_no, student_name: student ? student.name : txn.student_adm_no,
        student_class: student ? `${student.class}${student.section}` : '',
        due_date: txn.due_date, days_overdue: days,
        fine_accrued: days * settings.fine_per_day,
      };
    });

    const issuedCirculationList = txns.filter(t => t.status === 'Active').map(txn => {
      const book    = LibraryDB.getBook(txn.book_access_no);
      const student = LibraryDB.getStudent(txn.student_adm_no);
      return {
        book_id: txn.book_access_no, book_title: book ? book.document : txn.book_access_no,
        student_id: txn.student_adm_no, student_name: student ? student.name : txn.student_adm_no,
        student_class: student ? `${student.class}${student.section}` : '',
        issue_date: txn.issue_date, due_date: txn.due_date,
        is_overdue: LibraryDB.calcLateDays(txn.due_date) > 0,
      };
    });

    const finesList = finesPending.map(txn => {
      const book    = LibraryDB.getBook(txn.book_access_no);
      const student = LibraryDB.getStudent(txn.student_adm_no);
      return {
        book_id: txn.book_access_no, book_title: book ? book.document : txn.book_access_no,
        student_id: txn.student_adm_no, student_name: student ? student.name : txn.student_adm_no,
        student_class: student ? `${student.class}${student.section}` : '',
        fine_amount: txn.fine, return_date: txn.return_date,
      };
    });

    const recentCollections = collected
      .slice()
      .sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at))
      .slice(0, 10)
      .map(p => {
        const student = LibraryDB.getStudent(p.student_adm_no);
        return {
          student_name: student ? student.name : p.student_adm_no,
          amount: p.amount,
          paid_date: p.paid_date,
        };
      });

    const restrictedPayload = {
      stats,
      overdueList,
      issuedList: issuedCirculationList,
      finesList,
      recentCollections,
      last_synced:     firebase.firestore.FieldValue.serverTimestamp(),
      last_synced_iso: new Date().toISOString(),
      sync_version:    6,
    };

    return { public: publicPayload, restricted: restrictedPayload };
  }

  /* ══════════════════════════════
     CORE SYNC (dual auth, offline-deferred)
  ══════════════════════════════ */

  async function syncNow(isManual) {
    // Ensure dual auth is initialized
    const authOk = await _initDualAuth();
    if (!authOk) {
      if (!navigator.onLine) {
        _setStatus('offline');
        if (isManual) _toast('No internet — will sync when back online.', 'warning');
      } else {
        _setStatus('error', _institutionConfigured ? 'Auth failed' : 'Import institution setup');
        if (isManual) _toast('Authentication failed — cannot sync.', 'error');
      }
      return { ok: false, reason: 'auth_failed' };
    }

    if (!navigator.onLine) {
      _setStatus('offline');
      if (isManual) _toast('No internet — will sync when back online.', 'warning');
      return { ok: false, reason: 'offline' };
    }

    _setStatus('syncing');
    if (isManual) _toast('Syncing to cloud…', 'default');

    try {
      // Failure to read the roster never prevents the outbound catalog sync.
      try { await syncIncomingStudents(); }
      catch (error) { console.warn('[StudentSync] Deferred:', error.message); }
      const { public: publicPayload, restricted: restrictedPayload } = _buildPayload();

      // Replace public documents so an older sync's borrower fields are removed.
      const batch = _db.batch();

      // 1. Public catalog (readable by students) — ANONYMOUS AUTH OK
      const publicRef = _db.collection('libraries').doc(LIBRARY_ID).collection('public').doc('catalog');
      batch.set(publicRef, publicPayload);

      // 2. Main sync document (legacy) — ANONYMOUS AUTH OK
      const legacyRef = _db.collection('libraries').doc(LIBRARY_ID);
      batch.set(legacyRef, publicPayload);

      await batch.commit();

      // Restricted write is separate: absent/revoked kiosk approval cannot prevent
      // the public catalog and legacy document from shedding old PII.
      let restrictedSynced = false;
      if (await _ensureKioskAuth()) {
        const restrictedRef = _db.collection('libraries').doc(LIBRARY_ID).collection('restricted').doc('circulation');
        await restrictedRef.set(restrictedPayload);
        restrictedSynced = true;
      } else {
        console.warn('[Sync] No active kiosk registration — skipping restricted/circulation write (PII protected)');
      }

      _lastSyncTime = new Date();
      const t = _lastSyncTime.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
      _setStatus(restrictedSynced ? 'success' : 'error', restrictedSynced ? t : 'Circulation pending');
      const lsl = document.getElementById('last-sync-time');
      if (lsl) lsl.textContent = `Last synced: ${t}`;
      if (isManual) _toast(restrictedSynced ? 'Dashboard synced ✓' : 'Catalog synced; circulation needs kiosk approval.', restrictedSynced ? 'success' : 'warning');
      return { ok: true, restrictedSynced };

    } catch (err) {
      console.error('[Sync]', err);
      if (err.code === 'permission-denied') {
        _setStatus('error', 'Permission denied');
        if (isManual) _toast('Sync failed — permission denied. Check kiosk provisioning.', 'error');
        return { ok: false, reason: 'permission_denied' };
      }
      _setStatus('error', 'Retry in 60m');
      if (isManual) _toast('Sync failed — ' + err.message, 'error');
      return { ok: false, reason: err.message };
    }
  }

  /* ══════════════════════════════
     CONTROL FLAG  (exam-suspend, admin → librarian)
  ══════════════════════════════ */

  async function startControlListener(onChange) {
    if (!(await _initFirebase())) return;
    if (_controlUnsub) _controlUnsub();

    _controlUnsub = _db
      .collection('libraries').doc(LIBRARY_ID)
      .collection('meta').doc('control')
      .onSnapshot(snap => {
        if (snap.exists) {
          const d = snap.data();
          _controlState = {
            issuance_suspended: !!d.issuance_suspended,
            suspend_reason:     d.suspend_reason || '',
          };
        } else {
          _controlState = { issuance_suspended: false, suspend_reason: '' };
        }
        if (typeof onChange === 'function') onChange(_controlState);
      }, err => console.warn('[Control]', err.message));
  }

  function getControlState() { return _controlState; }

  /* ══════════════════════════════
     NOTIFICATIONS  librarian → admin
  ══════════════════════════════ */

  async function sendNotification(type, subject, body) {
    // Need active kiosk registration for librarian→admin notifications
    const kioskOk = await _ensureKioskAuth();
    if (!kioskOk) return { ok: false, msg: 'Kiosk auth required for notifications' };

    if (!navigator.onLine) return { ok: false, msg: 'You are offline.' };

    try {
      await _db.collection('libraries').doc(LIBRARY_ID).collection('notifications').add({
        from: 'librarian', to: 'admin', type, subject, body, read: false,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        timestamp_iso: new Date().toISOString(),
      });
      _saveSent({ type, subject, body, timestamp_iso: new Date().toISOString() });
      return { ok: true };
    } catch (err) { return { ok: false, msg: err.message }; }
  }

  const SENT_KEY = 'lib_sent_notifications';
  const READ_KEY = 'lib_read_notif_ids';

  function _saveSent(msg) {
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(SENT_KEY)) || []; } catch {}
    arr.unshift(msg);
    if (arr.length > 50) arr = arr.slice(0, 50);
    localStorage.setItem(SENT_KEY, JSON.stringify(arr));
  }

  function getSentHistory() { try { return JSON.parse(localStorage.getItem(SENT_KEY)) || []; } catch { return []; } }
  function getReadNotifIds() { try { return JSON.parse(localStorage.getItem(READ_KEY)) || []; } catch { return []; } }
  function markLocalRead(id) {
    const ids = getReadNotifIds();
    if (!ids.includes(id)) { ids.push(id); localStorage.setItem(READ_KEY, JSON.stringify(ids)); }
  }

  function startNotificationListener() {
    if (!_db || !_hasKioskClaim) return;
    if (_notifUnsub) return;
    let initialized = false;
    _notifUnsub = _db
      .collection('libraries').doc(LIBRARY_ID).collection('admin_notifications')
      .orderBy('timestamp', 'desc').limit(30)
      .onSnapshot(snapshot => {
        const readIds = getReadNotifIds();
        const notifs  = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        _unreadCount = notifs.filter(n => !readIds.includes(n.id)).length;
        updateNotifBadge(_unreadCount);
        renderIncomingNotifications(notifs, readIds);
        if (!snapshot.metadata.hasPendingWrites) {
          snapshot.docChanges().forEach(change => {
            if (initialized && _hasKioskClaim && change.type === 'added') {
              const d = change.doc.data();
              if (!getReadNotifIds().includes(change.doc.id) && !change.doc.metadata.hasPendingWrites) {
                const icons = { MESSAGE:'💬', ALERT:'🚨', WARNING:'⚠️' };
                _toast(`${icons[d.type]||'🔔'} Admin: ${d.subject}`, d.type==='ALERT'?'error':d.type==='WARNING'?'warning':'default');
                window.electronAPI?.notify('ADMIN_MESSAGE');
              }
            }
          });
        }
        initialized = true;
      }, err => console.warn('[Notif]', err.message));
  }

  function stopNotificationListener() { if (_notifUnsub) { _notifUnsub(); _notifUnsub = null; } }

  function renderIncomingNotifications(notifs, readIds) {
    const el = document.getElementById('incoming-notif-list');
    if (!el) return;
    if (!notifs.length) { el.innerHTML = `<div class="empty-state"><span class="empty-icon">🔔</span><h4>No notifications yet</h4><p>Messages from the admin will appear here.</p></div>`; return; }
    const cfg = { MESSAGE:{icon:'💬',cls:'notif-message',label:'Message'}, ALERT:{icon:'🚨',cls:'notif-alert',label:'Alert'}, WARNING:{icon:'⚠️',cls:'notif-warning',label:'Warning'} };
    el.innerHTML = notifs.map(n => {
      const c = cfg[n.type] || cfg.MESSAGE;
      const isRead = readIds.includes(n.id);
      const time = n.timestamp_iso ? new Date(n.timestamp_iso).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : 'Just now';
      return `<div class="notif-item ${c.cls} ${isRead?'notif-read':'notif-unread'}" data-notif-id="${_esc(n.id)}">
        <div class="notif-icon-col">${c.icon}</div>
        <div class="notif-body-col">
          <div class="notif-header-row"><span class="notif-type-label">${c.label}</span>${!isRead?'<span class="notif-dot"></span>':''}<span class="notif-time">${time}</span></div>
          <div class="notif-subject">${_esc(n.subject||'')}</div>
          <div class="notif-text">${_esc(n.body||'')}</div>
        </div></div>`;
    }).join('');
    el.querySelectorAll('[data-notif-id]').forEach(item => {
      item.addEventListener('click', () => {
        if (typeof markNotifRead === 'function') markNotifRead(item.dataset.notifId, item);
      });
    });
  }

  function renderSentNotifications() {
    const el = document.getElementById('sent-notif-list');
    if (!el) return;
    const sent = getSentHistory();
    if (!sent.length) { el.innerHTML = `<div class="empty-state"><span class="empty-icon">📭</span><h4>No messages sent yet</h4><p>Your sent messages will appear here.</p></div>`; return; }
    const icons = { MESSAGE:'💬', ALERT:'🚨', WARNING:'⚠️' };
    el.innerHTML = sent.map(n => {
      const time = n.timestamp_iso ? new Date(n.timestamp_iso).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
      return `<div class="notif-item notif-sent">
        <div class="notif-icon-col">${icons[n.type]||'💬'}</div>
        <div class="notif-body-col"><div class="notif-header-row"><span class="notif-type-label">${_esc(n.type)}</span><span class="notif-time">${time}</span></div>
        <div class="notif-subject">${_esc(n.subject)}</div><div class="notif-text">${_esc(n.body)}</div></div></div>`;
    }).join('');
  }

  function updateNotifBadge(count) {
    _unreadCount = count;
    const b = document.getElementById('notif-badge');
    if (!b) return;
    b.textContent = count > 9 ? '9+' : count;
    b.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  /* ══════════════════════════════
     BOOK REQUESTS  (student → librarian)
  ══════════════════════════════ */

  function startRequestsListener(onChange) {
    if (typeof onChange === 'function') _requestCallback = onChange;
    if (!_db || !_hasKioskClaim) return;
    if (_requestsUnsub) _requestsUnsub();

    let initialized = false;
    _requestsUnsub = _db
      .collection('libraries').doc(LIBRARY_ID).collection('book_requests')
      .orderBy('timestamp', 'desc').limit(100)
      .onSnapshot(snapshot => {
        const requests = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        _pendingRequestCount = requests.filter(r => r.status === 'Pending').length;
        updateRequestBadge(_pendingRequestCount);
        if (_requestCallback) _requestCallback(requests);

        if (!snapshot.metadata.hasPendingWrites) {
          snapshot.docChanges().forEach(change => {
            if (initialized && _hasKioskClaim && change.type === 'added') {
              const d = change.doc.data();
              if (d.status === 'Pending') {
                _toast(`📚 New ${d.priority ? 'PRIORITY ' : ''}request: ${d.book_title} — ${d.student_name}`, d.priority ? 'warning' : 'default');
                window.electronAPI?.notify('NEW_REQUEST');
              }
            }
          });
        }
        initialized = true;
      }, err => console.warn('[Requests]', err.message));
  }

  function stopRequestsListener() { if (_requestsUnsub) { _requestsUnsub(); _requestsUnsub = null; } }

  async function decideRequest(requestId, status, decisionNote) {
    // Need active kiosk registration for approve/decline/issue
    const kioskOk = await _ensureKioskAuth();
    if (!kioskOk) return { ok: false, msg: 'Kiosk auth required — enter an active kiosk email/password in Settings' };

    try {
      await _db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).update({
        status,
        decision_note:  decisionNote || '',
        decided_at:     firebase.firestore.FieldValue.serverTimestamp(),
        decided_at_iso: new Date().toISOString(),
      });
      return { ok: true };
    } catch (err) {
      if (err.code === 'permission-denied') {
        return { ok: false, msg: 'Permission denied — kiosk not authorized to decide requests' };
      }
      return { ok: false, msg: err.message };
    }
  }

  function updateRequestBadge(count) {
    const b = document.getElementById('requests-nav-badge');
    if (!b) return;
    b.textContent = count > 9 ? '9+' : count;
    b.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  function getPendingRequestCount() { return _pendingRequestCount; }

  /* ══════════════════════════════
     SCHEDULER + ONLINE/OFFLINE HANDLING
  ══════════════════════════════ */

  function startSyncScheduler() {
    stopSyncScheduler();
    setTimeout(() => syncNow(false), 5000);
    _syncTimer = setInterval(() => syncNow(false), SYNC_INTERVAL_MS);

    window.addEventListener('online',  () => {
      _setStatus('idle');
      syncNow(false);
    });
    window.addEventListener('offline', () => { _setKioskAccess(false); _setStatus('offline'); });

    startNotificationListener();
    startControlListener();
    startRequestsListener();
  }

  function stopSyncScheduler() {
    if (_syncTimer) { clearInterval(_syncTimer); _syncTimer = null; }
    stopNotificationListener();
    if (_controlUnsub)  { _controlUnsub();  _controlUnsub  = null; }
    if (_requestsUnsub) { _requestsUnsub(); _requestsUnsub = null; }
  }

  /* ══════════════════════════════
     PUBLIC API
  ══════════════════════════════ */

  window.FirebaseSync = {
    syncNow, syncIncomingStudents, startSyncScheduler, stopSyncScheduler,
    sendNotification, getSentHistory, getReadNotifIds, markLocalRead,
    renderIncomingNotifications, renderSentNotifications, updateNotifBadge,
    startNotificationListener,
    startControlListener, getControlState,
    startRequestsListener, stopRequestsListener, decideRequest,
    updateRequestBadge, getPendingRequestCount,
    getStatus:       () => _syncStatus,
    getLastSyncTime: () => _lastSyncTime,
    getUnreadCount:  () => _unreadCount,
    isOnline:        () => navigator.onLine,
    hasKioskClaim:   () => _hasKioskClaim,
    // Expose auth management for provisioning UI
    provisionKioskCreds,
    _reauthenticate: _signInWithKioskCreds,
    _signOut:        _signOutAll,
  };

})();

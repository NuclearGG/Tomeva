import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js';
import { initializeAuth, inMemoryPersistence, createUserWithEmailAndPassword, deleteUser, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js';
import { doc, collection, query, where, onSnapshot, setDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js';

// A separate, memory-only Auth instance preserves the administrator's session.
export async function createCredential({ app, db, auth, libraryId, label }) {
  const admin = auth.currentUser;
  if (!admin || libraryId !== 'main' || !admin.providerData?.some(provider => provider.providerId === 'google.com')) {
    throw new Error('Sign in with Google in the Admin panel to manage kiosk credentials.');
  }
  const randomHex = size => Array.from(crypto.getRandomValues(new Uint8Array(size)), n => n.toString(16).padStart(2, '0')).join('');
  const email = `kiosk-${randomHex(16)}@kiosk.tomeva.invalid`;
  const password = randomHex(24) + 'Aa1!';
  const secondary = initializeApp(app.options, 'kiosk-provision-' + randomHex(8));
  let user;
  try {
    const kioskAuth = initializeAuth(secondary, { persistence: inMemoryPersistence });
    ({ user } = await createUserWithEmailAndPassword(kioskAuth, email, password));
    if (auth.currentUser?.uid !== admin.uid) throw new Error('Administrator changed. Sign in and try again.');
    await setDoc(doc(db, 'kiosk_accounts', user.uid), {
      email, label, libraryId, active: true,
      createdBy: admin.uid, createdAt: serverTimestamp(),
      revokedBy: null, revokedAt: null,
    });
    return { email, password, uid: user.uid };
  } catch (error) {
    // Unregistered Auth users have no kiosk privileges. Clean up if possible.
    if (user) {
      try { await deleteUser(user); }
      catch (_) { error.message += ' An unused Auth account may remain; it has no kiosk approval access.'; }
    }
    throw error;
  } finally {
    // Cleanup failure must not hide a successfully created credential.
    try { await deleteApp(secondary); } catch (_) { /* memory-only session */ }
  }
}

export function setupKioskManagement({ app, db, auth, libraryId, staffDomain, showToast, showConfirm }) {
  const el = id => document.getElementById(id);
  let allowed = false, busy = false, accountsUnsub, secretModal;
  let records = [];

  function clearSecret() {
    if (!secretModal) return;
    secretModal.remove(); secretModal = null;
    el('kiosk-create').focus();
  }
  function render() {
    el('kiosk-gate-signedout').style.display = auth.currentUser ? 'none' : 'block';
    el('kiosk-gate-denied').style.display = auth.currentUser && !allowed ? 'block' : 'none';
    el('kiosk-management').style.display = allowed ? 'block' : 'none';
    el('kiosk-denied-email').textContent = auth.currentUser?.email || '';
    el('kiosk-signed-in-as').textContent = 'Signed in as ' + (auth.currentUser?.email || '');
    el('kiosk-create').disabled = !allowed || busy;
  }

  function renderRecords() {
    const body = el('kiosk-accounts');
    body.replaceChildren();
    if (!records.length) {
      const row = body.insertRow();
      const cell = row.insertCell(); cell.colSpan = 4; cell.textContent = 'No kiosk credentials created yet.';
    }
    for (const record of records) {
      const row = body.insertRow();
      for (const value of [record.label, record.email, record.active ? 'Active' : 'Revoked']) row.insertCell().textContent = value;
      const cell = row.insertCell();
      if (!record.active) continue;
      const button = document.createElement('button');
      button.className = 'btn btn-coral btn-sm'; button.textContent = 'Revoke';
      button.addEventListener('click', async () => {
        if (!allowed || !navigator.onLine) { showToast('Connect and sign in as a kiosk administrator.', 'error'); return; }
        if (!(await showConfirm(`Revoke ${record.label}? This credential will no longer approve, decline, or issue cloud requests.`))) return;
        button.disabled = true;
        try {
          await updateDoc(doc(db, 'kiosk_accounts', record.uid), {
            active: false, revokedBy: auth.currentUser.uid, revokedAt: serverTimestamp(),
          });
          clearSecret();
          showToast('Kiosk access revoked.', 'success');
        } catch (error) { showToast('Could not revoke: ' + error.message, 'error'); button.disabled = false; }
      });
      cell.append(button);
    }
  }

  function showSecret(credential) {
    clearSecret();
    secretModal = document.createElement('div');
    secretModal.className = 'modal-overlay show';
    const panel = document.createElement('div'); panel.className = 'modal';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Kiosk credential created');
    const title = document.createElement('h3'); title.textContent = 'Kiosk credential created';
    const hint = document.createElement('p');
    hint.textContent = 'Copy these now. The password is shown once. Enter both in Librarian Settings → Kiosk Approval Credentials → Save & Activate.';
    panel.append(title, hint);
    for (const [name, value] of [['Email', credential.email], ['Password', credential.password]]) {
      const group = document.createElement('label'); group.className = 'form-group'; group.textContent = name;
      const input = document.createElement('input'); input.readOnly = true; input.value = value;
      input.addEventListener('focus', () => input.select()); group.append(input); panel.append(group);
    }
    const close = document.createElement('button'); close.className = 'btn btn-primary'; close.textContent = 'I have saved these credentials';
    close.addEventListener('click', clearSecret); panel.append(close); secretModal.append(panel); document.body.append(secretModal);
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); clearSecret(); }
      if (event.key === 'Tab') {
        const first = panel.querySelector('input');
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); close.focus(); }
        else if (!event.shiftKey && document.activeElement === close) { event.preventDefault(); first.focus(); }
      }
    });
    panel.querySelector('input').focus();
  }

  el('kiosk-create-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!allowed || busy) return;
    const label = el('kiosk-label').value.trim();
    if (!label || label.length > 80) { showToast('Enter a workstation name (up to 80 characters).', 'error'); return; }
    if (!navigator.onLine) { showToast('Connect to the internet to create a credential.', 'error'); return; }
    const adminUid = auth.currentUser.uid;
    busy = true; render();
    try {
      const credential = await createCredential({ app, db, auth, libraryId, label });
      if (allowed && auth.currentUser?.uid === adminUid) showSecret(credential);
      el('kiosk-label').value = '';
    } catch (error) { showToast('Could not create credential: ' + error.message, 'error', 8000); }
    finally { busy = false; render(); }
  });

  onAuthStateChanged(auth, user => {
    accountsUnsub?.(); accountsUnsub = null;
    clearSecret(); allowed = false; records = []; renderRecords(); render();
    allowed = !!(user?.emailVerified && user.email?.toLowerCase().endsWith('@' + staffDomain) && libraryId === 'main' && user.providerData?.some(provider => provider.providerId === 'google.com'));
    render();
    if (!allowed) return;
    accountsUnsub = onSnapshot(query(collection(db, 'kiosk_accounts'), where('libraryId', '==', libraryId)), snapshot => {
      if (auth.currentUser?.uid !== user.uid) return;
      records = snapshot.docs.map(d => ({ ...d.data(), uid: d.id })).sort((a, b) => a.label.localeCompare(b.label));
      renderRecords();
    }, error => { records = []; renderRecords(); showToast('Could not load kiosks: ' + error.message, 'error'); });
  });
  return { render };
}

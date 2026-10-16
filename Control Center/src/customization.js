import { GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged } from 'firebase/auth';
import { openAppearanceSession, closeAppearanceSession } from './appearance-session.js';
import { getFirestore, doc, getDocFromServer, onSnapshot, runTransaction as rawTransaction, serverTimestamp } from 'firebase/firestore';
import { createAuditedFirestore } from '../../desktop-integration/admin-audit.mjs';
import appearanceAccess from './appearance-access.cjs';
const { checkAppearanceAccess } = appearanceAccess;

export function initializeCustomization({ getConfig, bridge, notice }) {
  const byId = id => document.getElementById(id);
  const appearance = window.TomevaAppearance;
  const form = byId('appearance-form');
  const fields = appearance.fields.filter(key => key !== 'schemaVersion');
  let context = null, stop = null, stopAuth = null, generation = 0;
  let dirty = false, baseRevision = 0, latest = null, serverReady = false, canPublish = false, busy = false;
  let accessRequest = 0, checkingAccess = false, signingIn = false;
  const status = text => { byId('appearance-status').textContent = text; };
  function readForm() {
    return appearance.validate(Object.fromEntries(appearance.fields.map(key => [key,
      key === 'schemaVersion' ? 1 : key === 'brandEnabled' ? form.elements.namedItem(key).checked : form.elements.namedItem(key).value,
    ])));
  }
  function fill(value) {
    for (const key of fields) {
      const field = form.elements.namedItem(key);
      if (key === 'brandEnabled') field.checked = value[key]; else field.value = value[key];
    }
    form.elements.namedItem('accentColor').disabled = !value.brandEnabled;
    byId('appearance-colour-value').textContent = value.accentColor;
  }
  function buttons() {
    byId('appearance-publish').disabled = !canPublish || !serverReady || !navigator.onLine || busy;
    byId('appearance-sign-in').disabled = !context || context.restoring || busy || signingIn;
    byId('appearance-sign-out').disabled = !context?.auth.currentUser || busy || signingIn;
    byId('appearance-recheck').disabled = !context?.auth.currentUser || busy || checkingAccess;
    byId('appearance-project').textContent = getConfig()?.firebase.projectId || 'Save Firebase project settings first';
  }
  function preview() {
    try {
      const value = readForm();
      appearance.apply(value, { institutionName:getConfig()?.institutionName });
      byId('appearance-preview-name').textContent = value.displayName || getConfig()?.institutionName || 'Your library';
      byId('appearance-preview-heading').textContent = value.portalHeading || appearance.defaults.portalHeading;
      byId('appearance-preview-notice').textContent = value.notice || 'Your institution notice appears here.';
      byId('appearance-colour-value').textContent = value.accentColor;
      byId('appearance-validation').textContent = '';
    } catch (error) { byId('appearance-validation').textContent = error.message; }
  }
  function usePublished() {
    const value = latest ? appearance.validate(latest) : appearance.defaults;
    baseRevision = latest?.revision || 0; dirty = false; fill(value); preview();
    status(serverReady ? `Published revision ${baseRevision}. Changes below are previews until you publish.` : 'Showing cached settings. Connect to Firebase to load the published version.');
  }
  async function connect() {
    const config = getConfig();
    if (!config) { status('Save the institution Firebase settings before connecting.'); buttons(); return; }
    const signature = JSON.stringify(config);
    if (context?.signature === signature) return;
    const token = ++generation;
    stop?.(); stopAuth?.(); stop = null; stopAuth = null;
    const old = context; context = null;
    canPublish = false; serverReady = false; latest = null; baseRevision = 0; dirty = false;
    if (old) {
      try { await closeAppearanceSession(old, config); }
      catch (_) { context = old; status('Could not close the previous institution session. Reconnect and try again.'); buttons(); return; }
    }
    if (token !== generation) return;
    try {
      const { app, auth } = openAppearanceSession(config);
      const db = getFirestore(app), ref = doc(db,'libraries','main','public','appearance');
      context = { app, auth, db, ref, signature, config, restoring:true };
      byId('appearance-account').textContent = 'Restoring your sign-in…';
      fill(appearance.load(config.firebase.projectId, { institutionName:config.institutionName })); preview();
      status('Connecting to the institution’s live appearance settings…');
      stop = onSnapshot(ref, { includeMetadataChanges:true }, snapshot => {
        if (token !== generation || snapshot.metadata.hasPendingWrites) return;
        if (!snapshot.exists() && snapshot.metadata.fromCache) return;
        try {
          const remote = snapshot.exists() ? snapshot.data() : null;
          if (remote) appearance.validate(remote);
          latest = remote; serverReady = !snapshot.metadata.fromCache;
          if (!dirty) {
            appearance.receive(config.firebase.projectId, snapshot, { institutionName:config.institutionName });
            usePublished();
          } else if ((remote?.revision || 0) !== baseRevision) {
            status('Another administrator changed the published settings. Load the published version before editing again.');
          }
          buttons();
        } catch (error) { serverReady = false; status(error.message); buttons(); }
      }, error => {
        serverReady = false; status('Could not read live settings. Keep your preview; check connectivity and publish the current Firestore rules. ' + error.code); buttons();
      });
      stopAuth = onAuthStateChanged(auth, user => {
        if (token !== generation) return;
        context.restoring = false;
        byId('appearance-account').textContent = user?.email || 'Not signed in';
        recheckAccess();
      });
    } catch (error) { status(error.message); }
    buttons();
  }
  async function recheckAccess() {
    const active = context, request = ++accessRequest, user = active?.auth.currentUser;
    canPublish = false; checkingAccess = true; buttons();
    byId('appearance-access-status').textContent = user ? 'Checking administrator access with Firebase…' : 'Sign in to check administrator access.';
    try {
      const result = await checkAppearanceAccess(user, active?.config || getConfig(), {
        getStaff: email => getDocFromServer(doc(active.db,'staff_accounts',email)),
        getGrant: uid => getDocFromServer(doc(active.db,'kiosk_admins',uid)),
      });
      if (request !== accessRequest || context !== active || active?.auth.currentUser?.uid !== user?.uid) return;
      canPublish = result.allowed;
      byId('appearance-access-status').textContent = result.message;
    } catch (_) {
      if (request === accessRequest && context === active) byId('appearance-access-status').textContent = 'Could not check administrator access. Check your connection and try again.';
    } finally {
      if (request === accessRequest) { checkingAccess = false; buttons(); }
    }
  }
  fill(appearance.defaults);
  form.addEventListener('input', () => {
    dirty = true; form.elements.namedItem('accentColor').disabled = !form.elements.namedItem('brandEnabled').checked;
    preview(); status('Preview only. Publish to update connected apps.');
  });
  byId('appearance-load').addEventListener('click', usePublished);
  byId('appearance-reset').addEventListener('click', () => { dirty = true; fill(appearance.defaults); preview(); status('Built-in appearance previewed. Publish to restore it across connected apps.'); });
  byId('appearance-reconnect').addEventListener('click', async () => { context && (context.signature = ''); await connect(); });
  byId('appearance-sign-in').addEventListener('click', async () => {
    try { await connect(); if (context) await bridge.signInForAppearance(); }
    catch (error) { status('Sign-in could not start: ' + error.message); }
  });
  byId('appearance-sign-out').addEventListener('click', async () => {
    try { await bridge.cancelAppearanceSignIn(); if (context) await signOut(context.auth); } catch (error) { status(error.message); }
  });
  byId('appearance-recheck').addEventListener('click', recheckAccess);
  bridge.onAppearanceOAuth(async result => {
    try {
      if (result.error) throw new Error(result.errorDescription || result.error);
      if (!context || JSON.stringify(getConfig()) !== context.signature) throw new Error('Project changed. Sign in again for the current project.');
      if (!result.credential && !result.accessToken) throw new Error('No sign-in credential received.');
      signingIn = true; buttons();
      await signInWithCredential(context.auth, GoogleAuthProvider.credential(result.credential || null,result.accessToken || null));
    } catch (error) { status('Sign-in failed: ' + error.message); }
    finally { signingIn = false; buttons(); }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      if (!context || !canPublish || !serverReady || !navigator.onLine || busy) throw new Error('Connect and sign in before publishing.');
      const value = readForm(), active = context, expectedRevision = baseRevision;
      busy = true; buttons(); status('Publishing appearance…');
      const { runTransaction } = createAuditedFirestore({ db: active.db, actor: () => active.auth.currentUser, sdk: { doc, serverTimestamp, runTransaction: rawTransaction } });
      await runTransaction(active.db, async transaction => {
        const snapshot = await transaction.get(active.ref);
        const revision = snapshot.exists() ? snapshot.data().revision : 0;
        if (revision !== expectedRevision) throw new Error('Published settings changed. Load the published version and apply your changes again.');
        transaction.set(active.ref, { ...value, revision:revision+1, updatedAt:serverTimestamp(), updatedBy:active.auth.currentUser.uid });
      });
      if (context !== active) return;
      dirty = false; baseRevision = expectedRevision + 1;
      appearance.receive(active.config.firebase.projectId, { exists:() => true, data:() => value, metadata:{fromCache:false,hasPendingWrites:false} }, { institutionName:active.config.institutionName });
      // The listener may have delivered the confirmed write before the transaction resolved.
      if (latest?.revision === baseRevision) usePublished();
      status(`Published revision ${baseRevision}. Connected apps receive it automatically; offline apps catch up when they reconnect.`);
      notice('Institution appearance published. No package download needed.', 'success');
    } catch (error) { status('Not published. ' + error.message); }
    finally { busy = false; buttons(); }
  });
  document.querySelector('[data-page="customization"]').addEventListener('click', connect);
  window.addEventListener('online', buttons);
  window.addEventListener('offline', () => { buttons(); status('Offline. Your preview is available; reconnect before publishing.'); });
  buttons(); preview();
  return { configurationChanged() { connect(); } };
}

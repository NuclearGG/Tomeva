const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '../..');

function adminHarness({ failRegister = false, failDeleteApp = false, email = 'owner@example.org', provider = 'google.com' } = {}) {
  const source = fs.readFileSync(path.join(root, "Admin's End/kiosk-management.js"), 'utf8');
  const code = source.slice(source.indexOf('export async function createCredential'), source.indexOf('export function setupKioskManagement')).replace('export ', '');
  const calls = [];
  const auth = { currentUser: { uid: 'admin', email, providerData: [{ providerId: provider }] } };
  const deps = {
    crypto: webcrypto, Uint8Array,
    initializeApp: (options, name) => { calls.push(['app', name]); return {}; },
    initializeAuth: (_, options) => { calls.push(['persistence', options.persistence]); return {}; },
    inMemoryPersistence: 'memory',
    createUserWithEmailAndPassword: async (_, email, password) => { calls.push(['create', email, password]); return { user: { uid: 'desk' } }; },
    doc: (_, ...parts) => parts.join('/'), serverTimestamp: () => 'server-time',
    setDoc: async (ref, data) => { calls.push(['register', ref, data]); if (failRegister) throw Error('permission-denied'); },
    deleteUser: async user => calls.push(['delete-user', user.uid]),
    deleteApp: async () => { calls.push(['delete-app']); if (failDeleteApp) throw Error('cleanup failed'); },
  };
  const context = vm.createContext(deps); vm.runInContext(code, context);
  return { calls, auth, create: () => context.createCredential({ app: { options: {} }, db: {}, auth, libraryId: 'main', label: 'Main desk' }) };
}

test('creation keeps admin signed in, generates strong unique credentials, persists only metadata', async () => {
  const h = adminHarness();
  const first = await h.create(), second = await h.create();
  assert.equal(h.auth.currentUser.uid, 'admin');
  assert.match(first.email, /^kiosk-[a-f0-9]{32}@kiosk\.tomeva\.invalid$/);
  assert.equal(first.password.length, 52); assert.notEqual(first.password, second.password);
  assert.notEqual(first.email, second.email);
  assert.equal(h.calls.find(c => c[0] === 'persistence')[1], 'memory');
  const record = h.calls.find(c => c[0] === 'register')[2];
  assert.equal(record.active, true); assert.equal(record.createdBy, 'admin');
  assert.equal('password' in record, false); assert.equal('passwordHash' in record, false);
});
test('a kiosk password session cannot provision more credentials', async () => {
  const h = adminHarness({ provider: 'password' }); await assert.rejects(h.create(), /Sign in with Google/);
  assert.equal(h.calls.length, 0);
});
test('a Google account on any email domain can create without a grant', async () => {
  const h = adminHarness({ email: 'tester@example.net' });
  assert.ok((await h.create()).password);
});
test('failed registry write cleans up the Auth account and secondary app', async () => {
  const h = adminHarness({ failRegister: true }); await assert.rejects(h.create(), /permission-denied/);
  assert.ok(h.calls.some(c => c[0] === 'delete-user')); assert.ok(h.calls.some(c => c[0] === 'delete-app'));
});
test('cleanup failure cannot lose a successfully created password', async () => {
  const h = adminHarness({ failDeleteApp: true }); assert.ok((await h.create()).password);
});

function librarianHarness() {
  let active = true, libraryId = 'main', failLogin = false, failRead = false, statusCallback;
  const observers = new Set();
  const user = { uid: 'desk', email: 'kiosk@example.invalid', isAnonymous: false };
  const auth = {
    currentUser: null,
    onAuthStateChanged(callback) { observers.add(callback); queueMicrotask(() => { if (observers.has(callback)) callback(auth.currentUser); }); return () => observers.delete(callback); },
    async signInWithEmailAndPassword() { if (failLogin) throw Error('wrong password'); auth.currentUser = user; observers.forEach(cb => cb(user)); return { user }; },
    async signInAnonymously() { auth.currentUser = { uid: 'anon', isAnonymous: true }; observers.forEach(cb => cb(auth.currentUser)); },
    async signOut() { auth.currentUser = null; observers.forEach(cb => cb(null)); },
  };
  const snapshot = (cached = false) => ({ exists: true, data: () => ({ active, libraryId, email: user.email }), metadata: { fromCache: cached } });
  const db = { collection: () => ({ doc: () => ({
    get: async options => { assert.equal(options.source, 'server'); if (failRead) throw Error('offline'); return snapshot(); },
    onSnapshot: (_, callback) => { statusCallback = callback; return () => { statusCallback = null; }; },
  }) }) };
  const window = { electronAPI: { getKioskCreds: async () => null, setKioskCreds: async () => ({ ok: true }) } };
  const navigator = { onLine: true };
  const context = vm.createContext({ window, navigator, console, queueMicrotask,
    firebase: { apps: [1], firestore: () => db, auth: () => auth },
    document: { getElementById: () => null },
  });
  vm.runInContext(fs.readFileSync(path.join(root, "Librarian's End/js/firebase-sync.js"), 'utf8'), context);
  return { api: window.FirebaseSync, navigator,
    provision: () => window.FirebaseSync.provisionKioskCreds(user.email, 'secret'),
    revoke: () => { active = false; statusCallback?.(snapshot()); },
    wrongLibrary: () => { libraryId = 'other'; }, invalidPassword: () => { failLogin = true; },
    readFailure: () => { failRead = true; }, emitCache: () => statusCallback?.(snapshot(true)),
  };
}
test('librarian activates registered credentials and locks immediately on revocation', async () => {
  const h = librarianHarness(); assert.equal((await h.provision()).ok, true);
  assert.equal(h.api.hasKioskClaim(), true); h.revoke(); assert.equal(h.api.hasKioskClaim(), false);
  assert.equal(await h.api._reauthenticate(), false);
});
test('wrong library and failed server checks do not approve a valid Auth login', async () => {
  const h = librarianHarness(); h.wrongLibrary(); assert.equal((await h.provision()).ok, false);
  const f = librarianHarness(); f.readFailure(); assert.equal((await f.provision()).ok, false);
});
test('failed replacement clears the previously approved session', async () => {
  const h = librarianHarness(); await h.provision(); h.invalidPassword();
  assert.equal((await h.provision()).ok, false); assert.equal(h.api.hasKioskClaim(), false);
});
test('cached registry snapshots cannot grant approval', async () => {
  const h = librarianHarness(); await h.provision(); h.emitCache(); assert.equal(h.api.hasKioskClaim(), false);
});
test('offline provisioning is pending and does not unlock approvals', async () => {
  const h = librarianHarness(); h.navigator.onLine = false;
  assert.equal((await h.provision()).pending, true); assert.equal(h.api.hasKioskClaim(), false);
});

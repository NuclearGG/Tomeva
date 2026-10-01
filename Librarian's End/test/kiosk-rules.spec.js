const fs = require('fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { serverTimestamp } = require('firebase/firestore');

let env;
const email = 'kiosk-' + 'a'.repeat(32) + '@kiosk.tomeva.invalid';
const context = (uid, claims = {}) => env.authenticatedContext(uid, claims).firestore();
const admin = () => context('admin', { email: 'owner@staff.example', email_verified: true, firebase: { sign_in_provider: 'google.com' } });
const kiosk = (extra = {}) => context('desk', { email, firebase: { sign_in_provider: 'password' }, ...extra });
const metadata = (extra = {}) => ({
  email, label: 'Main desk', libraryId: 'main', active: true,
  createdBy: 'admin', createdAt: serverTimestamp(), revokedBy: null, revokedAt: null, ...extra,
});
async function seed(path, data) {
  await env.withSecurityRulesDisabled(c => c.firestore().doc(path).set(data));
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-tomeva', firestore: {
    host: '127.0.0.1', port: 8080, rules: fs.readFileSync('firestore.rules', 'utf8'),
  } });
});
afterAll(async () => { if (env) await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed('kiosk_admins/admin', { enabled: true, libraryId: 'main' });
});

test('verified institution staff creates and lists credentials for main', async () => {
  await assertSucceeds(admin().doc('kiosk_accounts/desk').set(metadata()));
  await assertSucceeds(admin().collection('kiosk_accounts').where('libraryId', '==', 'main').get());
  await assertFails(admin().collection('kiosk_accounts').get());
});

test('outside-domain and unverified Google logins cannot provision kiosks', async () => {
  for (const claims of [
    { email: 'outsider@gmail.com', email_verified: true },
    { email: 'owner@staff.example', email_verified: false },
  ]) await assertFails(context('admin', { ...claims, firebase: { sign_in_provider: 'google.com' } }).doc('kiosk_accounts/desk').set(metadata()));
});

test.each(['anonymous', 'password', 'kiosk', 'outsider'])('%s cannot grant kiosk access', async role => {
  const contexts = {
    anonymous: context('admin', { firebase: { sign_in_provider: 'anonymous' } }),
    password: context('admin', { email: 'owner@gmail.com', email_verified: true, firebase: { sign_in_provider: 'password' } }), kiosk: kiosk(),
    outsider: env.unauthenticatedContext().firestore(),
  };
  await assertFails(contexts[role].doc('kiosk_accounts/desk').set(metadata()));
});

test.each([
  { password: 'must-not-be-stored' }, { libraryId: 'other' }, { createdBy: 'someone-else' },
  { email: 'teacher@staff.example' }, { label: '' }, { label: 'x'.repeat(81) },
  { active: false }, { revokedBy: 'admin' }, { createdAt: new Date(0) },
])('rejects unsafe creation payload %j', async overrides => {
  await assertFails(admin().doc('kiosk_accounts/desk').set(metadata(overrides)));
});

test('clients cannot give themselves admin status or read another admin grant', async () => {
  await assertSucceeds(admin().doc('kiosk_admins/admin').get());
  await assertFails(admin().doc('kiosk_admins/admin').set({ enabled: true, libraryId: 'main' }));
  await assertFails(kiosk().doc('kiosk_admins/admin').get());
});

test('legacy admin grants no longer gate a Google login', async () => {
  await seed('kiosk_admins/admin', { enabled: false, libraryId: 'main' });
  await assertSucceeds(admin().doc('kiosk_accounts/desk').set(metadata()));
  await seed('kiosk_admins/admin', { enabled: true, libraryId: 'other' });
  await assertSucceeds(admin().doc('kiosk_accounts/second-desk').set(metadata()));
});

test('kiosk can read its own approval but cannot list, read others, or alter it', async () => {
  await assertSucceeds(admin().doc('kiosk_accounts/desk').set(metadata()));
  await assertSucceeds(kiosk().doc('kiosk_accounts/desk').get());
  await assertFails(kiosk().collection('kiosk_accounts').get());
  await assertFails(context('other').doc('kiosk_accounts/desk').get());
  await assertFails(kiosk().doc('kiosk_accounts/desk').update({ active: false }));
});

test('revocation blocks the same signed-in kiosk from circulation and request decisions', async () => {
  await admin().doc('kiosk_accounts/desk').set(metadata());
  await seed('libraries/main/book_requests/request', { status: 'Pending', requester_email: 'student@example.org' });
  const signedIn = kiosk();
  const circulation = signedIn.doc('libraries/main/restricted/circulation');
  const request = signedIn.doc('libraries/main/book_requests/request');
  await assertSucceeds(circulation.set({ loans: [] }));
  await assertSucceeds(request.update({ status: 'Approved' }));
  await assertSucceeds(admin().doc('kiosk_accounts/desk').update({ active: false, revokedBy: 'admin', revokedAt: serverTimestamp() }));
  await assertFails(circulation.set({ loans: [] }));
  await assertFails(request.update({ status: 'Issued' }));
  await assertSucceeds(signedIn.doc('libraries/main/public/catalog').set({
    stats: { total_books: 0, available: 0, issued: 0, damaged: 0, under_repair: 0, lost: 0 },
    availableList: [], issuedList: [], damagedList: [],
    last_synced: serverTimestamp(), last_synced_iso: new Date().toISOString(), sync_version: 6,
  }));
  await assertFails(admin().doc('kiosk_accounts/desk').update({ active: true }));
  await assertFails(admin().doc('kiosk_accounts/desk').delete());
});

test('admin cannot change identity, insert secrets, or forge revocation audit fields', async () => {
  await admin().doc('kiosk_accounts/desk').set(metadata());
  for (const change of [{ email: 'other@example.org' }, { libraryId: 'other' }, { password: 'secret' },
    { active: false }, { active: false, revokedBy: 'imposter', revokedAt: serverTimestamp() }]) {
    await assertFails(admin().doc('kiosk_accounts/desk').update(change));
  }
});

test('missing registry, old custom claims, mismatched email/provider/library all fail closed', async () => {
  const path = 'libraries/main/restricted/circulation';
  await assertFails(kiosk().doc(path).set({}));
  await assertFails(context('legacy', { kiosk: true, libraryId: 'main' }).doc(path).set({}));
  await admin().doc('kiosk_accounts/desk').set(metadata());
  await assertFails(kiosk({ email: 'another@example.org' }).doc(path).set({}));
  await assertFails(kiosk({ firebase: { sign_in_provider: 'anonymous' } }).doc(path).set({}));
  await assertFails(kiosk().doc('libraries/other/restricted/circulation').set({}));
  await assertFails(kiosk().doc('libraries/main/restricted/circulation').get());
});

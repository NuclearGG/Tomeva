const fs = require('node:fs');
const assert = require('node:assert/strict');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');
let env;
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-tomeva', firestore: {
    host: '127.0.0.1', port: 8080, rules: fs.readFileSync('firestore.rules', 'utf8'),
  } });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });
const email = 'victim@example.org';
const user = verified => env.authenticatedContext('student', { email, email_verified: verified }).firestore();
const seed = (path, value) => env.withSecurityRulesDisabled(ctx => ctx.firestore().doc(path).set(value));
const profile = { email, name: 'Victim', adm_no: 'ADM001', class: '10', section: 'A', first_login_at: new Date(), last_login_at: new Date() };

test('unverified email cannot create, overwrite, or delete a victim profile or authorization', async () => {
  const path = `libraries/main/student_logins/${email}`;
  const access = `libraries/main/authorized_students/${email}`;
  const attacker = user(false);
  await assertFails(attacker.doc(path).set(profile));
  await seed(path, profile);
  await seed('libraries/main/adm_claims/adm-adm001', { email, adm_no: 'ADM001' });
  await seed(access, { email, name: 'Victim', group: 'Regular' });
  await assertFails(attacker.doc(path).update({ name: 'Impersonator' }));
  await assertFails(attacker.doc(path).delete());
  await assertFails(attacker.doc(access).delete());
  await assertSucceeds(user(true).doc(path).update({ last_login_at: new Date() }));
});

test('unverified email cannot cancel or create requests even with a matching quota batch', async () => {
  const path = 'libraries/main/book_requests/existing';
  await seed(path, { requester_email: email, status: 'Pending' });
  await seed(`libraries/main/authorized_students/${email}`, { group: 'Regular' });
  await assertFails(user(false).doc(path).update({ status: 'Cancelled' }));
  await assertSucceeds(user(true).doc(path).update({ status: 'Cancelled' }));
  const db = user(false);
  const batch = db.batch();
  const now = firebase.default.firestore.FieldValue.serverTimestamp();
  batch.set(db.doc('libraries/main/request_quotas/student'), { windowStartedAt: now, updatedAt: now, count: 1, lastRequestId: 'forged' });
  batch.set(db.doc('libraries/main/book_requests/forged'), {
    adm_no: 'ADM001', student_name: 'Victim', class: '10', section: 'A', group: 'Regular',
    book_access_no: 'BOOK001', book_title: 'Book', priority: false, note: '', status: 'Pending',
    timestamp: now, timestamp_iso: new Date().toISOString(), requester_email: email, requester_uid: 'student',
  });
  await assertFails(batch.commit());
});

test.each(['student_logins', 'authorized_students'])('%s is readable only by its owner or staff/kiosk', async collection => {
  const path = `libraries/main/${collection}/${email}`;
  await seed(path, profile);
  await assertSucceeds(user(true).doc(path).get());
  await assertFails(user(false).doc(path).get());
  const other = env.authenticatedContext('other', { email: 'other@example.org', email_verified: true }).firestore();
  const anonymous = env.authenticatedContext('anonymous', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
  await assertFails(other.doc(path).get());
  await assertFails(anonymous.doc(path).get());
  await assertFails(other.collection(`libraries/main/${collection}`).get());
  await assertFails(anonymous.collection(`libraries/main/${collection}`).get());
});

test('admission claims enforce atomic uniqueness without enumerating student records', async () => {
  const db = user(true);
  await assertFails(db.doc(`libraries/main/student_logins/${email}`).set(profile));
  const batch = db.batch();
  batch.set(db.doc('libraries/main/adm_claims/adm-adm001'), { email, adm_no: 'ADM001' });
  batch.set(db.doc(`libraries/main/student_logins/${email}`), profile);
  await assertSucceeds(batch.commit());
  const second = env.authenticatedContext('second', { email: 'second@example.org', email_verified: true }).firestore();
  const duplicate = second.batch();
  duplicate.set(second.doc('libraries/main/adm_claims/adm-adm001'), { email: 'second@example.org', adm_no: 'ADM001' });
  duplicate.set(second.doc('libraries/main/student_logins/second@example.org'), { ...profile, email: 'second@example.org' });
  await assertFails(duplicate.commit());
  await assertFails(second.doc('libraries/main/adm_claims/adm-adm001').get());
  await assertFails(db.doc('libraries/main/adm_claims/other').set({ email, adm_no: 'OTHER' }));
});

test('a student on the staff domain gets no staff powers and ordinary staff cannot administer kiosks', async () => {
  const claims = { email: 'student@staff.example', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
  const db = env.authenticatedContext('shared-domain-student', claims).firestore();
  await assertFails(db.doc('libraries/main/restricted/circulation').get());
  await assertFails(db.doc('staff_accounts/student@staff.example').set({ active: true }));
  await seed('staff_accounts/student@staff.example', { active: true });
  await assertSucceeds(db.doc('libraries/main/restricted/circulation').get());
  await assertFails(db.collection('kiosk_accounts').where('libraryId', '==', 'main').get());
  await assertFails(db.doc('kiosk_admins/shared-domain-student').set({ enabled: true, libraryId: 'main' }));
});

test('student requests cannot spoof admission numbers, names, or extra fields', async () => {
  await seed(`libraries/main/authorized_students/${email}`, { email, name: 'Victim', adm_no: 'ADM001', group: 'Regular' });
  const db = user(true);
  const request = async (id, changes) => {
    const batch = db.batch();
    const now = firebase.default.firestore.FieldValue.serverTimestamp();
    batch.set(db.doc('libraries/main/request_quotas/student'), { windowStartedAt: now, updatedAt: now, count: 1, lastRequestId: id });
    batch.set(db.doc('libraries/main/book_requests/' + id), {
      adm_no: 'ADM001', student_name: 'Victim', class: '10', section: 'A', group: 'Regular',
      book_access_no: 'BOOK001', book_title: 'Book', priority: false, note: '', status: 'Pending',
      timestamp: now, timestamp_iso: new Date().toISOString(), requester_email: email, requester_uid: 'student', ...changes,
    });
    return batch.commit();
  };
  await assertFails(request('wrong-admission', { adm_no: 'OTHER' }));
  await assertFails(request('wrong-name', { student_name: 'Another student' }));
  await assertFails(request('extra-field', { arbitrary: 'payload' }));
  await assertSucceeds(request('valid', {}));
});

test('only approved writers publish bounded catalog pages', async () => {
  const manifest = { stats: { total_books: 0, available: 0, issued: 0, damaged: 0, under_repair: 0, lost: 0 }, generation: 'test-generation', shard_count: 1, sync_version: 7, last_synced: new Date(), last_synced_iso: new Date().toISOString() };
  const page = { generation: 'test-generation', index: 0, availableList: [], issuedList: [], damagedList: [] };
  const target = 'libraries/main/catalog_shards/test-generation-0';
  const anonymous = env.authenticatedContext('anonymous', {}).firestore();
  await assertFails(anonymous.doc(target).set(page));
  await assertFails(user(true).doc('libraries/main/public/catalog').set(manifest));
  const staff = env.authenticatedContext('staff', { email: 'staff@staff.example', email_verified: true }).firestore();
  await seed('staff_accounts/staff@staff.example', { active: true });
  await assertSucceeds(staff.doc('libraries/main/public/catalog').set(manifest));
  await assertSucceeds(staff.doc(target).set(page));
  await assertFails(staff.doc(target).set({ ...page, availableList: Array(201).fill({ book_id: 'junk' }) }));
  await assertFails(staff.doc(target).set({ ...page, student_names: ['PII'] }));
  await assertFails(user(true).doc('libraries/main/circulation_shards/test-generation-0').get());
});

test('admission numbers with slashes and percent signs reserve distinct document IDs', async () => {
  const { admissionKey } = require('../../desktop-integration/admission-key.cjs');
  const db = user(true), admission = '2026/001';
  const first = db.batch();
  first.set(db.doc('libraries/main/adm_claims/' + admissionKey(admission)), { email, adm_no: admission });
  first.set(db.doc(`libraries/main/student_logins/${email}`), { ...profile, adm_no: admission });
  await assertSucceeds(first.commit());
  const secondEmail = 'second@example.org';
  const other = env.authenticatedContext('second', { email: secondEmail, email_verified: true }).firestore();
  const literal = '2026%2f001', second = other.batch();
  second.set(other.doc('libraries/main/adm_claims/' + admissionKey(literal)), { email: secondEmail, adm_no: literal });
  second.set(other.doc('libraries/main/student_logins/' + secondEmail), { ...profile, email: secondEmail, adm_no: literal });
  await assertSucceeds(second.commit());
  assert.notEqual(admissionKey(admission), admissionKey(literal));
});

test('an approved kiosk can stage a complete 400-page batch under the actual rules', async () => {
  const kioskEmail = 'kiosk-' + 'a'.repeat(32) + '@kiosk.tomeva.invalid';
  await seed('kiosk_accounts/desk', { active: true, libraryId: 'main', email: kioskEmail });
  const db = env.authenticatedContext('desk', { email: kioskEmail, firebase: { sign_in_provider: 'password' } }).firestore();
  const batch = db.batch();
  for (let index = 0; index < 400; index++) batch.set(db.doc('libraries/main/catalog_shards/batch-' + index), { generation: 'batch', index, availableList: [], issuedList: [], damagedList: [] });
  await assertSucceeds(batch.commit());
});

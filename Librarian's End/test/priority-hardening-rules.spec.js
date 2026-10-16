const fs = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app'); require('firebase/compat/firestore');
const { audited } = require('./audit-helper.cjs');
let env;
const staffEmail = 'owner@staff.example', studentEmail = 'student@example.org';
const stamp = () => firebase.default.firestore.FieldValue.serverTimestamp();
const context = (uid, email, verified = true, provider = 'google.com') => env.authenticatedContext(uid, { email, email_verified: verified, firebase: { sign_in_provider: provider } }).firestore();
const staff = () => context('staff', staffEmail);
const owner = () => context('student', studentEmail);
const seed = (name, value) => env.withSecurityRulesDisabled(ctx => ctx.firestore().doc(name).set(value));
beforeAll(async () => { env = await initializeTestEnvironment({ projectId: 'demo-tomeva', firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync('firestore.rules', 'utf8') } }); });
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await seed('staff_accounts/' + staffEmail, { active: true }); });
const decision = (status, uid = 'staff', extra = {}) => ({ status, decision_note: 'Decision', decided_at: stamp(), decided_at_iso: new Date().toISOString(), decided_by: uid, ...extra });
const graph = { Pending: ['Approved', 'Declined', 'Issued'], Approved: ['Issued', 'Declined'], Issued: [], Declined: [], Cancelled: [] };
for (const [from, destinations] of Object.entries(graph)) for (const to of Object.keys(graph)) test(`request transition ${from} → ${to}`, async () => {
  const name = 'libraries/main/book_requests/flow'; await seed(name, { status: from, requester_email: studentEmail });
  const change = staff().doc(name).update(decision(to));
  await (destinations.includes(to) ? assertSucceeds(change) : assertFails(change));
});
test.each([{ decision_note: {} }, { decision_note: 'x'.repeat(301) }, { decided_by: 'forged' }, { decided_at: new Date(0) }, { decided_at_iso: {} }, { decided_at_iso: 'yesterday' }, { decided_at_iso: '2026-99-99T99:99:99.000Z' }, { requester_email: 'victim@example.org' }])('decision metadata rejects %j', async patch => {
  const name = 'libraries/main/book_requests/metadata'; await seed(name, { status: 'Pending', requester_email: studentEmail });
  await assertFails(staff().doc(name).update(decision('Approved', 'staff', patch)));
});
test('only the requester can cancel Pending, with complete truthful decision metadata', async () => {
  const name = 'libraries/main/book_requests/cancel'; await seed(name, { status: 'Pending', requester_email: studentEmail });
  await assertFails(owner().doc(name).update({ status: 'Cancelled' }));
  await assertFails(context('other', 'other@example.org').doc(name).update(decision('Cancelled', 'other')));
  await assertSucceeds(owner().doc(name).update(decision('Cancelled', 'student')));
  await assertFails(staff().doc(name).update(decision('Pending')));
});
test.each(['authorized_students', 'student_logins'])('%s deletion requires staff authority plus an atomic recovery event', async kind => {
  const name = `libraries/main/${kind}/${studentEmail}`;
  const data = kind === 'authorized_students' ? { email: studentEmail, name: 'Student', adm_no: 'S1', group: 'Regular', added_by: staffEmail, added_at: new Date() } : { email: studentEmail, name: 'Student', adm_no: 'S1', class: '10', section: 'A', first_login_at: new Date(), last_login_at: new Date() };
  await seed(name, data); await seed('libraries/main/adm_claims/adm-s1', { email: studentEmail, adm_no: 'S1' });
  for (const db of [owner(), context('unverified', studentEmail, false), context('other', 'other@example.org'), env.unauthenticatedContext().firestore(), staff()]) await assertFails(db.doc(name).delete());
  const admin = audited(staff(), 'staff', staffEmail);
  await assertSucceeds(admin.doc(name).delete());
  const events = await staff().collection('libraries/main/admin_audit').get();
  expect(events.size).toBe(1); expect(events.docs[0].data().before.email).toEqual(data.email); expect(events.docs[0].data().before.adm_no).toEqual(data.adm_no);
  await assertFails(events.docs[0].ref.update({ actorUid: 'forged' }));
  await assertFails(events.docs[0].ref.delete());
  await assertSucceeds(admin.doc(name).set(data));
  expect((await staff().doc(name).get()).data().adm_no).toEqual(data.adm_no);
});
test('a protected admin write without its journal is denied and cannot erase an existing before-image', async () => {
  const name = 'libraries/main/meta/control';
  const data = { issuance_suspended: false, suspend_reason: '', updated_at: new Date(), updated_by: 'admin' };
  await assertFails(staff().doc(name).set(data));
  await assertSucceeds(audited(staff(), 'staff', staffEmail).doc(name).set(data));
  await assertFails(staff().doc(name).update({ issuance_suspended: true }));
});
test('account removal requests cannot impersonate another student or complete before records are removed', async () => {
  const name = 'libraries/main/account_deletion_requests/' + studentEmail;
  const value = { email: studentEmail, requesterUid: 'student', status: 'Pending', requestedAt: stamp() };
  await assertFails(context('other', 'other@example.org').doc(name).set(value));
  await assertSucceeds(owner().doc(name).set(value));
  await assertFails(owner().doc(name).update({ status: 'Completed' }));
  await seed('libraries/main/authorized_students/' + studentEmail, { email: studentEmail, name: 'Student' });
  const admin = audited(staff(), 'staff', staffEmail);
  await assertFails(admin.doc(name).update({ status: 'Completed', completedAt: stamp(), completedBy: 'staff' }));
  await assertSucceeds(admin.doc('libraries/main/authorized_students/' + studentEmail).delete());
  await assertSucceeds(admin.doc(name).update({ status: 'Completed', completedAt: stamp(), completedBy: 'staff' }));
});
test('an audit event cannot fabricate a change or be reused to delete a newer version', async () => {
  const name = 'libraries/main/authorized_students/' + studentEmail;
  await seed(name, { email: studentEmail, name: 'Original' });
  const fake = { actorUid: 'staff', actorEmail: staffEmail, at: stamp(), target: name, kind: 'authorized_students', documentId: studentEmail, operation: 'DELETE', before: { email: studentEmail, name: 'Original' }, after: {} };
  await assertFails(staff().doc('libraries/main/admin_audit/forged').set(fake));
  await assertSucceeds(audited(staff(), 'staff', staffEmail).doc(name).delete());
  await seed(name, { email: studentEmail, name: 'Newer' });
  await assertFails(staff().doc(name).delete());
});
test('a password session cannot use a staff grant to delete records or forge an audit', async () => {
  const name = 'libraries/main/authorized_students/' + studentEmail;
  await seed(name, { email: studentEmail, name: 'Student' });
  const passwordStaff = context('password-staff', staffEmail, true, 'password');
  await assertFails(passwordStaff.doc(name).delete());
  await assertFails(audited(passwordStaff, 'password-staff', staffEmail).doc(name).delete());
});
test('a verified email can reopen completed removal after re-enrolment without completing or impersonating it', async () => {
  const name = 'libraries/main/account_deletion_requests/' + studentEmail;
  await seed(name, { email: studentEmail, requesterUid: 'old-account', status: 'Completed', requestedAt: new Date(), completedAt: new Date(), completedBy: 'staff' });
  const value = { email: studentEmail, requesterUid: 'student', status: 'Pending', requestedAt: stamp() };
  await assertFails(context('other', 'other@example.org').doc(name).set(value));
  await assertFails(owner().doc(name).set({ ...value, requesterUid: 'forged' }));
  await assertSucceeds(owner().doc(name).set(value));
  await assertFails(owner().doc(name).update({ status: 'Completed' }));
  await assertFails(owner().doc(name).delete());
});
test('a four-record access removal remains atomic within audit and rule access limits', async () => {
  const base = 'libraries/main/';
  const value = { email: studentEmail, name: 'Student', adm_no: 'S1', group: 'Regular', added_by: staffEmail, added_at: new Date(), updated_at: new Date(), class: '', section: '' };
  await seed(base + 'authorized_students/' + studentEmail, value);
  await seed(base + 'student_logins/' + studentEmail, { email: studentEmail, name: 'Student', adm_no: 'S1', class: '', section: '', first_login_at: new Date(), last_login_at: new Date() });
  await seed(base + 'adm_claims/adm-s1', { email: studentEmail, adm_no: 'S1' });
  const { group, ...roster } = value; await seed(base + 'admission_roster/s1', { ...roster, group: 'Regular' });
  const admin = audited(staff(), 'staff', staffEmail), batch = admin.batch();
  batch.delete(admin.doc(base + 'authorized_students/' + studentEmail)); batch.delete(admin.doc(base + 'student_logins/' + studentEmail)); batch.delete(admin.doc(base + 'adm_claims/adm-s1')); batch.update(admin.doc(base + 'admission_roster/s1'), { email: '', updated_at: stamp() });
  await assertSucceeds(batch.commit());
  expect((await staff().collection(base + 'admin_audit').get()).size).toBe(4);
});

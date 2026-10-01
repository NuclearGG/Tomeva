const fs = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
let env;
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-tomeva', firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync('firestore.rules', 'utf8') } });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });
const user = (email, verified = true) => env.authenticatedContext(email, { email, email_verified: verified }).firestore();
const seed = async (name, data) => env.withSecurityRulesDisabled(context => context.firestore().doc(name).set(data));

test('request details can be read by the owner and staff, not other students or anonymous users', async () => {
  const name = 'libraries/main/book_requests/a';
  await seed(name, { requester_email: 'one@example.org', status: 'Pending' });
  await assertSucceeds(user('one@example.org').doc(name).get());
  await assertSucceeds(user('staff@staff.example').doc(name).get());
  await assertFails(user('two@example.org').doc(name).get());
  await assertFails(user('one@example.org', false).doc(name).get());
  await assertFails(env.unauthenticatedContext().firestore().doc(name).get());
  await assertSucceeds(user('one@example.org').collection('libraries/main/book_requests').where('requester_email', '==', 'one@example.org').get());
  await assertFails(user('one@example.org').collection('libraries/main/book_requests').get());
});
test.each(['notifications', 'admin_notifications'])('%s messages are private to staff and registered kiosks', async collection => {
  const name = `libraries/main/${collection}/a`;
  await seed(name, { body: 'private content' });
  await assertSucceeds(user('staff@staff.example').doc(name).get());
  await assertFails(user('student@example.org').doc(name).get());
  await assertFails(env.unauthenticatedContext().firestore().doc(name).get());
});
test.each(['push_tokens', 'push_events'])('%s denies all client reads and writes', async collection => {
  const name = `libraries/main/${collection}/a`;
  await seed(name, { token: 'secret-device-token' });
  for (const db of [user('staff@staff.example'), user('one@example.org'), env.unauthenticatedContext().firestore()]) {
    await assertFails(db.doc(name).get());
    await assertFails(db.doc(name).set({ token: 'replacement' }));
    await assertFails(db.doc(name).delete());
  }
});
test('students can read only their own message and cannot forge or edit it', async () => {
  const name = 'libraries/main/student_messages/a';
  await seed('libraries/main/authorized_students/one@example.org', { group: 'Regular' });
  await seed(name, { recipient_email: 'one@example.org', eventType: 'STUDENT_MESSAGE', body: 'private content' });
  await assertSucceeds(user('one@example.org').doc(name).get());
  await assertSucceeds(user('staff@staff.example').doc(name).get());
  await assertFails(user('two@example.org').doc(name).get());
  await assertFails(user('one@example.org', false).doc(name).get());
  await assertFails(user('one@example.org').doc(name).update({ body: 'edited' }));
  await assertFails(user('one@example.org').doc(name).delete());
});
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');
test('only verified Google institution staff authorize bounded public update policies', async () => {
  const name = 'libraries/main/update_approvals/admin';
  const staff = env.authenticatedContext('supervisor', { email: 'supervisor@staff.example', email_verified: true, firebase: { sign_in_provider: 'google.com' } }).firestore();
  const value = { version: '1.2.0', policy: 'approved', notBefore: new Date(), updatedAt: firebase.default.firestore.FieldValue.serverTimestamp() };
  await assertSucceeds(staff.doc(name).set(value));
  await assertSucceeds(env.unauthenticatedContext().firestore().doc(name).get());
  await assertFails(user('student@example.org').doc(name).set(value));
  await assertFails(user('supervisor@staff.example', false).doc(name).set(value));
  await assertFails(env.unauthenticatedContext().firestore().doc(name).set(value));
  await assertFails(staff.doc(name).set({ ...value, policy: 'force' }));
  await assertFails(staff.doc(name).set({ ...value, version: 'https://evil.example' }));
  await assertFails(staff.doc(name).set({ ...value, credential: 'secret' }));
  await assertSucceeds(staff.doc(name).set({ ...value, policy: 'paused' }));
  await assertSucceeds(staff.doc(name).delete());
});

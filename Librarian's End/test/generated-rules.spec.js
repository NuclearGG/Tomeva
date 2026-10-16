const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { institutionRules } = require('../../Control Center/rules-config');
const { serverTimestamp } = require('firebase/firestore');
const source = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');

describe.each(['school.edu', 'gmail.com', 'staff.school.edu'])('exported rules for %s', domain => {
  let env;
  const email = `owner@${domain}`;
  const seed = (name, value) => env.withSecurityRulesDisabled(ctx => ctx.firestore().doc(name).set(value));
  const admin = (provider = 'google.com', changes = {}) => require('./audit-helper.cjs').audited(env.authenticatedContext('owner', {
    email, email_verified: true, firebase: { sign_in_provider: provider }, ...changes,
  }).firestore(), 'owner', changes.email || email);
  const appearance = () => ({ schemaVersion: 1, brandEnabled: true, accentColor: '#254c80', surfaceTone: 'catalogue', typography: 'editorial', density: 'comfortable', corners: 'soft', displayName: 'School', portalHeading: 'Catalogue', notice: '', revision: 1, updatedAt: serverTimestamp(), updatedBy: 'owner' });
  beforeAll(async () => {
    const exported = domain === 'gmail.com' && process.env.TOMEVA_DEPLOYED_RULES_FILE ? fs.readFileSync(process.env.TOMEVA_DEPLOYED_RULES_FILE, 'utf8') : institutionRules(source, domain);
    env = await initializeTestEnvironment({ projectId: 'demo-tomeva', firestore: { host: '127.0.0.1', port: 8080, rules: exported } });
  });
  afterAll(async () => { await env?.cleanup(); });
  beforeEach(async () => {
    await env.clearFirestore();
    await seed(`staff_accounts/${email}`, { active: true });
    await seed('kiosk_admins/owner', { enabled: true, libraryId: 'main' });
  });
  test('verified Google administrator can publish appearance and provision a kiosk', async () => {
    await assertSucceeds(admin().doc('libraries/main/public/appearance').set(appearance()));
    await assertSucceeds(admin().collection('kiosk_accounts').where('libraryId', '==', 'main').get());
  });
  test.each(['password', 'custom', 'anonymous'])('provider %s cannot use administrator powers even with both grants', async provider => {
    await assertFails(admin(provider).doc('libraries/main/public/appearance').set(appearance()));
    await assertFails(admin(provider).collection('kiosk_accounts').where('libraryId', '==', 'main').get());
  });
  test('wrong domain, suffix lookalike, unverified email and disabled grants fail', async () => {
    for (const value of [`owner@other.edu`, `owner@${domain}.attacker.org`]) {
      await seed(`staff_accounts/${value}`, { active: true });
      await assertFails(admin('google.com', { email: value }).doc('libraries/main/public/appearance').set(appearance()));
    }
    await assertFails(admin('google.com', { email_verified: false }).doc('libraries/main/public/appearance').set(appearance()));
    await seed('kiosk_admins/owner', { enabled: false, libraryId: 'main' });
    await assertFails(admin().doc('libraries/main/public/appearance').set(appearance()));
    await seed('kiosk_admins/owner', { enabled: true, libraryId: 'main' });
    await seed(`staff_accounts/${email}`, { active: false });
    await assertFails(admin().doc('libraries/main/public/appearance').set(appearance()));
  });
  test('ordinary staff cannot grant themselves administrator access', async () => {
    await assertFails(admin().doc('kiosk_admins/owner').set({ enabled: true, libraryId: 'main' }));
    await assertFails(admin().doc(`staff_accounts/${email}`).set({ active: true }));
  });
});

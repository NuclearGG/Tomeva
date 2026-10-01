// Dependency-free emulator checks, also usable while npm dependencies are unavailable.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const host = 'http://127.0.0.1:8080';
const project = 'demo-tomeva';
const database = `projects/${project}/databases/(default)`;
const email = 'kiosk-' + 'b'.repeat(32) + '@kiosk.tomeva.invalid';
function token(uid, claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const encode = data => Buffer.from(JSON.stringify(data)).toString('base64url');
  return encode({ alg: 'none', typ: 'JWT' }) + '.' + encode({
    iss: `https://securetoken.google.com/${project}`, aud: project, sub: uid,
    user_id: uid, iat: now, exp: now + 3600, auth_time: now,
    firebase: { sign_in_provider: 'password', identities: {} }, ...claims,
  }) + '.';
}
const admin = token('rest-admin', { email: 'owner@example.org', firebase: { sign_in_provider: 'google.com' } });
const kiosk = token('rest-desk', { email, email_verified: false });
function value(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  return { stringValue: v };
}
async function request(endpoint, auth, method = 'GET', body) {
  const response = await fetch(host + endpoint, { method, headers: {
    'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.text() };
}
function write(docPath, data, auth, { merge = false, times = [] } = {}) {
  return request(`/v1/${database}/documents:commit`, auth, 'POST', { writes: [{
    update: { name: `${database}/documents/${docPath}`, fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, value(v)])) },
    ...(merge ? { updateMask: { fieldPaths: Object.keys(data) } } : {}),
    ...(times.length ? { updateTransforms: times.map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) } : {}),
  }] });
}
const read = (p, auth) => request(`/v1/${database}/documents/${p}`, auth);
const ok = result => assert.equal(result.status, 200, result.body);
const denied = result => assert.equal(result.status, 403, result.body);
const record = (overrides = {}) => ({ email, label: 'REST test desk', libraryId: 'main', active: true,
  createdBy: 'rest-admin', revokedBy: null, revokedAt: null, ...overrides });

before(async () => {
  const result = await request(`/emulator/v1/projects/${project}:securityRules`, null, 'PUT', {
    rules: { files: [{ content: fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8') }] },
  }); ok(result);
  ok(await request(`/emulator/v1/${database}/documents`, 'owner', 'DELETE'));
  ok(await write('kiosk_admins/rest-admin', { enabled: true, libraryId: 'main' }, 'owner'));
});

test('administrator can create approved metadata with server timestamps', async () => {
  ok(await write('kiosk_accounts/rest-desk', record(), admin, { times: ['createdAt'] }));
});
test('admin may read its grant but cannot write grants', async () => {
  ok(await read('kiosk_admins/rest-admin', admin));
  denied(await write('kiosk_admins/rest-admin', { enabled: true, libraryId: 'main' }, admin));
});
test('kiosk can read only its own registry entry', async () => {
  ok(await read('kiosk_accounts/rest-desk', kiosk));
  denied(await read('kiosk_accounts/rest-desk', token('other', { email })));
  denied(await read('kiosk_accounts/rest-desk', null));
});
test('active password account can sync protected data and approve requests', async () => {
  ok(await write('libraries/main/restricted/circulation', { loans: 'test' }, kiosk));
  ok(await write('libraries/main/book_requests/rest-request', { status: 'Pending', requester_email: 'student@example.org' }, 'owner'));
  ok(await write('libraries/main/book_requests/rest-request', { status: 'Approved' }, kiosk, { merge: true }));
});
test('registry approval is scoped to library, email, and sign-in provider', async () => {
  denied(await write('libraries/other/restricted/circulation', {}, kiosk));
  denied(await write('libraries/main/restricted/circulation', {}, token('rest-desk', { email: 'wrong@example.org' })));
  denied(await write('libraries/main/restricted/circulation', {}, token('rest-desk', { email, firebase: { sign_in_provider: 'anonymous' } })));
  denied(await write('libraries/main/restricted/circulation', {}, token('legacy', { kiosk: true, libraryId: 'main' })));
});
test('kiosk cannot grant/revoke credentials, read private circulation, or set admin control', async () => {
  denied(await write('kiosk_accounts/rest-desk', { active: false }, kiosk, { merge: true }));
  denied(await read('libraries/main/restricted/circulation', kiosk));
  denied(await write('libraries/main/meta/control', { issuance_suspended: true, suspend_reason: '', updated_by: 'admin' }, kiosk, { times: ['updated_at'] }));
});
test('Google accounts can provision without a grant or domain restriction', async () => {
  ok(await write('kiosk_accounts/gmail-desk', {
    ...record(), email: 'kiosk-' + 'c'.repeat(32) + '@kiosk.tomeva.invalid', createdBy: 'gmail-admin',
  }, token('gmail-admin', { email: 'tester@example.net', firebase: { sign_in_provider: 'google.com' } }), { times: ['createdAt'] }));
});
test('password sessions cannot provision even with a staff email', async () => {
  denied(await write('kiosk_accounts/unverified', record(), token('outsider', { email: 'other@gmail.com', email_verified: false }), { times: ['createdAt'] }));
  denied(await write('kiosk_accounts/unapproved', record(), token('outsider', { email: 'teacher@staff.example', email_verified: true }), { times: ['createdAt'] }));
});
test('rejects secrets, incorrect audit fields, foreign library, and invalid labels', async () => {
  for (const overrides of [{ password: 'secret' }, { createdBy: 'imposter' }, { libraryId: 'other' }, { label: '' }, { label: 'a'.repeat(81) }, { email: 'staff@staff.example' }]) {
    denied(await write('kiosk_accounts/invalid', record(overrides), admin, { times: ['createdAt'] }));
  }
});
test('admin can query only their library registry', async () => {
  const base = { from: [{ collectionId: 'kiosk_accounts' }] };
  ok(await request(`/v1/${database}/documents:runQuery`, admin, 'POST', { structuredQuery: {
    ...base, where: { fieldFilter: { field: { fieldPath: 'libraryId' }, op: 'EQUAL', value: { stringValue: 'main' } } },
  } }));
  denied(await request(`/v1/${database}/documents:runQuery`, admin, 'POST', { structuredQuery: base }));
});
test('revocation blocks existing token approvals and restricted sync immediately', async () => {
  ok(await write('kiosk_accounts/rest-desk', { active: false, revokedBy: 'rest-admin' }, admin, { merge: true, times: ['revokedAt'] }));
  denied(await write('libraries/main/restricted/circulation', { loans: 'changed' }, kiosk));
  denied(await write('libraries/main/book_requests/rest-request', { status: 'Issued' }, kiosk, { merge: true }));
  ok(await write('libraries/main/public/catalog', { books: 'aggregate only' }, kiosk));
  denied(await write('kiosk_accounts/rest-desk', { active: true }, admin, { merge: true }));
  denied(await request(`/v1/${database}/documents/kiosk_accounts/rest-desk`, admin, 'DELETE'));
});
test('legacy grant status does not restrict Google logins; password sessions stay denied', async () => {
  denied(await write('kiosk_accounts/disabled', record(), token('rest-admin', { email: 'owner@example.org', email_verified: false }), { times: ['createdAt'] }));
  ok(await write('kiosk_admins/rest-admin', { enabled: false, libraryId: 'main' }, 'owner'));
  ok(await write('kiosk_accounts/disabled', record(), admin, { times: ['createdAt'] }));
});

const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { createCredentialStore } = require('../main/kiosk-credentials');
test('kiosk secrets are bound to the current project, validated, encrypted, and written atomically', t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tomeva-creds-')); t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  let project = 'demo-first', available = true;
  const protection = { isEncryptionAvailable: () => available, getSelectedStorageBackend: () => 'test-secure', encryptString: value => Buffer.from(value).map(byte => byte ^ 42), decryptString: value => Buffer.from(value).map(byte => byte ^ 42).toString() };
  const store = createCredentialStore({ userData, getProject: () => project, protection });
  const email = 'kiosk-' + 'a'.repeat(32) + '@kiosk.tomeva.invalid', password = 'issued-test-credential-2026';
  assert.equal(store.set('ws-main', email, password).ok, true);
  assert.deepEqual(store.get('ws-main'), { email, password });
  const [filename] = fs.readdirSync(userData); assert.ok(!fs.readFileSync(path.join(userData, filename), 'utf8').includes(password));
  assert.equal(store.set('../elsewhere', email, password).ok, false);
  assert.equal(store.set('ws-main', 'bad@example.org', password).ok, false);
  project = 'demo-second'; assert.equal(store.get('ws-main'), null);
  project = 'demo-first'; available = false; assert.equal(store.get('ws-main'), null); assert.equal(store.set('ws-main', email, password).ok, false);
  available = true; fs.writeFileSync(path.join(userData, filename), 'corrupt'); assert.equal(store.get('ws-main'), null);
});

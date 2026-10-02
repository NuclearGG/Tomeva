const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateConfig, createConfigStore } = require('../config-store');
const { checkDesktopReleases } = require('../desktop-releases');
const config = {
  institutionName: 'Example College',
  firebase: { apiKey: 'public-test-key', authDomain: 'demo-school.firebaseapp.com', projectId: 'demo-school', appId: '1:123:web:abc', messagingSenderId: '123', storageBucket: 'demo-school.firebasestorage.app' },
  staffDomain: 'school.edu', webUrl: 'https://demo-school.web.app/',
};
test('public config preserves optional Firebase fields and rejects private keys', () => {
  assert.equal(validateConfig(config).institutionName, 'Example College');
  assert.equal(validateConfig({ ...config, institutionName: '  Another School  ' }).institutionName, 'Another School');
  assert.throws(() => validateConfig({ ...config, institutionName: 'x'.repeat(201) }), /institution name/);
  assert.equal(validateConfig(config).firebase.storageBucket, config.firebase.storageBucket);
  assert.throws(() => validateConfig({ ...config, firebase: { ...config.firebase, private_key: 'secret' } }), /private credentials/);
  assert.throws(() => validateConfig({ ...config, webUrl: 'http://school.edu/' }), /HTTPS/);
});
test('saving configuration preserves a recoverable previous copy', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tomeva-config-test-'));
  const store = createConfigStore(directory);
  assert.equal(store.read(), null);
  store.save(config);
  store.save({ ...config, webUrl: 'https://demo-school.web.app/search.html' });
  const backup = fs.readdirSync(directory).find(name => name.includes('.backup.'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, backup), 'utf8')).webUrl, config.webUrl);
  assert.equal(store.read().webUrl, 'https://demo-school.web.app/search.html');
  assert.equal(store.read().institutionName, config.institutionName);
});
test('release discovery contacts only the configured public repository', async () => {
  const requests = [];
  const result = await checkDesktopReleases({ owner: 'tomeva', librarian: 'librarian-releases', admin: 'admin-releases' }, async url => {
    requests.push(url);
    return { ok: true, json: async () => ({ tag_name: 'v1.2.0', body: 'Release notes', published_at: '2026-09-30T00:00:00Z' }) };
  });
  assert.deepEqual(requests, [
    'https://api.github.com/repos/tomeva/librarian-releases/releases/latest',
    'https://api.github.com/repos/tomeva/admin-releases/releases/latest',
  ]);
  assert.equal(result.librarian.version, '1.2.0');
  assert.equal(result.admin.state, 'current-release');
});

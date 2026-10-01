const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
test('installer-side configuration bootstraps a new profile and never replaces saved institution settings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tomeva-sidecar-'));
  const profile = path.join(dir, 'profile');
  const config = { firebase: { apiKey: 'public', projectId: 'demo-school', authDomain: 'demo-school.firebaseapp.com', appId: '1:1:web:abc', messagingSenderId: '1' }, staffDomain: 'school.edu', libraryId: 'main' };
  fs.writeFileSync(path.join(dir, 'institution.json'), JSON.stringify(config));
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../desktop-integration/institution-config.cjs'), 'utf8'), { module: mod, require: name => name === 'electron' ? { app: { isPackaged: true, getPath: name => name === 'exe' ? path.join(dir, 'Tomeva.exe') : profile } } : require(name) });
  assert.equal(mod.exports.read().firebase.projectId, 'demo-school');
  fs.writeFileSync(path.join(dir, 'institution.json'), JSON.stringify({ ...config, staffDomain: 'other.edu' }));
  assert.equal(mod.exports.read().staffDomain, 'school.edu');
});

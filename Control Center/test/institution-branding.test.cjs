const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('all app UI sources are free of preset institution branding', () => {
  const root = path.resolve(__dirname, '../..');
  const excluded = new Set(['node_modules', 'vendor', 'dist', 'test', 'test-artifacts', 'functions', 'firebase-template']);
  function inspect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory() && !excluded.has(entry.name) && !entry.name.startsWith('node_modules') && !entry.name.startsWith('.')) inspect(filename);
      else if (entry.isFile() && /\.(?:html|css|js|mjs|webmanifest|svg)$/i.test(entry.name)) {
        assert.doesNotMatch(fs.readFileSync(filename, 'utf8'), /me[\s_-]*academy/i, path.relative(root, filename));
      }
    }
  }
  for (const app of ["Admin's End", "Librarian's End", 'Student Search', 'Control Center']) inspect(path.join(root, app));
});

test('desktop provisioning preserves the institution name', () => {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../../desktop-integration/institution-config.cjs'), 'utf8');
  vm.runInNewContext(source, { module, process, require: name => name === 'electron' ? { app: {} } : name === './public-setup.cjs' ? { downloadPublicSetup: async () => {} } : require(name) });
  const config = { institutionName: 'Example College', staffDomain: 'college.edu', libraryId: 'main', firebase: { apiKey: 'public', projectId: 'demo-college', authDomain: 'demo-college.firebaseapp.com', appId: '1:1:web:abc', messagingSenderId: '1' } };
  assert.equal(module.exports.validate(config).institutionName, config.institutionName);
  delete config.institutionName;
  assert.equal(module.exports.validate(config).institutionName, '');
});

test('student portals display the configured name as text and normalize the staff domain', () => {
  for (const file of ['../../Student Search/search.html', '../web-template/search.html']) {
    const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const start = html.indexOf('const STAFF_DOMAIN =');
    const end = html.indexOf('\n});', start) + 4;
    const label = { getAttribute: () => null };
    const context = { webConfig: { institutionName: '<Example & College>', staffDomain: ' College.EDU ' }, document: { querySelectorAll: () => [label] } };
    vm.runInNewContext(html.slice(start, end) + '\nglobalThis.domain = STAFF_DOMAIN;', context);
    assert.equal(label.textContent, '<Example & College>');
    assert.equal(context.domain, 'college.edu');
    delete context.webConfig.institutionName;
    vm.runInNewContext(html.slice(start, end), { ...context });
    assert.equal(label.textContent, 'your institution’s');
  }
});

test('legacy kiosk functions enforce the configured verified staff domain and fail closed without it', () => {
  const source = fs.readFileSync(path.join(__dirname, "../../Librarian's End/functions/mintKioskToken.js"), 'utf8');
  const auth = source.slice(source.indexOf('const STAFF_DOMAIN ='), source.indexOf('\n/**', source.indexOf('const STAFF_DOMAIN =')));
  for (const domain of ['', ' College.EDU ']) {
    const context = { process: { env: { TOMEVA_STAFF_DOMAIN: domain } } };
    vm.runInNewContext(auth, context);
    for (const [email, verified, expected] of [['staff@COLLEGE.edu', true, !!domain], ['staff@college.edu', false, false], ['staff@evilcollege.edu', true, false], ['staff@college.edu.evil.com', true, false]]) {
      assert.equal(context.isInstitutionStaff({ email, email_verified: verified }), expected);
    }
  }
});

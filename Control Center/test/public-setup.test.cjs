const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolvePublicSetupUrl, downloadPublicSetup, MAX_PUBLIC_SETUP_BYTES } = require('../../desktop-integration/public-setup.cjs');

const profile = {
  schemaVersion: 1,
  institutionName: 'Example School',
  firebase: { apiKey: 'public-key', projectId: 'example-school', authDomain: 'example-school.firebaseapp.com', appId: 'app', messagingSenderId: '123' },
  staffDomain: 'example.edu', webUrl: 'https://example.edu/library/', libraryId: 'main',
};
const validate = data => ({ projectId: data.firebase.projectId, name: data.institutionName });

test('public setup resolves a portal base URL or exact JSON URL', () => {
  assert.equal(resolvePublicSetupUrl('https://school.example/library'), 'https://school.example/library/tomeva-institution.json');
  assert.equal(resolvePublicSetupUrl('https://school.example/library/index.html'), 'https://school.example/library/tomeva-institution.json');
  assert.equal(resolvePublicSetupUrl('https://school.example/tomeva-institution.json?old=1'), 'https://school.example/tomeva-institution.json');
  for (const url of ['http://school.example', 'file:///tmp/setup.json', 'https://user:pass@school.example']) assert.throws(() => resolvePublicSetupUrl(url), /HTTPS/);
});

test('public setup downloads a bounded versioned profile without login', async () => {
  let requested;
  const result = await downloadPublicSetup('https://school.example/', { validate, request: async (url, options) => {
    requested = { url, options };
    return new Response(JSON.stringify(profile));
  } });
  assert.equal(requested.url, 'https://school.example/tomeva-institution.json');
  assert.equal(requested.options.redirect, 'error');
  assert.deepEqual(result.config, { projectId: 'example-school', name: 'Example School' });
});

test('public setup rejects errors, invalid versions, JSON and oversized responses', async () => {
  await assert.rejects(downloadPublicSetup('https://school.example', { validate, request: async () => new Response('', { status: 404 }) }), /HTTP 404/);
  await assert.rejects(downloadPublicSetup('https://school.example', { validate, request: async () => new Response('{') }), /valid JSON/);
  await assert.rejects(downloadPublicSetup('https://school.example', { validate, request: async () => Response.json({ ...profile, schemaVersion: 2 }) }), /unsupported format/);
  await assert.rejects(downloadPublicSetup('https://school.example', { validate, request: async () => new Response(Buffer.alloc(MAX_PUBLIC_SETUP_BYTES + 1)) }), /too large/);
});

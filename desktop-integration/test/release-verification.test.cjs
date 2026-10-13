const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPrivateKey, createPublicKey, createHash, sign } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyManifest, verifyFile, loadManifest } = require('../release-verification.cjs');
// Deterministic test-only fixture, kept out of the publisher trust configuration.
const fixture = createPrivateKey({ key: Buffer.from('302e020100300506032b657004220420' + '11'.repeat(32), 'hex'), format: 'der', type: 'pkcs8' });
const publicKey = createPublicKey(fixture).export({ type: 'spki', format: 'pem' });
test('a valid publisher signature authorizes only the exact package bytes', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tomeva-signature-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('test installer bytes');
  const manifest = Buffer.from(createHash('sha256').update(bytes).digest('hex') + '  test.exe\n');
  const signature = sign(null, manifest, fixture);
  const entries = verifyManifest(manifest, signature, [publicKey]);
  const filename = path.join(directory, 'test.exe');
  fs.writeFileSync(filename, bytes);
  await verifyFile(filename, 'test.exe', entries);
  assert.throws(() => verifyManifest(Buffer.from('changed manifest'), signature, [publicKey]), /signature/);
  assert.throws(() => verifyManifest(manifest, Buffer.alloc(64), [publicKey]), /signature/);
  assert.throws(() => verifyManifest(manifest, signature, []), /Configure/);
  fs.writeFileSync(filename, 'modified installer');
  await assert.rejects(verifyFile(filename, 'test.exe', entries), /checksum/);
});

test('unsigned pilots verify hashes while configured publishers never fall back', async () => {
  const bytes = Buffer.from('pilot installer');
  const manifest = Buffer.from(createHash('sha256').update(bytes).digest('hex') + '  pilot.exe\n');
  const urls = [];
  const request = async url => {
    urls.push(url);
    return url.endsWith('.sig') ? new Response(null, { status: 404 }) : new Response(manifest);
  };
  const entries = await loadManifest('v1.0.8', { request, publicKeys: [] });
  assert.equal(entries.get('pilot.exe'), createHash('sha256').update(bytes).digest('hex'));
  assert.equal(urls.length, 1, 'pilots do not require a signature asset');
  await assert.rejects(loadManifest('v1.0.8', { request, publicKeys: [publicKey] }), /unavailable/);
  await assert.rejects(loadManifest('v1.0.8', { publicKeys: [publicKey], request: async url => new Response(url.endsWith('.sig') ? Buffer.alloc(64) : manifest) }), /signature/);
  const signed = await loadManifest('v1.0.8', { publicKeys: [publicKey], request: async url => new Response(url.endsWith('.sig') ? sign(null, manifest, fixture) : manifest) });
  assert.equal(signed.get('pilot.exe'), entries.get('pilot.exe'));
  await assert.rejects(loadManifest('v1.0.8', { publicKeys: [], request: async () => new Response('invalid') }), /Invalid/);
  await assert.rejects(loadManifest('../bad', { request }), /tag/);
  await assert.rejects(loadManifest('v1.0.8', { request: async () => new Response(null, { status: 302, headers: { location: 'https://example.com/manifest' } }) }), /Untrusted/);
});

test('pilot builds need no signing credentials; signed builds require them', () => {
  const { configureSigning } = require('../build-signing.cjs');
  const saved = { requireSigning: process.env.TOMEVA_REQUIRE_SIGNING, publisher: process.env.TOMEVA_WINDOWS_PUBLISHER };
  try {
    delete process.env.TOMEVA_REQUIRE_SIGNING;
    delete process.env.TOMEVA_WINDOWS_PUBLISHER;
    assert.equal(configureSigning({ win: {} }).win.forceCodeSigning, false);
    process.env.TOMEVA_REQUIRE_SIGNING = '1';
    assert.throws(() => configureSigning({ win: {} }), /existing publisher release key/);
  } finally {
    for (const [name, value] of [['TOMEVA_REQUIRE_SIGNING', saved.requireSigning], ['TOMEVA_WINDOWS_PUBLISHER', saved.publisher]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

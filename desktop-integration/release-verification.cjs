'use strict';
const { verify, createHash, createPublicKey } = require('node:crypto');
const fs = require('node:fs');
const keys = require('./release-keys.cjs');
const hosts = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const compatibleFetch = globalThis.fetch || require('node-fetch');
async function boundedDownload(url, maxBytes, request, signal) {
  for (let hop = 0; hop < 6; hop++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !hosts.has(parsed.hostname)) throw new Error('Untrusted release signature URL.');
    const response = await request(url, { redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel?.();
      if (!location) throw new Error('Invalid release redirect.');
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok || !response.body) throw new Error('The release checksum or signature asset is unavailable.');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      const bytes = typeof chunk === 'number' ? Buffer.from([chunk]) : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) throw new Error('Oversized signature or checksum manifest.');
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  }
  throw new Error('Too many release redirects.');
}
function verifyManifest(bytes, signature, publicKeys = keys) {
  if (!publicKeys.length) throw new Error('Configure an existing publisher release key before installing software.');
  const signed = signature.length === 64 && publicKeys.some(value => {
    const key = createPublicKey(value);
    return key.asymmetricKeyType === 'ed25519' && verify(null, bytes, key, signature);
  });
  if (!signed) throw new Error('Publisher signature verification failed.');
  return parseManifest(bytes);
}
function parseManifest(bytes) {
  const entries = new Map();
  for (const line of bytes.toString('utf8').trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
    if (!match || match[2] === '.' || match[2] === '..' || entries.has(match[2])) throw new Error('Invalid checksum manifest.');
    entries.set(match[2], match[1]);
  }
  return entries;
}
async function loadManifest(tag, { request = compatibleFetch, signal, publicKeys = keys } = {}) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Invalid release tag.');
  const base = 'https://github.com/NuclearGG/Tomeva/releases/download/' + tag + '/';
  const abort = signal || AbortSignal.timeout(30000);
  const bytes = await boundedDownload(base + 'SHA256SUMS', 128 * 1024, request, abort);
  // Empty embedded trust configuration is the development/pilot policy.
  // A configured publisher must never fall back after a missing/invalid signature.
  if (!publicKeys.length) return parseManifest(bytes);
  const signature = await boundedDownload(base + 'SHA256SUMS.sig', 64, request, abort);
  return verifyManifest(bytes, signature, publicKeys);
}
async function verifyFile(filename, publishedName, manifest) {
  const expected = manifest.get(publishedName);
  if (!expected) throw new Error('Package is absent from the release checksum manifest.');
  const digest = createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) digest.update(chunk);
  if (digest.digest('hex') !== expected) throw new Error('Downloaded package does not match the release checksum.');
}
module.exports = { verifyManifest, loadManifest, verifyFile };

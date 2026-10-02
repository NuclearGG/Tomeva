const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { latestRelease, selectAsset, downloadAsset } = require('../github-distribution');
const bytes = Buffer.from('official test software');
const asset = { name: 'tomeva-admin-1.2.0-win-x64.exe', browser_download_url: 'https://github.com/NuclearGG/Tomeva/releases/download/v1.2.0/tomeva-admin-1.2.0-win-x64.exe', size: bytes.length, digest: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex') };
const temp = () => fs.mkdtemp(path.join(os.tmpdir(), 'tomeva-download-'));
test('official latest release lookup contains no institution data and selects exact platform', async () => {
  const release = await latestRelease(async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/NuclearGG/Tomeva/releases/latest');
    assert.equal(options.redirect, 'error');
    return Response.json({ tag_name: 'v1.2.0', assets: [asset] });
  });
  assert.equal(selectAsset(release, 'admin').name, asset.name);
  assert.throws(() => selectAsset(release, 'admin', 'linux'), /does not contain/);
  assert.throws(() => selectAsset({ ...release, assets: [{ ...asset, digest: null }] }, 'admin'), /metadata/);
  await assert.rejects(latestRelease(async () => new Response('', { status: 404 })), /No official release/);
});
test('verified download follows only GitHub asset hosts and commits only matching bytes', async () => {
  const dir = await temp(); let calls = 0;
  const target = await downloadAsset(asset, dir, { request: async () => ++calls === 1 ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/test' } }) : new Response(bytes) });
  assert.deepEqual(await fs.readFile(target), bytes);
  assert.equal(calls, 2);
  const other = await temp();
  await assert.rejects(downloadAsset(asset, other, { request: async () => new Response(Buffer.alloc(bytes.length)) }), /integrity/);
  assert.deepEqual(await fs.readdir(other), []);
});
test('external redirect, truncation, oversized data and cancellation fail without leaving binaries', async () => {
  for (const request of [
    async () => new Response(null, { status: 302, headers: { location: 'https://example.com/installer.exe' } }),
    async () => new Response('short'),
    async () => new Response(Buffer.alloc(bytes.length + 1)),
  ]) {
    const dir = await temp(); await assert.rejects(downloadAsset(asset, dir, { request })); assert.deepEqual(await fs.readdir(dir), []);
  }
  const controller = new AbortController(); controller.abort(); const dir = await temp();
  await assert.rejects(downloadAsset(asset, dir, { signal: controller.signal, request: async () => new Response(bytes) }));
  assert.deepEqual(await fs.readdir(dir), []);
});
test('web ZIP extraction rejects traversal, symlinks and unsupported names', async () => {
  const { safeEntry, extractWeb } = require('../web-distribution');
  const { ZipFile } = require('yazl');
  const { pipeline } = require('node:stream/promises');
  const { createWriteStream } = require('node:fs');
  for (const name of ['../bad', '/absolute', 'C:/bad', 'public/../../bad', 'public/con.txt', 'public/back\\slash', 'public/file.']) assert.equal(safeEntry(name), false, name);
  assert.equal(safeEntry('public/assets/logo.png'), true);
  const dir = await temp(), filename = path.join(dir, 'symlink.zip');
  const zip = new ZipFile(); zip.addBuffer(Buffer.from('target'), 'link', { mode: 0o120777 });
  const writing = pipeline(zip.outputStream, createWriteStream(filename)); zip.end(); await writing;
  await assert.rejects(extractWeb(filename, path.join(dir, 'out')), /Unsafe/);
});

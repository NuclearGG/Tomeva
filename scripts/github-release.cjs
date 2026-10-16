const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const credential = execFileSync('git', ['credential', 'fill'], { cwd: root, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const token = /^password=(.+)$/m.exec(credential)?.[1];
if (!token) throw new Error('GitHub credential unavailable');
const api = 'https://api.github.com/repos/NuclearGG/Tomeva';
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...options.headers } });
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}
async function main() {
  const mode = process.argv[2] || 'status';
  if (mode === 'status') {
    const repo = await request(api);
    const releases = await request(api + '/releases');
    console.log(JSON.stringify({ repository: repo.full_name, permissions: repo.permissions, releases: releases.map(r => ({ id: r.id, tag: r.tag_name, draft: r.draft, assets: r.assets.map(a => a.name) })) }));
    return;
  }
  const version = require('../package.json').version;
  require('./release-preflight.cjs').assertPublishable(root);
  execFileSync(process.execPath, [path.join(root, 'scripts/check-packages.cjs')], { cwd: root, stdio: 'pipe' });
  const tag = 'v' + version;
  const isReleaseAsset = name => [
    'admin.yml',
    'latest.yml',
    'librarian.yml',
    'admin-legacy.yml',
    'latest-legacy.yml',
    'librarian-legacy.yml',
    'SHA256SUMS',
    'SHA256SUMS.sig'
  ].includes(name)
    || name.includes(`-${version}-`) || name === `tomeva-student-${version}.zip`;
  const { verifyManifest, verifyFile } = require('../desktop-integration/release-verification.cjs');
  const trustedKeys = require('../desktop-integration/release-keys.cjs');
  if (trustedKeys.length) {
    const manifestPath = path.join(root, 'packages/SHA256SUMS');
    const entries = verifyManifest(fs.readFileSync(manifestPath), fs.readFileSync(manifestPath + '.sig'));
    for (const name of fs.readdirSync(path.join(root, 'packages')).filter(isReleaseAsset).filter(name => name !== 'SHA256SUMS' && name !== 'SHA256SUMS.sig')) await verifyFile(path.join(root, 'packages', name), name, entries);
  } else if (process.env.TOMEVA_REQUIRE_SIGNING === '1') throw new Error('Signed publication requires an existing trusted publisher key.');
  const releases = await request(api + '/releases');
  let release = releases.find(r => r.tag_name === tag);
  if (mode === 'upload') {
    if (!release) release = await request(api + '/releases', { method: 'POST', body: JSON.stringify({ tag_name: tag, target_commitish: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), name: `Tomeva ${version}`, draft: true, body: fs.readFileSync(path.join(root, 'documentation/RELEASE_NOTES.md'), 'utf8') }) });
    if (!release.draft) throw new Error('Refusing to replace a published release');
    const directory = path.join(root, 'packages');
    for (const name of fs.readdirSync(directory).filter(isReleaseAsset)) {
      const bytes = fs.readFileSync(path.join(directory, name));
      const digest = 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex');
      const existing = release.assets.find(a => a.name === name);
      if (existing) { if (existing.digest === digest) { console.log('Already uploaded: ' + name); continue; } throw new Error('Draft asset differs: ' + name); }
      const asset = await request(release.upload_url.replace(/\{.*$/, '') + '?name=' + encodeURIComponent(name), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
      if (asset.digest !== digest || asset.size !== bytes.length) throw new Error('Uploaded digest mismatch: ' + name);
      console.log('Uploaded and verified: ' + name);
    }
  } else if (mode === 'publish') {
    if (!release?.draft) throw new Error('Expected draft release');
    const directory = path.join(root, 'packages');
    for (const name of fs.readdirSync(directory).filter(isReleaseAsset)) {
      const bytes = fs.readFileSync(path.join(directory, name));
      const asset = release.assets.find(a => a.name === name);
      if (!asset || asset.digest !== 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex')) throw new Error('Release is incomplete: ' + name);
    }
    release = await request(api + '/releases/' + release.id, { method: 'PATCH', body: JSON.stringify({ draft: false, make_latest: 'true' }) });
    console.log('Published: ' + release.html_url);
  } else throw new Error('Unknown mode');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

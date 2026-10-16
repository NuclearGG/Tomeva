'use strict';
const fs = require('node:fs'); const path = require('node:path'); const { execFileSync } = require('node:child_process');
function assessRelease(value) {
  if (value.dirty) throw new Error('Release publication requires a clean working tree, including intended untracked source.');
  if (!value.versions.every(version => version === value.versions[0]) || !/^\d+\.\d+\.\d+$/.test(value.versions[0])) throw new Error('Application versions must match the stable release version.');
  if (value.tagCommit !== value.head) throw new Error('The local release tag must point to HEAD.');
  if (value.sbomCommit !== value.head) throw new Error('Generate the release SBOMs from this exact source commit.');
  if (value.sbomDirty) throw new Error('Release SBOMs must be generated from clean source.');
  if (value.requireSigning && !value.trustedKeys) throw new Error('Wide distribution requires an existing trusted publisher key. Unsigned pilot work may continue.');
  return true;
}
function assertPublishable(root = path.resolve(__dirname, '..')) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const folders = ['', 'Control Center', "Admin's End", "Librarian's End"];
  const versions = folders.map(folder => JSON.parse(fs.readFileSync(path.join(root, folder, 'package.json'))).version);
  const checkoutHead = git(['rev-parse', 'HEAD']);
  let tagCommit = ''; try { tagCommit = git(['rev-parse', `v${versions[0]}^{commit}`]); } catch {}
  // Release binaries/checksums may be committed after the tagged source. They
  // cannot change the source identity embedded in their SBOM archive.
  let head = checkoutHead;
  if (tagCommit && tagCommit !== checkoutHead) {
    git(['merge-base', '--is-ancestor', tagCommit, checkoutHead]);
    if (!git(['diff', '--name-only', tagCommit, checkoutHead, '--', '.', ':!packages/**'])) head = tagCommit;
  }
  let sbomCommit = '', sbomDirty = true;
  try {
    const provenance = JSON.parse(fs.readFileSync(path.join(root, 'release-artifacts/sbom/provenance.json')));
    sbomCommit = provenance.sourceCommit; sbomDirty = provenance.sourceDirty;
    for (const artifact of provenance.artifacts) {
      if (!/^[a-z-]+[.]cdx[.]json$/.test(artifact.filename)) throw new Error('Invalid SBOM filename.');
      if (require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root, 'release-artifacts/sbom', artifact.filename))).digest('hex') !== artifact.sha256) throw new Error('SBOM checksum mismatch.');
    }
  } catch { sbomCommit = ''; }
  assessRelease({ dirty: !!git(['status', '--porcelain', '--', '.', ':!packages/**']), versions, head, tagCommit, sbomCommit, sbomDirty, requireSigning: process.env.TOMEVA_REQUIRE_SIGNING === '1', trustedKeys: require('../desktop-integration/release-keys.cjs').length });
  const name = `tomeva-${versions[0]}-sbom.zip`;
  const checksum = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root, 'packages', name))).digest('hex');
  const receipt = JSON.parse(fs.readFileSync(path.join(root, 'release-artifacts/sbom-archive.json')));
  if (receipt.sourceCommit !== head || receipt.filename !== name || receipt.sha256 !== checksum) throw new Error('Regenerate the SBOM archive from this exact clean source commit.');
  if (!fs.readFileSync(path.join(root, 'packages/SHA256SUMS'), 'utf8').split(/\r?\n/).includes(`${checksum}  ${name}`)) throw new Error('Include the release SBOM archive in SHA256SUMS before publishing.');
  return true;
}
module.exports = { assessRelease, assertPublishable };
if (require.main === module) { assertPublishable(); console.log('Release source, versions, tag, SBOM and signing policy passed.'); }

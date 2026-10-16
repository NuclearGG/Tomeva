'use strict';
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto'); const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'release-artifacts/sbom'); fs.mkdirSync(directory, { recursive: true });
const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const artifacts = [];
const jobs = [['Control Center', 'control-center'], ["Admin's End", 'admin'], ["Librarian's End", 'librarian-and-web-sdk']];
const version = require('../package.json').version;
for (const [folder, name] of [...jobs]) {
  const legacy = path.join('.legacy-build', folder), filename = path.join(root, legacy, 'package.json');
  if (fs.existsSync(filename) && JSON.parse(fs.readFileSync(filename)).version === version && JSON.parse(fs.readFileSync(filename)).devDependencies.electron === '22.3.27') jobs.push([legacy, name + '-legacy']);
  else if (process.argv.includes('--release')) throw new Error('Build the matching legacy applications before generating the release SBOM archive.');
}
for (const [folder, name] of jobs) {
  const result = execFileSync(process.execPath, [npm, 'sbom', '--package-lock-only', '--sbom-format', 'cyclonedx'], { cwd: path.join(root, folder), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  const sbom = JSON.parse(result); if (sbom.bomFormat !== 'CycloneDX' || !Array.isArray(sbom.components)) throw new Error('Invalid generated SBOM.');
  const filename = name + '.cdx.json'; fs.writeFileSync(path.join(directory, filename), JSON.stringify(sbom, null, 2));
  const packages = sbom.components.map(component => ({ name: component.name, version: component.version, licenses: component.licenses || [] }));
  fs.writeFileSync(path.join(directory, name + '-licenses.json'), JSON.stringify(packages, null, 2));
  artifacts.push({ filename, components: packages.length, lockfile: path.join(folder, 'package-lock.json').replaceAll('\\', '/'), lockfileSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, folder, 'package-lock.json'))).digest('hex'), sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, filename))).digest('hex') });
}
const sourceDirty = !!execFileSync('git', ['status', '--porcelain', '--', '.', ':!packages/**'], { cwd: root, encoding: 'utf8' }).trim();
fs.writeFileSync(path.join(directory, 'provenance.json'), JSON.stringify({ generatedAt: new Date().toISOString(), sourceCommit, sourceDirty, includesDevelopmentDependencies: true, includesLegacyDependencies: jobs.length === 6, webSdkSource: "Librarian's End/package-lock.json", artifacts }, null, 2));
console.log(JSON.stringify({ directory, sourceCommit, artifacts }, null, 2));
if (process.argv.includes('--release')) {
  if (sourceDirty) throw new Error('Commit or resolve source changes before producing a release SBOM archive. Preview SBOMs were retained.');
  const { ZipFile } = require('../Control Center/node_modules/yazl');
  const zip = new ZipFile();
  zip.addFile(path.join(root, 'LICENSE'), 'TOMEVA-LICENSE.txt');
  zip.addFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'THIRD_PARTY_NOTICES.md');
  for (const name of fs.readdirSync(directory).filter(name => /(?:[.]cdx[.]json|-licenses[.]json|^provenance[.]json)$/.test(name))) zip.addFile(path.join(directory, name), name);
  const target = path.join(root, 'packages', `tomeva-${require('../package.json').version}-sbom.zip`);
  const output = fs.createWriteStream(target, { flags: 'wx' });
  output.on('error', error => { zip.outputStream.destroy(); console.error(error.message); process.exitCode = 1; });
  output.on('finish', () => {
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    fs.writeFileSync(path.join(root, 'release-artifacts/sbom-archive.json'), JSON.stringify({ sourceCommit, filename: path.basename(target), sha256 }, null, 2));
    console.log('Release SBOM archive: ' + target);
  });
  zip.outputStream.pipe(output); zip.end();
}

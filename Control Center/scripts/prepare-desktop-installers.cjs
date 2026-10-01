'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'desktop-installers');
fs.mkdirSync(target, { recursive: true });
const manifest = {};
const artifactNames = {
  // NSIS installer first (what setup-export bundles offline). Then the
  // portable exe electron-builder emits (`${productName} ${version}.exe`),
  // then the legacy `${name}-${version}-win-x64` publish artifact name.
  librarian: version => [
    `Tomeva Setup ${version}.exe`,
    `Tomeva ${version}.exe`,
    `tomeva-librarian-${version}-win-x64.exe`,
  ],
  admin: version => [
    `Tomeva Admin Setup ${version}.exe`,
    `Tomeva Admin ${version}.exe`,
    `tomeva-admin-${version}-win-x64.exe`,
  ],
};

for (const [key, folder] of [['librarian', "Librarian's End"], ['admin', "Admin's End"]]) {
  const appRoot = path.resolve(root, '..', folder);
  const { version } = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  const buildDir = path.join(appRoot, process.env.TOMEVA_DESKTOP_BUILD_DIR || 'dist');
  const candidates = artifactNames[key](version).map(name => path.join(buildDir, name));
  const source = candidates.find(candidate => fs.existsSync(candidate));
  if (!source) {
    throw new Error(
      `Build the Windows NSIS installer in ${folder} first. Checked in ${buildDir}: ${artifactNames[key](version).join(', ')}`,
    );
  }
  const filename = `${key}-setup-${version}.exe`;
  // Remove stale outputs from previous versions so electron-builder's
  // `desktop-installers/*.exe` extraResources filter never bundles orphans.
  for (const stale of fs.readdirSync(target)) {
    if (stale.startsWith(`${key}-setup-`) && stale.endsWith('.exe') && stale !== filename) {
      fs.rmSync(path.join(target, stale));
    }
  }
  fs.copyFileSync(source, path.join(target, filename));
  console.log(`Bundled ${key} ${version}: ${path.basename(source)} -> ${filename}`);
  manifest[key] = { filename, version };
}
fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Prepared Librarian and Admin installers for setup exports.');

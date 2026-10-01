'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'desktop-installers');
fs.mkdirSync(target, { recursive: true });
const manifest = {};
for (const [key, folder, product] of [['librarian', "Librarian's End", 'Tomeva'], ['admin', "Admin's End", 'Tomeva Admin']]) {
  const appRoot = path.resolve(root, '..', folder);
  const { version } = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  const name = `${product} Setup ${version}.exe`;
  const source = path.join(appRoot, process.env.TOMEVA_DESKTOP_BUILD_DIR || 'dist', name);
  if (!fs.existsSync(source)) throw new Error(`Build the Windows NSIS installer in ${folder} first. Missing ${name}`);
  const filename = `${key}-setup-${version}.exe`;
  fs.copyFileSync(source, path.join(target, filename));
  manifest[key] = { filename, version };
}
fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Prepared Librarian and Admin installers for setup exports.');

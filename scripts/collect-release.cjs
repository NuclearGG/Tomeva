'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const apps = [['control-center', 'Control Center'], ['admin', "Admin's End"], ['librarian', "Librarian's End"]];
const platform = process.argv[2];
if (!['win', 'linux'].includes(platform)) throw new Error('Usage: node scripts/collect-release.cjs win|linux');
const target = path.join(root, 'packages');
fs.mkdirSync(target, { recursive: true });
const version = require('../Control Center/package.json').version;
for (const [component, folder] of apps) {
  if (require(path.join(root, folder, 'package.json')).version !== version) throw new Error('All application versions must match.');
  const filename = `tomeva-${component}-${version}-${platform}-x64.${platform === 'win' ? 'exe' : 'AppImage'}`;
  const source = path.join(root, folder, 'dist', 'release');
  fs.copyFileSync(path.join(source, filename), path.join(target, filename));
  if (platform === 'win') fs.copyFileSync(path.join(source, filename + '.blockmap'), path.join(target, filename + '.blockmap'));
  const suffix = platform === 'win' ? '' : '-linux';
  const metadata = fs.readFileSync(path.join(source, `latest${suffix}.yml`), 'utf8');
  if (!metadata.includes(filename)) throw new Error(`Update metadata does not reference ${filename}`);
  const bytes = fs.readFileSync(path.join(target, filename));
  const digest = crypto.createHash('sha512').update(bytes).digest('base64');
  if (!metadata.includes(digest)) throw new Error(`Update hash mismatch for ${filename}`);
  fs.writeFileSync(path.join(target, `${component === 'control-center' ? 'latest' : component}${suffix}.yml`), metadata);
  console.log(`Collected and verified ${filename}`);
}

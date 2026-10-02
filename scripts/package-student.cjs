'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const requireCC = createRequire(path.join(root, 'Control Center/package.json'));

async function packageStudent(directory = path.join(root, 'packages')) {
  const { ZipFile } = requireCC('yazl');
  const version = require('../Control Center/package.json').version;
  fs.mkdirSync(directory, { recursive: true });
  const output = path.join(directory, `tomeva-student-${version}.zip`);
  const zip = new ZipFile();
  function add(source, destination) {
    const full = path.join(root, source);
    if (fs.statSync(full).isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) add(path.join(source, name), `${destination}/${name}`);
    } else zip.addFile(full, destination, { mtime: new Date('2026-01-01T00:00:00Z') });
  }
  add('Student Search/search.html', 'public/index.html');
  add('Student Search/search.html', 'public/search.html');
  add('Student Search/tomeva-config.js', 'public/tomeva-config.js');
  add('Student Search/assets', 'public/assets');
  add("Admin's End/auth-hosting/public/admin-sign-in", 'public/admin-sign-in');
  for (const name of ['firestore.rules', 'firestore.indexes.json']) add(`Librarian's End/${name}`, name);
  zip.addBuffer(Buffer.from(JSON.stringify({ schemaVersion: 1, version }, null, 2)), 'tomeva-package.json');
  const done = pipeline(zip.outputStream, fs.createWriteStream(output));
  zip.end();
  await done;
  return output;
}
module.exports = { packageStudent };
if (require.main === module) packageStudent(process.argv[2]).then(console.log).catch(error => { console.error(error); process.exitCode = 1; });

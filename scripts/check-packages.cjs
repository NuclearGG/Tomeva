'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = path.resolve(__dirname, '../packages');
const manifestPath = path.join(directory, 'SHA256SUMS');
if (process.argv.includes('--write')) {
  const lines = fs.readdirSync(directory).filter(name => /\.(exe|blockmap|AppImage|zip|yml)$/.test(name)).sort().map(name =>
    `${crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex')}  ${name}`);
  if (!lines.length) throw new Error('No packages found');
  fs.writeFileSync(manifestPath, lines.join('\n') + '\n');
}
for (const line of fs.readFileSync(manifestPath, 'utf8').trim().split(/\r?\n/)) {
  const match = /^([a-f0-9]{64})  ([a-zA-Z0-9._-]+)$/.exec(line);
  if (!match) throw new Error('Invalid checksum entry');
  const [, expected, name] = match;
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex');
  if (actual !== expected) throw new Error(`Checksum mismatch: ${name}. Run git lfs pull if this is a fresh clone.`);
  console.log(`Verified ${name}`);
}

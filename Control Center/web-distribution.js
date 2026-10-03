'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const yauzl = require('yauzl');
const { downloadPackage } = require('./github-distribution');
function safeEntry(name) {
  if (typeof name !== 'string' || name.includes('\\') || name.startsWith('/') || name.length > 240) return false;
  return name.replace(/\/$/, '').split('/').every(part => part && part !== '.' && part !== '..' && !/[<>:"|?*\x00-\x1f]/.test(part) && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part));
}
async function extractWeb(filename, target, signal) {
  const zip = await new Promise((resolve, reject) => yauzl.open(filename, { lazyEntries: true, strictFileNames: true }, (error, value) => error ? reject(error) : resolve(value)));
  let size = 0, count = 0;
  const seen = new Set();
  await new Promise((resolve, reject) => {
    const fail = error => { zip.close(); reject(error); };
    zip.on('error', fail);
    zip.on('end', resolve);
    zip.on('entry', async entry => {
      try {
        signal?.throwIfAborted();
        const name = entry.fileName;
        const kind = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (!safeEntry(name) || ![0, 0x4000, 0x8000].includes(kind) || seen.has(name.toLowerCase()) || ++count > 10000 || (size += entry.uncompressedSize) > 150 * 1024 ** 2) throw new Error('Unsafe or oversized Student Portal archive.');
        seen.add(name.toLowerCase());
        const dest = path.resolve(target, name);
        if (!dest.startsWith(path.resolve(target) + path.sep)) throw new Error('Archive path escaped its destination.');
        if (name.endsWith('/')) await fs.mkdir(dest, { recursive: true });
        else {
          await fs.mkdir(path.dirname(dest), { recursive: true });
          const stream = await new Promise((res, rej) => zip.openReadStream(entry, (error, value) => error ? rej(error) : res(value)));
          let written = 0;
          const bound = new Transform({ transform(chunk, _, next) { written += chunk.length; next(written > entry.uncompressedSize ? new Error('Archive size mismatch.') : null, chunk); } });
          await pipeline(stream, bound, createWriteStream(dest, { flags: 'wx' }), { signal });
        }
        zip.readEntry();
      } catch (error) { fail(error); }
    });
    zip.readEntry();
  });
}
async function prepareWeb(directory, config, options = {}) {
  const result = await downloadPackage('student', 'win', 'x64', directory, options);
  try { await extractWeb(result.filename, directory, options.signal); }
  finally { await fs.rm(result.filename, { force: true }); }
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'tomeva-package.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.version !== result.version) throw new Error('Student package needs a compatible Control Center version.');
  for (const name of ['public/index.html', 'public/admin-sign-in/index.html', 'firestore.rules', 'firestore.indexes.json']) await fs.access(path.join(directory, name));
  await fs.writeFile(path.join(directory, 'public', 'tomeva-config.js'), 'globalThis.TOMEVA_WEB_CONFIG = ' + JSON.stringify({ ...config, version: result.version }).replace(/</g, '\\u003c') + ';\n');
  const publicConfig = {
    schemaVersion: 1,
    institutionName: config.institutionName || '',
    firebase: config.firebase,
    staffDomain: config.staffDomain,
    webUrl: config.webUrl || `https://${config.firebase.projectId}.web.app/`,
    libraryId: 'main',
  };
  await fs.writeFile(path.join(directory, 'public', 'tomeva-institution.json'), JSON.stringify(publicConfig, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'public', 'tomeva-version.json'), JSON.stringify({ version: result.version, projectId: config.firebase.projectId }));
  await fs.writeFile(path.join(directory, 'firebase.json'), JSON.stringify({ hosting: { public: 'public', ignore: ['**/.*', '**/node_modules/**'] }, firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' } }, null, 2));
  return result.version;
}
module.exports = { safeEntry, extractWeb, prepareWeb };

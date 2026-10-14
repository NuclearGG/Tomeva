'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const local = createRequire(path.join(root, 'Control Center/package.json'));
const asar = local('@electron/asar');
const yauzl = local('yauzl');
const version = require('../package.json').version;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const apps = [
  ['Control Center', ['main.js','preload.js','config-store.js','ui/index.html','ui/styles.css','ui/renderer.js','firebase-template/firestore.rules']],
  ["Admin's End", ['main.js','preload.js','oauth-flow.js','index.html','app.bundle.js']],
  ["Librarian's End", ['main.js','preload.js','index.html','js/app.js','js/firebase-sync.js','js/dialogs.js','main/db-ipc.js','main/library-service.js','main/calendar.js','main/backup.js']],
];
function files(directory, prefix = '') {
  return fs.readdirSync(directory, {withFileTypes:true}).flatMap(item => item.isDirectory()
    ? files(path.join(directory,item.name),prefix+item.name+'/') : [prefix+item.name]);
}
let checked = 0;
function compare(actual, filename, label) {
  assert.equal(digest(actual),digest(fs.readFileSync(filename)),label);
  checked++;
}
const interfaceFiles = files(path.join(root,'desktop-integration/interface'));
for (const variant of ['release','release-legacy']) {
  const source = variant === 'release' ? root : path.join(root,'.legacy-build');
  for (const [folder, core] of apps) {
    const archive = path.join(root,folder,'dist',variant,'win-unpacked/resources/app.asar');
    const read = filename => asar.extractFile(archive,path.normalize(filename));
    assert.equal(JSON.parse(read('package.json')).version,version,folder+' '+variant+' version');
    assert.equal(JSON.parse(read('build-variant.json')).legacyWindows,variant === 'release-legacy');
    for (const filename of core) compare(read(filename),path.join(source,folder,filename),folder+' '+variant+' '+filename);
    for (const filename of interfaceFiles) compare(read('assets/interface/'+filename),path.join(root,'desktop-integration/interface',filename),folder+' '+variant+' interface/'+filename);
    compare(read('integration/oauth-flow.cjs'),path.join(root,'desktop-integration/oauth-flow.cjs'),folder+' '+variant+' shared sign-in');
    console.log('Verified packaged source, version and interface: '+folder+' '+variant);
  }
}
const wanted = new Map([
  ['public/index.html',path.join(root,'Student Search/search.html')],
  ['public/app.bundle.js',path.join(root,'Student Search/app.bundle.js')],
  ['firestore.rules',path.join(root,"Librarian's End/firestore.rules")],
  ...interfaceFiles.map(filename => ['public/assets/interface/'+filename,path.join(root,'desktop-integration/interface',filename)]),
]);
const zipPath = path.join(root,'packages',`tomeva-student-${version}.zip`);
let studentMetadata = false;
new Promise((resolve,reject) => yauzl.open(zipPath,{lazyEntries:true},(error,zip) => {
  if (error) return reject(error);
  zip.on('error',reject); zip.on('end',resolve);
  zip.on('entry',entry => {
    if (!wanted.has(entry.fileName) && entry.fileName !== 'tomeva-package.json') { zip.readEntry(); return; }
    zip.openReadStream(entry,(error,stream) => {
      if (error) return reject(error);
      const chunks=[]; stream.on('error',reject); stream.on('data',bytes=>chunks.push(bytes));
      stream.on('end',()=>{
        try {
          const bytes=Buffer.concat(chunks);
          if (entry.fileName === 'tomeva-package.json') { assert.equal(JSON.parse(bytes).version,version); studentMetadata = true; checked++; }
          else { compare(bytes,wanted.get(entry.fileName),'Student ZIP '+entry.fileName); wanted.delete(entry.fileName); }
          zip.readEntry();
        } catch (error) { zip.close(); reject(error); }
      });
    });
  });
  zip.readEntry();
})).then(()=>{
  assert.equal(wanted.size,0,'Missing Student ZIP assets');
  assert.equal(studentMetadata,true,'Missing Student ZIP version metadata');
  console.log(`PASS: ${checked} packaged source/asset comparisons, six desktop versions and Student metadata.`);
}).catch(error=>{ console.error(error); process.exitCode=1; });

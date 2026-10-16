// Requires the Firebase Auth emulator on 127.0.0.1:9099. Uses demo projects only.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const esbuild = require('esbuild');
const directory = fs.mkdtempSync(path.join(os.tmpdir(),'tomeva-session-test-'));
const bundle = path.join(directory,'session.js');
esbuild.buildSync({
  entryPoints:[path.join(__dirname,'fixtures/session-page.js')],outfile:bundle,
  bundle:true,platform:'browser',format:'iife',target:'chrome108',
  nodePaths:[path.resolve(__dirname,"../../Librarian's End/node_modules")],
});
const html = path.join(directory,'session.html');
fs.writeFileSync(html,'<!doctype html><meta charset="utf-8"><title>Isolated session test</title><script src="session.js"></script>');
for (const phase of [1,2,3]) {
  const result = spawnSync(process.env.TOMEVA_SESSION_ELECTRON || require('electron'),[path.join(__dirname,'session-worker.cjs')],{
    stdio:'inherit',env:{...process.env,TOMEVA_SESSION_PHASE:String(phase),TOMEVA_SESSION_PROFILE:path.join(directory,'profile'),TOMEVA_SESSION_HTML:html,TOMEVA_SESSION_RESULT:path.join(directory,'result.json')},
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('PASS: persistent Firebase sessions verified across three Electron processes.');

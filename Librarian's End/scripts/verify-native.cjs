// better-sqlite3 13 ships Node-API binaries; rebuilding them requires no ABI benefit.
// Exercise the bundled binary in the actual Electron runtime on every install.
const { spawnSync } = require('node:child_process');
const result = spawnSync(require('electron'), ['-e', "const D=require('better-sqlite3');const d=new D(':memory:');d.prepare('SELECT 1').get();d.close();"], {
  cwd: require('node:path').join(__dirname, '..'),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);

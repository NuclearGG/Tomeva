const { spawnSync } = require('node:child_process');
const result = spawnSync(require('electron'), ['--test', 'test/sqlite.test.cjs'], {
  cwd: require('node:path').join(__dirname, '..'),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);

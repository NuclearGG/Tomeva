'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const apps = ['Control Center', "Admin's End", "Librarian's End"];
const action = process.argv[2];
const jobs = {
  install: apps.map(folder => [folder, ['ci']]),
  test: [['Control Center', ['test']], ["Admin's End", ['run', 'test:oauth']], ["Admin's End", ['run', 'test:staff']], ["Admin's End", ['run', 'test:roster']], ["Librarian's End", ['run', 'test:sqlite']], ["Librarian's End", ['run', 'test:kiosk']], ["Librarian's End", ['run', 'test:sync']]],
  desktop: apps.map(folder => [folder, ['run', 'test:desktop']]),
  win: apps.map(folder => [folder, ['run', 'build:win', '--', '--publish', 'never']]),
  linux: apps.map(folder => [folder, ['run', 'build:linux', '--', '--publish', 'never']]),
}[action];
if (!jobs) throw new Error('Unknown project command');
for (const [folder, args] of jobs) {
  console.log(`\n${folder}: npm ${args.join(' ')}`);
  const npmCli = process.env.npm_execpath || (process.platform === 'win32' ? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js') : null);
  const result = spawnSync(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, ...args] : args, { cwd: path.join(root, folder), stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

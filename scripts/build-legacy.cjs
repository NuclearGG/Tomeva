'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const stage = path.join(root, '.legacy-build');
const apps = [
  ['Control Center', 'tomeva-control-center'],
  ["Admin's End", 'tomeva-admin'],
  ["Librarian's End", 'tomeva-librarian'],
];

if (path.dirname(stage) !== root) throw new Error('Unsafe legacy staging path.');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

const copyFilter = source => !['node_modules', 'dist', '.legacy-build'].includes(path.basename(source));
for (const [folder] of apps) {
  fs.cpSync(path.join(root, folder), path.join(stage, folder), { recursive: true, filter: copyFilter });
}
fs.cpSync(path.join(root, 'desktop-integration'), path.join(stage, 'desktop-integration'), { recursive: true });

function run(folder, command, args) {
  const result = spawnSync(command, args, { cwd: path.join(stage, folder), stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

for (const [folder] of apps) {
  const appRoot = path.join(stage, folder);
  const packageFile = path.join(appRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  pkg.devDependencies.electron = '22.3.27';
  if (folder === "Librarian's End") pkg.dependencies['better-sqlite3'] = '11.10.0';
  fs.writeFileSync(packageFile, JSON.stringify(pkg, null, 2) + '\n');
  fs.writeFileSync(path.join(appRoot, 'build-variant.json'), JSON.stringify({ legacyWindows: true }) + '\n');
  run(folder, 'npm', ['install', '--no-audit', '--no-fund']);
}

// better-sqlite3's installer cannot compile from a path containing an apostrophe
// and space on Windows. Build the Node-API binary in a neutral staging path; the
// resulting v11 binary is compatible with Electron 22's Node-API runtime.
const nativeRoot = path.join(stage, 'legacy-native');
fs.mkdirSync(nativeRoot, { recursive: true });
fs.writeFileSync(path.join(nativeRoot, 'package.json'), JSON.stringify({ private: true, dependencies: { 'better-sqlite3': '11.10.0' } }, null, 2));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run the legacy builder through npm.');
const nativeInstall = spawnSync(process.execPath, [npmCli, 'install', '--no-audit', '--no-fund'], { cwd: nativeRoot, stdio: 'inherit' });
if (nativeInstall.error) throw nativeInstall.error;
if (nativeInstall.status !== 0) process.exit(nativeInstall.status || 1);
const nativeRebuild = spawnSync(process.execPath, [npmCli, 'rebuild', 'better-sqlite3'], {
  cwd: nativeRoot,
  stdio: 'inherit',
  env: { ...process.env, npm_config_runtime: 'electron', npm_config_target: '22.3.27', npm_config_disturl: 'https://electronjs.org/headers', npm_config_build_from_source: 'true' },
});
if (nativeRebuild.error) throw nativeRebuild.error;
if (nativeRebuild.status !== 0) process.exit(nativeRebuild.status || 1);
const nativeBinary = path.join(nativeRoot, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
if (!fs.existsSync(nativeBinary)) throw new Error('Legacy SQLite native binary was not built.');
const stagedNative = path.join(stage, "Librarian's End", 'node_modules', 'better-sqlite3', 'build', 'Release');
fs.mkdirSync(stagedNative, { recursive: true });
fs.copyFileSync(nativeBinary, path.join(stagedNative, 'better_sqlite3.node'));

run('Control Center', 'npm', ['run', 'build:ui']);
run('Control Center', 'node', ['scripts/prepare-rules.cjs']);
run('Control Center', 'node', ['scripts/prepare-release-channels.cjs']);
for (const [folder] of apps) {
  run(folder, 'npx', ['--no-install', 'electron-builder', '--config', 'electron-builder.legacy.config.cjs', '--win', '--x64', '--publish', 'never']);
  const output = path.join(root, folder, 'dist', 'release-legacy');
  fs.rmSync(output, { recursive: true, force: true });
  fs.cpSync(path.join(stage, folder, 'dist', 'release-legacy'), output, { recursive: true });
}

console.log(`Legacy Windows builds completed in ${stage}`);

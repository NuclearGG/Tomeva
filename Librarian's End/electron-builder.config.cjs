const build = require('./package.json').build;
const owner = 'NuclearGG';
const repo = 'Tomeva';
const fs = require('node:fs');
const path = require('node:path');
// Stage shared code inside the app root so ASAR native-unpack filters stay valid.
const integration = path.join(__dirname, 'integration');
fs.mkdirSync(integration, { recursive: true });
for (const name of fs.readdirSync(path.resolve(__dirname, '../desktop-integration'))) {
  if (name.endsWith('.cjs')) fs.copyFileSync(path.resolve(__dirname, '../desktop-integration', name), path.join(integration, name));
}
module.exports = {
  ...build, directories: { output: 'dist/release' },
  win: { ...build.win, target: [{ target: 'nsis', arch: ['x64'] }] },
  files: [...build.files.filter(item => typeof item === 'string'), 'integration/*.cjs'],
  nsis: { ...build.nsis, include: require('node:path').resolve(__dirname, '../desktop-integration/institution-installer.nsh') },
  linux: { ...build.linux, target: ['AppImage'] },
  ...(owner && repo ? { publish: [{ provider: 'github', owner, repo }] } : {}),
};

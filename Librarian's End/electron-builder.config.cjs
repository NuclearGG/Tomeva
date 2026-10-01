const build = require('./package.json').build;
const owner = process.env.TOMEVA_RELEASE_OWNER;
const repo = process.env.TOMEVA_LIBRARIAN_RELEASE_REPO;
const fs = require('node:fs');
const path = require('node:path');
// Stage shared code inside the app root so ASAR native-unpack filters stay valid.
const integration = path.join(__dirname, 'integration');
fs.mkdirSync(integration, { recursive: true });
for (const name of fs.readdirSync(path.resolve(__dirname, '../desktop-integration'))) {
  if (name.endsWith('.cjs')) fs.copyFileSync(path.resolve(__dirname, '../desktop-integration', name), path.join(integration, name));
}
module.exports = {
  ...build,
  files: [...build.files.filter(item => typeof item === 'string'), 'integration/*.cjs'],
  nsis: { ...build.nsis, include: require('node:path').resolve(__dirname, '../desktop-integration/institution-installer.nsh') },
  linux: { ...build.linux, target: ['AppImage'] },
  ...(owner && repo ? { publish: [{ provider: 'github', owner, repo }] } : {}),
};

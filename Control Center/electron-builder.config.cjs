const pkg = require('./package.json');
const owner = process.env.TOMEVA_RELEASE_OWNER;
const repo = process.env.TOMEVA_RELEASE_REPO;
const fs = require('node:fs');
const path = require('node:path');
module.exports = {
  ...pkg.build,
  ...(fs.existsSync(path.join(__dirname, 'desktop-installers', 'manifest.json')) ? { extraResources: [{ from: 'desktop-installers', to: 'desktop-installers', filter: ['*.exe', 'manifest.json'] }] } : {}),
  ...(owner && repo ? { publish: [{ provider: 'github', owner, repo, releaseType: 'release' }] } : {}),
};

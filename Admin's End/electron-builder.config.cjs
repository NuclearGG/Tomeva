require('node:fs').writeFileSync(require('node:path').join(__dirname, 'public-releases.json'), JSON.stringify({ owner: process.env.TOMEVA_RELEASE_OWNER || '', librarian: process.env.TOMEVA_LIBRARIAN_RELEASE_REPO || '', admin: process.env.TOMEVA_ADMIN_RELEASE_REPO || '' }));
const build = require('./package.json').build;
const owner = process.env.TOMEVA_RELEASE_OWNER;
const repo = process.env.TOMEVA_ADMIN_RELEASE_REPO;
module.exports = { ...build, nsis: { ...build.nsis, include: require('node:path').resolve(__dirname, '../desktop-integration/institution-installer.nsh') }, ...(owner && repo ? { publish: [{ provider: 'github', owner, repo }] } : {}) };

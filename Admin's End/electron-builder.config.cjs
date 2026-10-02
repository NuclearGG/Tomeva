require('node:fs').writeFileSync(require('node:path').join(__dirname, 'public-releases.json'), JSON.stringify({ owner: 'NuclearGG' || '', librarian: 'Tomeva' || '', admin: 'Tomeva' || '' }));
const build = require('./package.json').build;
const owner = 'NuclearGG';
const repo = 'Tomeva';
module.exports = { ...build, directories: { output: 'dist/release' }, nsis: { ...build.nsis, include: require('node:path').resolve(__dirname, '../desktop-integration/institution-installer.nsh') }, ...(owner && repo ? { publish: [{ provider: 'github', owner, repo }] } : {}) };

const pkg = require('./package.json');
const build = require('../desktop-integration/build-signing.cjs').configureSigning(pkg.build);
module.exports = { ...build, directories: { output: 'dist/release' }, publish: [{ provider: 'github', owner: 'NuclearGG', repo: 'Tomeva', releaseType: 'release' }] };

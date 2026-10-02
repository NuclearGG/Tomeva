const pkg = require('./package.json');
module.exports = { ...pkg.build, directories: { output: 'dist/release' }, publish: [{ provider: 'github', owner: 'NuclearGG', repo: 'Tomeva', releaseType: 'release' }] };

const config = require('./electron-builder.config.cjs');

module.exports = {
  ...config,
  electronVersion: '22.3.27',
  directories: { output: 'dist/release-legacy' },
  artifactName: 'tomeva-control-center-${version}-win7-${arch}.${ext}',
};

const config = require('./electron-builder.config.cjs');

module.exports = {
  ...config,
  electronVersion: '22.3.27',
  npmRebuild: false,
  directories: { output: 'dist/release-legacy' },
  asarUnpack: ['node_modules/better-sqlite3/build/Release/*.node'],
  artifactName: 'tomeva-librarian-${version}-win7-${arch}.${ext}',
};

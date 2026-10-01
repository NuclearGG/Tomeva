const esbuild = require('esbuild');
esbuild.buildSync({
  entryPoints: ['src/renderer.js'], bundle: true, outfile: 'ui/renderer.js',
  platform: 'browser', format: 'iife', target: ['chrome130'], minify: false,
});

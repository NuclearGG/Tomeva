const esbuild = require('esbuild');
const prepare = require('node:path').resolve(__dirname, '../../scripts/prepare-interface.cjs');
// Legacy staging already receives prepared assets from the root builder.
if (require('node:fs').existsSync(prepare)) require(prepare).prepareInterface();
const result = esbuild.buildSync({
  entryPoints: ['src/renderer.js'], bundle: true, outfile: 'ui/renderer.js',
  platform: 'browser', format: 'iife', target: [require('../build-variant.json').legacyWindows ? 'chrome108' : 'chrome130'], minify: true,
  nodePaths: [require('node:path').resolve(__dirname, "../../Librarian's End/node_modules")],
  supported: { 'template-literal': false },
  write: false,
});
// Some SDK license comments contain whitespace-only lines. Keep the notices,
// while producing a clean generated file. Templates above use quoted strings.
require('node:fs').writeFileSync('ui/renderer.js', result.outputFiles[0].text.replace(/[ \t]+$/gm, ''));

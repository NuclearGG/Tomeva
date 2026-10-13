'use strict';
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const builder = createRequire(path.join(root, 'Control Center/package.json'))('esbuild');
async function prepareClients() {
  for (const [folder, name] of [["Admin's End", 'app.mjs'], ['Student Search', 'portal.mjs']]) {
    await builder.build({ entryPoints: [path.join(root, folder, name)], outfile: path.join(root, folder, 'app.bundle.js'),
      bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
      nodePaths: [path.join(root, "Librarian's End/node_modules")], legalComments: 'eof' });
  }
}
module.exports = { prepareClients };
if (require.main === module) prepareClients().catch(error => { console.error(error); process.exitCode = 1; });

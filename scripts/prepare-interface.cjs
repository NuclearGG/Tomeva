'use strict';
const fs = require('node:fs');
const path = require('node:path');
function prepareInterface() {
  const root = path.resolve(__dirname, '..');
  for (const app of ["Librarian's End", "Admin's End", 'Control Center', 'Student Search'])
    fs.cpSync(path.join(root, 'desktop-integration/interface'), path.join(root, app, 'assets/interface'), { recursive: true });
}
module.exports = { prepareInterface };
if (require.main === module) prepareInterface();

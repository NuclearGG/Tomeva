const fs = require('node:fs');
const path = require('node:path');
fs.writeFileSync(path.join(__dirname, '..', 'public-releases.json'), JSON.stringify({ owner: 'NuclearGG', librarian: 'Tomeva', admin: 'Tomeva', student: 'Tomeva' }, null, 2));

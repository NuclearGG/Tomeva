'use strict';
const fs = require('node:fs');
const path = require('node:path');
const channels = {
  owner: process.env.TOMEVA_RELEASE_OWNER || '',
  librarian: process.env.TOMEVA_LIBRARIAN_RELEASE_REPO || '',
  admin: process.env.TOMEVA_ADMIN_RELEASE_REPO || '',
};
fs.writeFileSync(path.join(__dirname, '..', 'public-releases.json'), JSON.stringify(channels, null, 2) + '\n');

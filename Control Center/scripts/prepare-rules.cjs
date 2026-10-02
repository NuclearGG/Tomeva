const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'firebase-template'), { recursive: true });
for (const name of ['firestore.rules', 'firestore.indexes.json']) fs.copyFileSync(path.join(root, '..', "Librarian's End", name), path.join(root, 'firebase-template', name));

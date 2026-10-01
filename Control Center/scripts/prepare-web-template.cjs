const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.resolve(root, '..', 'Student Search');
const target = path.join(root, 'web-template');
const helper = path.resolve(root, '..', "Admin's End", 'auth-hosting', 'public', 'admin-sign-in');
fs.cpSync(helper, path.join(root, 'auth-helper'), { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const name of ['search.html']) {
  fs.copyFileSync(path.join(source, name), path.join(target, name));
}
fs.cpSync(path.join(source, 'assets'), path.join(target, 'assets'), { recursive: true, force: true });
console.log('Prepared Tomeva Web template.');
const firebaseSource = path.resolve(root, '..', "Librarian's End");
const firebaseTarget = path.join(root, 'firebase-template');
fs.mkdirSync(firebaseTarget, { recursive: true });
for (const name of ['firestore.rules', 'firestore.indexes.json']) {
  fs.copyFileSync(path.join(firebaseSource, name), path.join(firebaseTarget, name));
}

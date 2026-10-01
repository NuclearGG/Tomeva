'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, dialog } = require('electron');
const { validateConfig } = require('./config-store');
const { VERSION } = require('./web-helper');

function publicWebConfig(config) {
  return {
    version: VERSION, libraryId: config.libraryId,
    firebase: config.firebase, staffDomain: config.staffDomain,
  };
}

function institutionRules(source, staffDomain) {
  const oldDomain = 'staff\\\\.example';
  if (!source.includes(oldDomain)) throw new Error('Firestore rules template is not compatible with this exporter.');
  const escaped = staffDomain.replace(/\./g, '\\\\.');
  return source.replaceAll(oldDomain, escaped).replaceAll('staff.example', staffDomain)
    .replace("libraryId == 'main'\n        && request.auth.token.firebase.sign_in_provider == 'google.com'",
      "libraryId == 'main'\n        && isStaff()");
}

async function exportSetupBundle(window, rawConfig, component = 'all') {
  if (!['all', 'librarian', 'admin'].includes(component)) throw new Error('Unknown package.');
  const config = validateConfig(rawConfig);
  const selection = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'], title: 'Choose a setup bundle folder' });
  if (selection.canceled) return { cancelled: true };
  const target = path.join(selection.filePaths[0], `Tomeva-setup-${config.firebase.projectId}-${Date.now()}`);
  const webSource = app.isPackaged ? path.join(__dirname, 'web-template') : path.join(__dirname, '..', 'Student Search');
  const firebaseSource = app.isPackaged ? path.join(__dirname, 'firebase-template') : path.join(__dirname, '..', "Librarian's End");
  const publicDir = path.join(target, 'public');
  const installerRoot = app.isPackaged ? path.join(process.resourcesPath, 'desktop-installers') : path.join(__dirname, 'desktop-installers');
  let installers = {};
  try { installers = JSON.parse(await fs.readFile(path.join(installerRoot, 'manifest.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(path.join(target, 'institution.json'), JSON.stringify(config, null, 2) + '\n');
  for (const [folder, product, next] of [
    ['Librarian-Setup', 'Tomeva Librarian', 'Activate a kiosk credential issued in Admin’s End under Settings → Kiosk Approval Credentials. The first sync creates the library catalogue documents.'],
    ['Admin-Setup', 'Tomeva Admin', 'After deploying the student web folder and its Admin sign-in helper, sign in with a verified staff account. Use Kiosk Provisioning to issue workstation credentials and Student Access to authorize students.'],
  ]) {
    if (component !== 'all' && component !== (folder === 'Librarian-Setup' ? 'librarian' : 'admin')) continue;
    const directory = path.join(target, folder);
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'institution.json'), JSON.stringify(config, null, 2) + '\n');
    const installer = installers[folder === 'Librarian-Setup' ? 'librarian' : 'admin'];
    if (installer?.filename) {
      if (path.basename(installer.filename) !== installer.filename) throw new Error('Invalid installer manifest.');
      await fs.copyFile(path.join(installerRoot, installer.filename), path.join(directory, installer.filename));
    }
    const installStep = installer?.filename ? `Keep ${installer.filename} and institution.json together. Run the installer from this folder on the destination computer. A fresh installation picks up this configuration automatically.` : `This development export contains configuration only. Obtain the ${product} installer and keep institution.json beside it before running it.`;
    await fs.writeFile(path.join(directory, 'SETUP.md'), `# ${product} setup\n\nProject: ${config.firebase.projectId}\n\n1. ${installStep}\n2. Existing installations preserve their saved configuration. To change it, choose Import institution setup in the File (Librarian) or Setup (Admin) menu and select this folder's institution.json.\n3. ${next}\n\nCopy this entire folder to the destination computer. Control Center itself requires no sign-in.\n`);
  }
  if (component !== 'all') return { path: target, installersIncluded: !!installers[component]?.filename,
    installerPath: installers[component]?.filename ? path.join(target, component === 'librarian' ? 'Librarian-Setup' : 'Admin-Setup', installers[component].filename) : null };
  await fs.copyFile(path.join(webSource, 'search.html'), path.join(publicDir, 'search.html'));
  await fs.copyFile(path.join(webSource, 'search.html'), path.join(publicDir, 'index.html'));
  await fs.cp(path.join(webSource, 'assets'), path.join(publicDir, 'assets'), { recursive: true });
  const adminHelper = path.join(publicDir, 'admin-sign-in');
  await fs.mkdir(adminHelper);
  const helperSource = app.isPackaged ? path.join(__dirname, 'auth-helper') : path.join(__dirname, '..', "Admin's End", 'auth-hosting', 'public', 'admin-sign-in');
  for (const name of ['index.html', 'login.css', 'login.js']) {
    const text = await fs.readFile(path.join(helperSource, name), 'utf8');
    await fs.writeFile(path.join(adminHelper, name), text.replaceAll('51735', '51734').replaceAll('Control Center', 'Admin'));
  }
  await fs.writeFile(path.join(publicDir, 'tomeva-config.js'),
    'globalThis.TOMEVA_WEB_CONFIG = ' + JSON.stringify(publicWebConfig(config), null, 2).replace(/</g, '\\u003c') + ';\n');
  await fs.writeFile(path.join(publicDir, 'tomeva-version.json'), JSON.stringify({ version: VERSION, projectId: config.firebase.projectId }) + '\n');

  const rules = institutionRules(await fs.readFile(path.join(firebaseSource, 'firestore.rules'), 'utf8'), config.staffDomain);
  await fs.writeFile(path.join(target, 'firestore.rules'), rules);
  await fs.writeFile(path.join(target, 'PASTE_IN_FIRESTORE_RULES.txt'), rules);
  await fs.copyFile(path.join(firebaseSource, 'firestore.indexes.json'), path.join(target, 'firestore.indexes.json'));
  await fs.writeFile(path.join(target, 'firebase.json'), JSON.stringify({
    hosting: { public: 'public', ignore: ['firebase.json', '**/.*', '**/node_modules/**'] },
    firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' },
    emulators: { firestore: { port: 8080 }, ui: { enabled: true } },
  }, null, 2) + '\n');
  await fs.writeFile(path.join(target, 'DEPLOY.md'), `# New institution project setup\n\nProject: ${config.firebase.projectId}\n\nControl Center generates this bundle locally without signing in. Use a new Firebase project on the Spark plan. No Cloud Functions or billing account is required; Spark usage quotas apply.\n\n1. In Firebase Console, register a Web app and copy its exact public config into Control Center. Enable Google, Anonymous, and Email/Password sign-in. Create a Cloud Firestore database. Add ${config.firebase.projectId}.web.app to authorized Auth domains.\n2. Open Firestore Database → Rules. Replace the editor contents with the entire PASTE_IN_FIRESTORE_RULES.txt file. These are complete rules for the new project. Use Rules Playground to test requests, then Publish. No existing Tomeva documents are needed.\n3. Create the indexes in firestore.indexes.json using Firestore Database → Indexes, or deploy indexes with Firebase CLI.\n4. The public folder is the complete student app source, including the Admin sign-in helper. Install Firebase CLI on the institution's computer, run firebase login, then from this exported folder run firebase deploy --project ${config.firebase.projectId} --only hosting.\n5. Give Librarian-Setup and Admin-Setup to the respective workstation users. Install the public desktop apps and import each folder's institution.json through File → Import institution setup (Librarian) or Setup → Import institution setup (Admin).\n6. In Admin’s End, sign in with a verified @${config.staffDomain} account. Use Kiosk Provisioning to create a credential for each librarian workstation. Enter it in that workstation's Librarian Settings. Use Student Access to authorize students.\n7. Librarian's first sync creates the catalogue. Students then sign in on the deployed site to search, request books, and read messages.\n\nDesktop alerts work while the desktop app runs. Student browser alerts work while its page is open and permission is granted. Requests and messages remain in Firestore after the page closes.\n\nThe institution keeps its Firebase account and data.\n`);
  return { path: target, installersIncluded: !!(installers.librarian?.filename && installers.admin?.filename) };
}

async function getRules(rawConfig) {
  const config = validateConfig(rawConfig);
  const firebaseSource = app.isPackaged ? path.join(__dirname, 'firebase-template') : path.join(__dirname, '..', "Librarian's End");
  const source = await fs.readFile(path.join(firebaseSource, 'firestore.rules'), 'utf8');
  return institutionRules(source, config.staffDomain);
}
async function copyRules(rawConfig, clipboard) { clipboard.writeText(await getRules(rawConfig)); }

module.exports = { exportSetupBundle, institutionRules, copyRules, getRules };

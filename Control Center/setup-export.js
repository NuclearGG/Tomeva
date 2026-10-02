'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, dialog } = require('electron');
const { validateConfig } = require('./config-store');
const { latestRelease, downloadPackage } = require('./github-distribution');
const { prepareWeb } = require('./web-distribution');

const { institutionRules } = require('./rules-config');

async function writeInstitutionRules(directory, config) {
  const rules = await getRules(config);
  await fs.writeFile(path.join(directory, 'firestore.rules'), rules);
  await fs.writeFile(path.join(directory, 'PASTE_IN_FIRESTORE_RULES.txt'), rules);
}

async function exportSetupBundle(window, rawConfig, component = 'all', platform = 'win', options = {}) {
  if (!['all', 'librarian', 'admin', 'student'].includes(component) || !['win', 'linux'].includes(platform)) throw new Error('Unknown application or platform.');
  const config = validateConfig(rawConfig);
  const selection = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'], title: 'Choose where to save the institution-ready package' });
  if (selection.canceled) return { cancelled: true };
  const release = await latestRelease(options.request, options.signal);
  const target = path.join(selection.filePaths[0], `Tomeva-${component}-${config.firebase.projectId}-${crypto.randomUUID()}`);
  await fs.mkdir(target);
  let installerPath = null;
  try {
    for (const key of ['librarian', 'admin']) {
      if (component !== 'all' && component !== key) continue;
      const directory = path.join(target, key === 'librarian' ? 'Librarian-Setup' : 'Admin-Setup');
      await fs.mkdir(directory);
      const result = await downloadPackage(key, platform, 'x64', directory, { ...options, release });
      installerPath = result.filename;
      await fs.writeFile(path.join(directory, 'institution.json'), JSON.stringify(config, null, 2));
      await writeInstitutionRules(directory, config);
      await fs.writeFile(path.join(directory, 'FIREBASE_SETUP.md'), `# Firebase access for this institution\n\nProject: ${config.firebase.projectId}\nStaff domain: ${config.staffDomain}\n\nIn this project's Firebase Console, open Firestore Database → Rules and review and publish PASTE_IN_FIRESTORE_RULES.txt. These rules and institution.json use the same staff domain. Staff accounts must have a verified email in that domain. Enable Google sign-in in Firebase Authentication.\n\nAfter publishing, sign out and sign in again in Admin to restart its listeners. If the institution settings change, generate new rules and desktop configurations together. Publishing these rules replaces the project's current rules; preserve any institution-specific additions.\n`);
      if (platform === 'linux') await fs.chmod(installerPath, 0o755);
      await fs.writeFile(path.join(directory, 'SETUP.md'), `# Tomeva ${key} ${result.version}\n\nCopy this whole folder to the destination computer. Keep institution.json beside ${path.basename(installerPath)}. ${platform === 'linux' ? 'Make the AppImage executable (chmod +x *.AppImage), then run it.' : 'Run the installer from this folder.'} A fresh profile imports these settings automatically; existing settings are preserved. To intentionally change them use Import institution setup in the app.\n\n${key === 'admin' ? 'Deploy the Student Portal package (including admin-sign-in) first, then sign in with verified institution staff Google credentials. Manage kiosk credentials, students and update approvals in Admin.' : 'Activate a kiosk credential issued in Admin. Local circulation remains available offline.'}\n`);
    }
    if (component === 'all' || component === 'student') {
      const directory = component === 'all' ? path.join(target, 'Student-Portal') : target;
      await fs.mkdir(directory, { recursive: true });
      await prepareWeb(directory, config, { ...options, release });
      await writeInstitutionRules(directory, config);
      await fs.writeFile(path.join(directory, 'DEPLOY.md'), `# Institution deployment\n\nProject: ${config.firebase.projectId}\n\nFor a NEW project: enable Google, Anonymous and Email/Password Authentication; create Firestore; paste PASTE_IN_FIRESTORE_RULES.txt into Firestore Database → Rules, test in Rules Playground, then publish. Create the included indexes. No Cloud Functions or Blaze plan is needed (Spark quotas apply).\n\nFor RECOVERY or UPDATES: preserve existing Firebase data and review rules changes before publishing.\n\nDeploy this package's public directory to your own hosting. For Firebase: firebase login, then firebase deploy --only hosting --project ${config.firebase.projectId}. For Apache/Nginx or a school website, serve the public directory over HTTPS. Add its hostname to Firebase Authentication authorized domains. Keep the admin-sign-in route available. Configure the deployed site URL in Control Center when using custom hosting.\n\nThe institution owns Firebase and hosting. Student alerts work while the page is open.\n`);
    }
    options.progress?.({ state: 'complete', name: component, percent: 100 });
    return { path: target, installersIncluded: component !== 'student', installerPath: component === 'all' ? null : installerPath, version: release.version };
  } catch (error) {
    await fs.writeFile(path.join(target, 'INCOMPLETE.txt'), 'Package generation did not finish. Retry in Control Center. Do not distribute this folder.\n');
    throw new Error(`${error.message} Incomplete output: ${target}`);
  }
}
async function getRules(rawConfig) {
  const config = validateConfig(rawConfig);
  const firebaseSource = app.isPackaged ? path.join(__dirname, 'firebase-template') : path.join(__dirname, '..', "Librarian's End");
  const rules = institutionRules(await fs.readFile(path.join(firebaseSource, 'firestore.rules'), 'utf8'), config.staffDomain);
  return `// Generated by Tomeva Control Center for Firebase project: ${config.firebase.projectId}\n// Institution staff domain: ${config.staffDomain}\n` + rules;
}
async function copyRules(rawConfig, clipboard) { clipboard.writeText(await getRules(rawConfig)); }
module.exports = { exportSetupBundle, institutionRules, copyRules, getRules };

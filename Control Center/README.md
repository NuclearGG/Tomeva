# Tomeva Control Center

This separate Electron application generates setup packages locally. It requires no account or Google sign-in. The setup person supplies Firebase web app configuration for a brand new institution project. Tomeva Admin and Tomeva Librarian handle daily library operations.

## Run

From this folder, run `npm install`, then `npm start`. The setup screen asks the institution to enter its own Firebase **web app** configuration. Do not enter a service-account key. This app keeps the configuration in its Electron user-data folder and backs up the previous copy when it changes.

## Free Spark setup

1. In the institution's Firebase project, create Cloud Firestore and enable Google, Anonymous, and Email/Password sign-in. Add the project's `web.app` domain to Firebase Auth authorized domains.
2. Enter the exact Firebase web app values and staff email domain in **Institution setup**. Save them.
3. Click **Copy Firestore rules**. In Firebase Console, open **Firestore Database → Rules**, paste the complete text into the rules editor, test sample paths in **Rules Playground**, then **Publish**. The Rules Playground tests rules; it is not the editor that publishes them.
4. Click **Export all packages**. It includes `Librarian-Setup`, `Admin-Setup`, `PASTE_IN_FIRESTORE_RULES.txt`, `firestore.rules`, `firestore.indexes.json`, and the complete student app code in `public`. Desktop setup folders contain their installers, configuration and handoff instructions in Windows release builds.
5. From that exported folder on an institution-controlled computer, run `firebase login`, then `firebase deploy --project YOUR_PROJECT_ID --only hosting`. If Firestore reports a missing composite index, create the listed index using its console link or `firestore.indexes.json`.
6. Import the respective `institution.json` into Tomeva Librarian and Tomeva Admin using File → Import institution setup in Librarian and Setup → Import institution setup in Admin. Sign in inside Admin's End with a verified staff Google account and provision each kiosk there. Librarian's first sync creates the catalogue in the new project.

Desktop notifications use live Firestore listeners while the desktop apps run. Student browser alerts work while Tomeva Web is open and the student grants permission. Browser alerts cannot be delivered after the site is closed in this Spark only design. Student requests and messages remain available in Firestore when they return.

## Releases

Windows release builds now embed the Librarian and Admin installers. Keep each exported installer beside its `institution.json` when transferring to another computer. A fresh installation imports that configuration automatically; existing installations preserve their saved settings. Setup packages has separate export and local-install buttons for both desktop apps.

## Recovery and approval

Create the prompted encrypted Recovery Kit after saving settings. Backup & recovery supports creation/rotation, safe verification, another encrypted copy and replacement-computer restore. Changed settings mark the kit stale. Manual recovery uses the existing Firebase configuration. Staff authentication remains in Admin.

Admin's Update approvals page stores an exact version, approved/paused policy and start time in the institution's Firestore. Desktop updaters check approval before download and again before installation. Control Center checkpoints its local state before self-update. See [the full safety audit](../documentation/RECOVERY_AND_UPDATE_SAFETY.md).

Build both desktop NSIS installers first. By default Control Center reads their `dist` folders; set `TOMEVA_DESKTOP_BUILD_DIR=dist-release` for that output directory, then run `npm run build:win`. Missing binaries stop the Windows distribution build. Development exports identify configuration-only packages.

Public release binaries are separate from the institution's Firebase project. Build installers with `TOMEVA_RELEASE_OWNER`, `TOMEVA_RELEASE_REPO`, `TOMEVA_LIBRARIAN_RELEASE_REPO`, and `TOMEVA_ADMIN_RELEASE_REPO` set to the project's public GitHub release repositories. Build and publish signed releases from trusted release infrastructure. Each installed app owns its update installation; Control Center checks its own updater and displays the other public release versions. Its buttons open the installed desktop apps' update flows. Local data lives in Electron user-data folders, outside installer resources. Librarian makes a SQLite backup before installing a downloaded update.

## Verification

`npm test` checks config preservation and release metadata lookup. `npm run test:desktop` checks the isolated Electron app, setup export, clipboard rules, and web export. The Firestore emulator tests run from `Librarian's End` using `firebase emulators:exec --only firestore --project demo-tomeva "npm run test:rules"` with a current Java runtime.

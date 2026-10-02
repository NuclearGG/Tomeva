# Tomeva Control Center

Control Center is the only application institutions download manually. It is a separate, login-free setup and software distribution app. The setup person supplies their Firebase web configuration in the step-by-step wizard.

## Institution setup

Enter the **Institution name** and **Staff email domain** in Firebase setup. The name travels with desktop setup files, encrypted recovery kits and the student web configuration; the student welcome screen displays it. Existing setup files remain readable, and Control Center asks for the name before saving or exporting again. After editing these settings, regenerate and distribute the affected packages.

Control Center generates Firestore rules from the **Staff email domain** entered for each institution. Preview, Copy rules, desktop setup folders, and Student Portal exports all use the same generator. Each generated rules file identifies its Firebase project and staff domain. Publish that institution's `PASTE_IN_FIRESTORE_RULES.txt`; the repository's `firestore.rules` is a template containing `staff.example` and must not be deployed directly. After changing the staff domain, regenerate and publish the rules and import the matching desktop configuration, then sign in again in Admin.

Run `npm run test:rules` in Librarian's End with its Firestore emulator before deploying rules. `firestore.txt` is also a template, not an institution-ready rules file. Legacy Cloud Function deployments must set `TOMEVA_STAFF_DOMAIN` to the same staff domain; missing configuration denies staff operations. Current exports use the kiosk account flow and do not need Cloud Functions.

1. Create an institution-owned Firebase project, enable Firestore and Google/Anonymous/Email-Password Authentication, and enter its exact web configuration and staff domain.
2. Copy the complete generated Firestore rules into Firebase Console → Firestore Database → Rules. Test using Rules Playground, then publish. No Cloud Functions or Blaze plan is required; Spark quotas apply.
3. In Setup packages choose Windows or Linux, then download each desktop package separately or generate all packages. Control Center retrieves the latest official software from **NuclearGG/Tomeva GitHub Releases**, verifies its SHA-256 and size, and adds the institution configuration locally. Local-install buttons download and launch the appropriate package on this computer.
4. Copy the entire generated desktop folder to its destination computer. Keep `institution.json` beside the installer/AppImage. Fresh profiles import it automatically; existing profiles preserve their saved settings. Use Import institution setup to intentionally change them.
5. Generate the Student Portal package. Deploy its `public` directory to your own Firebase Hosting, school website, Apache or Nginx over HTTPS. Configure the hosting domain in Firebase Auth. The package includes the Admin sign-in helper. For custom hosting, enter the site's URL in Control Center before exporting desktop configurations.
6. Authorized staff sign in to Admin to provision kiosks, manage students and approve software rollout. Daily Librarian circulation stays offline-first.
7. Create and verify an encrypted Recovery Kit. Store a copy away from this computer and the password separately.

GitHub receives no institution configuration, credentials or database. Control Center has no permanent internal binary cache and does not ship other installers inside its own installer. User-requested exports remain in the selected output directory. Failed downloads remove their `.part` file and incomplete bundles are clearly marked.

The official repository currently needs published assets before live downloads can work. Control Center reports missing releases/assets clearly; there is no custom download server or manual-GitHub fallback.

## Updates and recovery

Control Center updates itself from GitHub with a local checkpoint before installation. Admin's Update approvals page stores an exact version, approved/paused policy and start time in institution Firestore. Each desktop app downloads that approved GitHub tag, verifies the Electron update metadata, rechecks authorization and asks before restart. A newer public release does not override an older institution-approved version.

Backup & recovery supports encrypted kit creation/rotation, verification, export of another encrypted copy and restore. Settings changes mark old kits stale. The institution owns the password; Tomeva has no recovery key. Manual recovery uses existing Firebase settings and authorized Admin accounts. Kits contain bootstrap settings, not Librarian circulation data.

See [distribution architecture](../documentation/SOFTWARE_DISTRIBUTION.md) and [recovery safety audit](../documentation/RECOVERY_AND_UPDATE_SAFETY.md).

## Development and publishing

Run `npm install`, then `npm start`. Tests: `npm test`, `npm run test:desktop`. Desktop smoke tests use controlled GitHub fixtures, including both operating-system packages and a real Student ZIP; they do not publish or install software.

Build each desktop app from its own folder with `npm run build:win` or `npm run build:linux`. Outputs are in each app's **dist** directory. From the repository root run `node scripts/collect-release.cjs win` (or `linux`) and `node scripts/package-student.cjs`. The collector keeps component update metadata separate. All package versions must match the `vX.Y.Z` release tag.

The GitHub release workflow builds Windows and Linux separately and assembles a publisher-reviewed draft release. Only software and templates enter those assets. Signing requires the publisher's signing identity; local unsigned builds do not imply authenticated publisher identity. Do not claim automatic rollback.

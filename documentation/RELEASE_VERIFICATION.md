# Release verification

The release provides Windows x64 Control Center, Admin, and Librarian installers plus the Student Portal archive. Every installer is checked against its generated Electron SHA-512 update metadata; SHA256SUMS covers all collected files.

Checks exercised during preparation:

- Control Center configuration, recovery encryption, download validation, archive safety, generated rules, branding, and update approval tests.
- Admin HTTP OAuth callback and staff-domain tests, plus isolated Electron startup.
- Librarian native SQLite, migration, rollback, circulation, kiosk revocation, roster and privacy synchronization, plus offline Electron circulation and PIN locking.
- Firestore emulator: 109 Jest tests and 12 REST authorization tests.
- Real Student ZIP generation and CC export smoke tests.

Build dependencies are declared per application with npm lockfiles. Use `npm run install:all` for development; end-user installers include runtime dependencies. Java 21+ and Firebase Tools are additional emulator-test requirements. The legacy `functions/mintKioskToken.js` is reference code outside the deployed application and has no supported deployment package; the current kiosk flow uses registered email/password credentials without Cloud Functions.

No claim is made that every possible interaction was tested. Production Firebase deployment, a live institution Google login, signed publishing, clean-machine installer acceptance, and macOS packaging remain outside these checks. Linux builds were attempted during preparation but are not included in this Windows release.

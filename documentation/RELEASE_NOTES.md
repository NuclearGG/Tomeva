# Tomeva 1.0.7

## Users

Choose **tomeva-control-center-1.0.7-win-x64.exe** for Windows 10/11 x64 or **tomeva-control-center-1.0.7-win7-x64.exe** for Windows 7/8/8.1 x64. Control Center downloads the matching Admin and Librarian installers from this release. The Student Portal is also available as **tomeva-student-1.0.7.zip**.

- Librarian navigation now scrolls at normal window sizes. Settings accept a zero fine, reject invalid loan periods, preserve active loans during catalogue import, and do not charge a fine until the day after a due date.
- Admin keeps the active book search after Refresh or a live data update, shows a clear no-results state, and rejects CSV rows with unexpected columns.
- Control Center uses the default Firebase Hosting address when the optional Student web URL is blank and gives clearer setup errors.
- The Student Portal shows a connection retry instead of indefinitely waiting for sign-in. Its browser session expires after 10 hours, and Firestore rules enforce up to 100 book-request submissions per account in a 10-hour window.
- The public Tomeva website now uses locally hosted Lenis smooth scrolling with reduced-motion support. The visual architecture documentation reflects the four current applications and SQLite persistence.

**Institution deployment:** Publish the new Student Portal and generated Firestore rules together. The previous portal cannot submit requests under the new quota rules, and the new portal cannot submit requests under the previous rules. Each institution must also authorize its hosted domain in Firebase Authentication.

The Windows 7/8/8.1 line uses Electron 22, which no longer receives security fixes. Use it only where an operating-system upgrade is not possible. These installers are unsigned.

## Developers

Clone the repository and run `git lfs pull` for all installers in `packages/`. `packages/SHA256SUMS` covers the committed assets, and each Electron update feed includes its installer SHA-512. The source and release assets use the same version.

## Verification

Unit tests, all three desktop smoke tests, 117 Firestore rules tests, 12 kiosk REST authorization tests, modern and legacy installer metadata, Student ZIP contents, and package checksums passed. The public site and visual architecture page were rendered in Chrome at desktop size. Interactive installation on physical Windows 7/8.1 hardware and live institution Firebase deployment remain acceptance checks.

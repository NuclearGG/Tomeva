# Tomeva 1.0.6

## Users

Download the Control Center installer for your computer:

- **tomeva-control-center-1.0.6-win-x64.exe** — Windows 10/11 x64.
- **tomeva-control-center-1.0.6-win7-x64.exe** — Windows 7/8/8.1 x64.

Control Center downloads the matching Admin and Librarian apps from this GitHub release. The Student Portal is also available as **tomeva-student-1.0.6.zip**. The installers and Student Portal archive are committed in the repository's `packages` directory as well.

This update gives the Student Portal a clearer library workspace and lets students delete their account. Librarians can review a matching admission number before adding a student, submit a correction when the match belongs to someone else, and delete local student accounts. Admins can remove roster entries and pending login records. Admission-number reservations and validation reduce duplicate accounts. Update notes now display as plain text instead of showing HTML tags.

The legacy installers use Electron 22, which no longer receives security fixes. Use them only on computers that cannot move to Windows 10/11. The installers are unsigned.

## Developers

Clone the repository and run `git lfs pull` to obtain the installers alongside the source. See the root README for setup, development, tests, and build commands. `packages/SHA256SUMS` covers the committed packages; each Electron update feed also records its installer SHA-512 hash.

The account changes require deploying the updated Firestore rules to each institution's Firebase project. Existing locally installed applications receive their matching modern or legacy update from GitHub.

## Verification

Unit tests, desktop smoke tests, installer contents, update metadata, and package checksums were checked for this release. Firestore emulator tests require Java 21 or newer; they were not run on the release machine, which has Java 8. Interactive installation on Windows 7/8.1 hardware and live Firebase account flows remain acceptance checks.

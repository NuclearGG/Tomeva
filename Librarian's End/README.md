# Tomeva desktop

Run `npm install`, then `npm start`. Node 22.12 or later is required.

## Local database (Prompt 5)

Library records now live in `tomeva.sqlite3` in Electron's user-data directory
(normally `%APPDATA%/tomeva` on Windows). SQLite runs in the main process with
WAL journaling. The renderer uses purpose-built `electronAPI.db` methods; the
existing synchronous `LibraryDB` API remains compatible with circulation and sync.
Book, student, transaction, payment and settings changes commit atomically.

On first launch, Tomeva reads the old `tomeva.db` localStorage entry and:

1. Writes and verifies an exact timestamped JSON backup in `migration-backups`
   inside the user-data directory.
2. Migrates all five collections in a single SQLite transaction.
3. Checks row counts and contents and commits a migration marker.
4. Removes only the old `tomeva.db` entry after verified success.

A notice confirms migration. An interrupted cleanup can safely retry on the next
launch. Invalid data, failed backup writes, or duplicate identifiers retain the
original data and prevent partial imports. A different legacy source is backed up
and rejected if migration already completed. Investigate that conflict before
restarting migration; do not delete either copy.

Use the app's **Backup Database** command for normal backups. Do not copy just a
live `.sqlite3` file while the app is running: committed changes may still be in
its WAL file. Existing `tomeva-v2` JSON backups remain supported. Legacy Loki JSON
backups are recovery sources for migration, not `tomeva-v2` import files.

Local circulation needs no login or network. Firebase SDK scripts ship inside the
app, so a cold offline launch does not wait for a CDN. Cloud synchronization stays
independent of local database operations.

## Student roster intake (Prompt 6)

Each online sync reads staff-approved `authorized_students` records into the local
SQLite roster. Records match by email or admission number; cloud group assignments
update the matching local row without replacing its circulation history. New
students use the admission number recorded by the student portal. For older
approvals without that field, Tomeva reads the student's `student_logins` profile.
If neither source has an admission number, the record waits for one and no
synthetic ID is created. Offline circulation continues from the last local roster.

## Workstation lock (Prompt 8)

Set a four-digit operational PIN in Settings and choose a 5, 10, or 15 minute idle
timeout. Ctrl+L (Cmd+L on macOS) or **Lock now** covers the application immediately.
The PIN is salted and hashed with PBKDF2/SHA-256 before it is stored in SQLite;
verification and database access control run in the Electron main process. Unlocking
does not require internet. The lock remains active after an app restart.

## Cloud privacy split (Prompt 3)

The public catalog at `libraries/main/public/catalog` contains book availability
and counts only. Borrower names, admission numbers, loans, fines, and collection
details sync to `libraries/main/restricted/circulation` for verified staff reads.
The legacy `libraries/main` document is replaced with the public payload on the
next successful sync. Until then, the updated rules keep legacy root reads
staff-only because older deployed documents may still contain borrower data.

Deploy `firestore.rules` only after `npm run test:rules` passes against the
Firestore emulator. Update the admin and student clients together with the
librarian app. The live sync will report permission denied if the app sends the
new version 6 payload while the old rules remain deployed. After deployment,
run one online sync to remove older private fields from the legacy root.

## Checks and packaging

- `npm run test:sqlite` — native SQLite under Electron, migration, failure rollback,
  circulation, restart, and IPC boundaries.
- `npm run test:desktop` — actual app and preload with isolated temporary data and
  networking disabled. The test opens a temporary window and leaves the user's
  library untouched.
- `npm run test:kiosk` — credential and revocation checks.
- `npm run test:rules` — **required pre-deploy gate**, using the Firestore emulator.
  Run it before any rules deployment; local database tests do not replace it.
- `npm run build:win` — Windows installers; `npx electron-builder --win --dir` for
  an unpacked build.

`better-sqlite3` 13 includes Node-API binaries. The install hook verifies the binary
in Electron rather than compiling it. Packaging unpacks the native binaries from
ASAR and includes only application files and production dependencies.

# Security, import and recovery completion — 15 October 2026

## 1. Generated and deployed Firestore rules

- Removed the exporter's provider-check rewrite. Rule generation now replaces only the institution domain; the Google provider requirement in `isKioskAdmin` is preserved unchanged.
- Added emulator specs for generated `school.edu`, `gmail.com`, and `staff.school.edu` rules. Tests cover successful Google administrator access, rejection of password/custom/anonymous providers despite explicit grants, wrong domains, suffix lookalikes, unverified email, disabled grants, and forbidden self-grants.
- Inspected and backed up the production rules before publishing. The previous deployed rules already contained the Google provider check; no institution-specific policy additions differed from the current template.
- Published the exact Control Center output for the configured institution project using Firestore-only deployment.
- Read the active release back through the Rules API and compared its source byte for byte. The project/ruleset identifiers are retained in the private deployment metadata.
- Deployed source SHA-256: `f91513205c4b9c42d288e2f1b70ccfb3d27f489fdca588369c55a7996beccfbe`.
- Re-ran the emulator suite with the downloaded production source substituted for the `gmail.com` cases: **148 specs and 12 REST rules checks passed**.
- Live unauthenticated GET checks: public catalogue **200**, restricted circulation **403**, kiosk registry **403**. Positive Google administrator writes were tested in the emulator; the live checks did not write library records.

Deployment backup, generated source, downloaded source and release metadata are local ignored artifacts under `.release-tools/firestore-2026-10-15/`. This follows Firebase's [rules deployment and management workflow](https://firebase.google.com/docs/rules/manage-deploy).

## 2. Stored markup in Librarian collected fines

Escaped payment IDs, admission numbers, book IDs, date labels and amounts before HTML insertion. Existing records containing markup remain readable as text. The real Electron renderer test imports a markup admission number into SQLite, creates and pays a fine, includes markup in historical payment identifiers, and verifies that no injected element is created in the collected-fines table.

## 3. Import limits and duplicate handlers

- JSON imports require a `.json` filename, a supported JSON/plain-text MIME type or an empty Windows MIME value, and a nonempty file of at most **2 MiB**.
- Enforce **1–1,000 rows** and object-shaped rows. Bound UTF-8 bytes before parsing in both renderer and main process, so the renderer check cannot be bypassed by calling the database bridge directly.
- Removed the duplicate setup import handlers. The desktop test confirms one file read and one import for a setup selection.
- Read errors and cancellation produce recoverable messages. Failed imports leave the prior database transaction intact.
- Imports retain their existing replacement semantics. They are not append batches; a catalogue with active loans must still include those loaned copies.

## 4. Upload groups of 50 and Admin pages of 25

- New snapshot documents contain at most **50 rows**. Upload commits are sequential, contain at most 50 records, and finish staging before the public/private manifests switch to the new generation. Failed staging never publishes an incomplete generation.
- A successful book import requests a sync through the existing approved-kiosk path. Offline/unapproved work stays local and is eligible for the normal later sync.
- Admin listens to summary manifests and fetches row pages on demand. Available, issued, damaged, overdue and fine tables show at most **25 rows** with loading, Previous/Next, and retry states.
- A 50-record cloud page can serve two 25-row display pages. Old 200-record snapshot documents remain readable until the institution next syncs with the updated Librarian app.
- Keep at most four shard documents in a temporary memory cache. Forward-page cursors prevent repeatedly reading evicted earlier documents. Search scans unloaded pages sequentially and is debounced; it is not a full-text server index.
- Clear row cache, cursors, pending requests and table rows on view exit, sign-out and page close. Institution changes reload the page. Circulation listener denial also removes its rows. Remove the older persistent public catalogue cache on startup.
- Read pages through authorized Firestore REST requests with HTTP caching disabled; this avoids retaining row copies inside the Firestore SDK document cache. No new packages are needed.
- Actual Electron table/controller tests verify loading, 25-row limits, navigation, reuse, cross-page search, error/retry, staff token use and cache/private-row removal. Separate unit tests verify that forward paging reads each shard only once.

## 5. Executed file-based recovery drill

Command: `node scripts/recovery-drill.cjs`.

The drill used a read-only SQLite backup of the existing live Librarian profile, then worked only in disposable profiles. Machine-bound workstation PIN settings were removed only from the disposable copy and a drill PIN was configured through normal IPC. Two synthetic books/readers were added to the copy to exercise an active loan, a returned loan and a paid fine. The live institution configuration and live circulation database were not modified.

- Created an encrypted Kit from the existing Control Center institution configuration using real renderer/preload/main IPC.
- Verified it and restored it into a fresh Control Center profile. Configuration fingerprints matched.
- Exported a real Librarian circulation JSON backup through native IPC, changed only the drill database, then restored the backup through the normal checksum preview, confirmation and native SQLite checkpoint path.
- Compared all exported circulation data before/after restore, excluding export timestamp/checksum: exact match. Restored drill copy: **102 books, 6 students, 1 active loan, 1 fine payment**.
- Kit, circulation backup and password are in three separate directory trees outside the repository. Directory permissions are restricted to the current Windows user. The generated recovery password was never printed or committed.

Successful drill report:

`%LOCALAPPDATA%/Tomeva/RecoveryDrills/<successful-run-id>/report.json`

Kit directory:

`%LOCALAPPDATA%/Tomeva/RecoveryDrills/<successful-run-id>/kits`

Circulation backup directory:

`%LOCALAPPDATA%/TomevaCirculationBackups/<successful-run-id>`

Password location, separate from the Kit:

`%LOCALAPPDATA%/TomevaRecoveryPasswords/<successful-run-id>.txt`

These are local drill artifacts. They are not an off-computer or disaster-site backup. Earlier unsuccessful drill copies remain in private local drill folders; the report above identifies the completed run.

## 6. Circulation discipline

Declared one authoritative circulation desk per library in the user guide and Librarian setup/sync UI. [The transfer procedure](SINGLE_DESK_CIRCULATION.md) requires stopping the old desk, exporting a verified circulation backup, closing/revoking the old kiosk, restoring and checking the replacement, and only then syncing/resuming. Multiple Admin/Student clients are supported. No distributed lock or multi-desk transaction merge is claimed.

## Delivery status

Final verification: **112 project regression tests passed**, plus the **148 emulator specs and 12 REST rules checks** above. Dedicated Electron import-security, Admin paging, Control Center recovery, and normal Librarian circulation/PIN smoke checks passed. Generated client bundles were rebuilt and `git diff --check` passed.

Firestore rules are live and verified. Desktop fixes and generated client bundles are local source/build changes; published v1.0.9 installer assets have not been replaced. No release signing key or certificate was generated.

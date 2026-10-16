# Recovery testing — 14 October 2026

## Scope and isolation

Tested Control Center recovery creation, export, verification, and restore, plus Librarian database restore and migration recovery. Every profile and database was generated in a dedicated temporary directory using synthetic records. External requests were blocked in the Control Center UI test. No production Firebase settings, accounts, cloud data, installed application profiles, or release assets were changed.

## Confirmed issues and local fixes

| Finding before changes | Fix |
| --- | --- |
| Selecting `institution.json` as the recovery export destination overwrote local settings. | Reject destinations inside the profile, including linked directories; require a `.tomeva` destination. |
| Deleting the cached recovery file left its metadata reporting a current kit. Damaged metadata threw instead of showing recovery guidance. | Inspect the cached file as well as metadata; report missing, damaged, and stale state, and prevent exporting an unsuitable cached copy. New caches include a digest to detect accidental modification. |
| Damaged local settings caused recovery status to throw. | Return guidance to restore an external kit or re-enter the existing Firebase settings. Restore can checkpoint and replace the damaged settings. |
| A password consisting entirely of spaces could create a kit, and password validation happened after the Save dialog. | Reject all-space creation passwords before opening Save. Existing kits retain their original decryption rules for compatibility. |

Additional hardening: export through a unique temporary file, flush it, then rename it over the destination; retain the previous destination on write failure. Cache files use the same approach. If the external export succeeds but the local cache update fails, the UI reports that partial outcome. Malformed JSON and invalid kit metadata produce readable errors.

## Scenarios exercised

- Mismatched confirmation, all-space password, wrong password, cleared password fields after an attempted operation.
- Cancel Save, cancel Open, cancel the restore confirmation; Cancel remains the default choice.
- Empty file, `null`, array, malformed JSON, unrelated settings file, oversized file, altered authentication tag, unsupported format, excessive KDF parameters.
- Accidental save over settings, cache, checkpoints, an unrelated JSON file, and a directory link into the profile.
- Missing/corrupt cached kit, corrupt metadata, changed settings, and retry after failure.
- Rapid repeated operations: a second operation is rejected while the first holds the recovery lock.
- Simulated partial disk-full write and failed final rename preserve the previous external file and remove the temporary file.
- Failed local cache metadata update reports a usable external export without claiming a current cache.
- A blocked checkpoint directory prevents restore before settings are replaced.
- Restore over corrupt settings preserves the original damaged bytes in a checkpoint and restores valid configuration.
- Librarian wrong files, checksum mismatch, duplicate identifiers, and unapproved legacy backup leave all original rows intact.
- Injected Librarian insertion failure after replacement begins rolls back every table; original rows remain after reopening the database.
- A real SQLite pre-restore backup remains readable after the live library is replaced. Legacy restore requires explicit opt-in.

## Verification

- `npm test`: project regression suite passed, including Control Center, Admin, Librarian SQLite, backup validation, and access checks.
- `node --test "Control Center/test/recovery*.test.cjs"`: recovery regression scenarios passed.
- `npm --prefix "Control Center" run test:recovery:desktop`: passed against the real renderer, preload, and main-process IPC with native dialogs replaced by controlled test responses.
- The same recovery desktop harness passed using the installed local Electron 22 runtime; the standard run used Electron 43. Both ran on this Windows computer.

## Limits

Write failures were injected; this was not a physical power-loss, disconnected-drive, failing-hardware, or Windows 7 device test. A Recovery Kit restores bootstrap settings, not Firebase account permissions, cloud data, or the Librarian database. Encryption still requires the correct recovery password. A current cache status is not a substitute for decrypting and verifying the off-computer copy.

Changes are local source changes. Published v1.0.9 installers have not been rebuilt or replaced.

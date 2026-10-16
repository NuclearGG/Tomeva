# Tomeva 1.0.10 release verification

Verified on 16 October 2026 with isolated profiles and synthetic institution data.

## Passed

- **136 application tests**: the complete 135-test application/native suite plus the added artifact-only release-commit regression (the final Control Center suite has 45 tests). Includes 32 native SQLite tests covering migrations, rollback, import/circulation integrity, FTS and query-plan baselines.
- **190 Jest Firestore emulator tests plus 12 REST authorization tests**, including generated institution rules, current Google provider requirements, request transitions/metadata, unauthorized deletion, audited removal/restore and kiosk revocation.
- Runtime dependency audits: **zero known vulnerabilities** reported for modern Control Center, Admin and Librarian production dependency trees at verification time.
- Modern and legacy Windows x64 installers for all three applications, plus the Student Portal ZIP. All six installers report **NotSigned**, matching the intentional unsigned-pilot policy.
- Packaged modern and legacy Admin, Control Center and Librarian smoke tests. Legacy checks cover actual Electron 22 startup, Control Center handoff exports/navigation, native SQLite issue/return, local PIN locking and isolated IPC. The legacy Librarian check used the sibling staging app's identical Electron 22 runtime because its local npm Electron launcher lacked installation metadata; the packaged Librarian code/native library itself was exercised successfully.
- **387 packaged source/asset comparisons**, all six desktop versions/build variants and Student ZIP metadata. Includes the new schema/credential/export/query-plan modules and the shared diagnostics module.
- Actual Recovery Kit plus circulation restore drill using disposable profiles passed after schema migration; live profiles were untouched. Separate Kit/password/circulation locations are retained outside the repository. Specialized recovery UI, Admin catalogue/directory and import checks passed during the hardening work.
- Six CycloneDX inventories cover modern and actual legacy dependency trees. Source commit, dirty-state and input lockfile hashes are recorded; release generation requires clean source. The release archive includes package license inventories, Tomeva's license and third-party notices. Legacy and modern runtime dependencies are distinguished.
- Ignore checks cover generated bundles/assets, SQLite3/WAL files, migration/schema/update checkpoints, encrypted credentials, JSON-line diagnostics, Recovery Kits and private installed-profile QA notes. Staged source was scanned for private-key/live-token/service-account material; no findings were detected. The private pre-existing QA note remains local and ignored.

## Acceptance details and limits

Packaged Control Center's export-heavy smoke test hit its overall deadline while installers were being built in parallel. Its traced modern rerun after packaging completed passed every export and navigation check without extending the deadline. These checks are functional acceptance, not a cold-start or large-library performance benchmark.

The packaged handoff fixture now has a 180-second overall bound for repeated full archive extraction, including the legacy runtime; source smoke retains 60 seconds. Individual request/screenshot limits are unchanged. Failed early staging-launcher attempts were corrected by using the complete root test harness with the actual Electron 22 runtime.

Use `node scripts/verify-built.cjs`, `npm test`, `npm run test:rules`, the desktop scripts and `npm run verify:packages` to reproduce the relevant gates. `npm run release:preflight` also requires the source tag, unchanged source after any artifact-only commit, current clean-source SBOM provenance/archive receipt and a checksummed SBOM asset. Upload/publish verifies every release asset against its local SHA-256 digest and size. Previously published versioned installers are preserved.

This release does **not** deploy production Firebase rules, the Student Portal or grants automatically. Install matching clients and deploy the institution-generated rules/portal together during a maintenance window; old clients omit required audit/decision metadata. Recheck institution access, synthetic request/cancel/issue, audited deletion/restore and kiosk revocation before live use. Kiosks with old unscoped credentials require reactivation.

One authoritative circulation desk remains required. Signing, clean-machine installer acceptance, physical Windows 7/8/8.1 hardware acceptance, large-library hardware/quota benchmarks and an independent security review remain outside these checks. Legacy Electron 22 no longer receives security fixes. Linux and macOS assets were not built for this release.

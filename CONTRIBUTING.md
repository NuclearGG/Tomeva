# Contributing to Tomeva

Tomeva is an institution-owned, offline-first library system. Use synthetic data and a Firebase demo project for development. Keep changes compatible with one authoritative circulation desk per library.

## Setup and checks

Use a currently patched, supported Node.js release and the committed npm lockfiles. The October 21, 2026 security releases fix CVE-2026-111497 in the bundled Brotli decoder. Before building or distributing, read the [developer security note and legacy suspension](documentation/LEGACY_DOWNLOAD_SUSPENSION.md). The declared engine minimum alone does not establish a patched host or embedded Electron runtime. On Windows, install dependencies with `npm run install:all`; the Librarian native SQLite dependency must match its Electron runtime. Application users install a packaged app and do not run npm.

Before submitting a change:

1. Run `npm test` for app logic, SQLite, auth/access gates, imports, update policy and release verification.
2. With Java 21 and Firebase CLI installed, run `npm run test:rules`. This starts the Firestore emulator for `demo-tomeva`; tests must not use production project credentials.
3. For renderer or IPC changes, run the affected app's `test:desktop` and relevant specialized scripts: Librarian `test:imports:desktop`, Admin `test:catalogue:desktop` and `test:directory:desktop`, Control Center `test:recovery:desktop`.
4. Build client bundles with `node scripts/prepare-client.cjs` and Control Center with `npm --prefix "Control Center" run build:ui`.
5. Run `git diff --check`. Include the behavior changed, test evidence, migration/deployment steps, and material limits in the pull request.

## Data and security boundaries

- Never commit institution settings, credentials, tokens, production records, SQLite files, circulation backups, Recovery Kits, private signing keys, or certificates.
- Keep Firestore rules authoritative. Domain membership alone is not a staff grant. Privileged staff operations require a current verified Google session and explicit enabled grants.
- Administrative writes use `desktop-integration/admin-audit.mjs`. Protected changes and their immutable before/after journal commit together. Do not replace audited deletion with a direct SDK delete.
- Catalogue imports replace a list and must preserve active loans and canonical access numbers. Circulation mutations belong in the main-process SQLite transaction, with an audit outbox entry.
- Renderer IPC must verify the exact local main frame and lock state. Validate sizes and arguments in main even when the renderer already validates them.
- Treat external documents, imported rows, cloud fields and release notes as data. Escape text before HTML insertion. Keep nodeIntegration disabled and retain CSP restrictions.

## Rules changes and rollout

`Librarian's End/firestore.rules` is canonical. Keep `firestore.txt` and Control Center's `firebase-template` copies synchronized. Add emulator tests for the actual generated institution rules as well as the template. A new required field or journal protocol needs coordinated clients and rules deployment; document the safe rollout order.

## Release procedure

**Legacy Windows distribution is temporarily suspended.** Do not upload or republish Windows 7/8.1 installers, blockmaps or legacy update feeds. Modern distribution remains available. See the [suspension decision](documentation/LEGACY_DOWNLOAD_SUSPENSION.md).

1. Choose a new version across the root and three desktop package files/lockfiles. Published release assets are immutable.
2. Review dependency changes and third-party notices, then pass app, emulator, desktop and build checks.
3. Commit source and tag that commit. Generate preview SBOMs with `npm run sbom`; after building both Windows lines, use `npm run sbom -- --release` on clean source to create the versioned SBOM ZIP. The inventories include build dependencies, the shared Firebase web SDK and the actual legacy staging lockfiles.
4. Build/package and regenerate SHA256SUMS including the SBOM archive. Binary/feed output under `packages/` is verified separately from the clean source tree, avoiding a source-hash/artifact-commit cycle.
5. Run `npm run release:preflight`. Publication also runs this gate and package checks. It requires clean source, matching versions/tag, and current clean-source SBOM provenance/hashes.
   A subsequent commit containing only `packages/` artifacts may follow the source tag. Preflight verifies that the tag is an ancestor and that all source paths still match it; SBOM provenance remains bound to the tagged source commit.
6. Configure existing publisher keys/certificates and `TOMEVA_REQUIRE_SIGNING=1` for signed distribution. Signing is intentionally deferred for current pilots; never create a production key automatically or describe checksum-only pilots as publisher-authenticated.

See [SECURITY.md](SECURITY.md), [third-party notices](THIRD_PARTY_NOTICES.md), and [documented risks](documentation/KNOWN_RISKS.md). Do not publish real student data as a reproduction case.

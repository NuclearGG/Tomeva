# Tomeva 1.0.8

## Downloads

Choose `tomeva-control-center-1.0.8-win-x64.exe` for Windows 10/11 x64 or `tomeva-control-center-1.0.8-win7-x64.exe` for Windows 7/8/8.1 x64. Control Center downloads the matching Admin and Librarian installers. The Student Portal is `tomeva-student-1.0.8.zip`.

## Security changes

- Verified student ownership, unique admission reservations, explicit staff grants and separate kiosk administrator grants protect Firebase data.
- Catalog snapshots use bounded pages and complete generations. Public catalog caching reduces repeated reads; private circulation remains restricted to staff.
- Native actions require an unlocked trusted workstation. PIN verifiers use OS protection, stronger derivation and persistent retry limits.
- Backup restores validate checksums and relationships, show a confirmation preview and checkpoint SQLite. Imports preserve circulation status.
- Activity logs use authenticated chains backed by a transactional SQLite outbox. Renderer log append and arbitrary undo access were removed.
- Desktop and web clients use tighter script policies and bundled Firebase code. The unused token function was removed.
- Updates verify release checksums and recheck installers before launch. Embedded publisher keys enable mandatory Ed25519 signature verification; unsigned development and pilot releases remain supported until signing is configured.

## Deployment prerequisites

Version 1.0.8 is an **unsigned pilot release**. Signing is intentionally deferred by the publisher; no production key has been generated. Downloads and updates verify checksums over trusted GitHub HTTPS endpoints, but those checksums do not authenticate the publisher. Configuring an existing public key makes signatures mandatory with no unsigned fallback. Windows code-signing certificates are optional for pilots; set `TOMEVA_REQUIRE_SIGNING=1` to enforce signing for a future signed build.

Institutions must migrate admission records, create staff and kiosk administrator grants, and deploy the new clients and Firestore rules together. See [the audit remediation report](SECURITY_AUDIT_REMEDIATION.md) for the rollout sequence and all 15 findings. Public Firestore read abuse remains mitigated rather than eliminated.

Windows 10/11 x64 is the maintained installer line. Windows 7/8/8.1 compatibility builds use Electron 22, which no longer receives security fixes.

## Repository and verification

Source and package versions are 1.0.8. Generated test artifacts, local screenshots, databases, signing credentials and client bundles are excluded from source control. Release installers remain managed by Git LFS.

Verification passed: 82 application tests, 127 Firestore rules tests, 12 kiosk REST authorization tests, three Electron smoke checks, modern and legacy Windows builds, 44 packaged source/version comparisons and all 19 release asset checksums. Runtime dependency audits reported zero vulnerabilities for the three desktop applications. Live institution deployment and physical legacy Windows acceptance remain external checks.

# Tomeva 1.0.10

## Downloads

Start with `tomeva-control-center-1.0.10-win-x64.exe` for Windows 10/11 x64. The legacy Windows 7/8/8.1 line is `tomeva-control-center-1.0.10-win7-x64.exe`. Control Center downloads the corresponding Admin and Librarian installers. The Student Portal is `tomeva-student-1.0.10.zip`; dependency inventories are in `tomeva-1.0.10-sbom.zip`.

## Security and circulation

- Enforce request transitions and truthful actor/server-time decision metadata; issued requests cannot return to Pending.
- Protect student access/profile deletion with staff authorization and atomic, immutable recovery events. Admin can inspect recent changes and restore deleted records safely. Students use an account-removal request reviewed by staff.
- Resolve accession numbers case-insensitively, including Unicode; preserve canonical references through imports; reject omitted active loans/borrowers and duplicate active copies. Damage/restoration requires closing the active loan first.
- Escape portal statuses and validate Admin monetary values. Tighten CSP, IPC argument/rate limits and native backup destinations.
- Bind OS-encrypted kiosk credentials to the institution project and workstation. **Previously stored unscoped kiosk credentials require reactivation.**

## Recovery, settings and performance

- Persist Control Center Google sessions with accurate grant/access explanations and an access recheck action.
- Harden Recovery Kit creation, export, cache validation, verification and restore against accidental overwrites and damaged files. A real Kit + circulation restore drill passed in isolated profiles.
- Add backed-up, transactional SQLite `user_version` migrations, rollback/downgrade protection, FTS5 and query-plan regression baselines.
- Upload catalogue snapshot records sequentially in sets of at most 50. Admin loads 25 records per page, bounds its temporary cache and clears it when the view closes. Student/access/roster directories use server cursors; local desk lists use bounded pages.
- Add rotating structured diagnostics with allowlisted fields, contribution/security policies, dependency/license inventories and a written app-level database-integrity decision.

## Required coordinated rollout

**Install the 1.0.10 clients and deploy the matching Student Portal and institution-generated Firestore rules in a maintenance window.** Earlier clients omit required audit/decision metadata and cannot continue privileged cloud writes under the new rules. Keep administrative/cloud writes paused until all clients and rules match; close old sessions and recheck Google grants. Installing this release does not automatically deploy rules or change institution data.

Before live use, verify separate Recovery Kit/circulation backups, reconcile any legacy duplicate accession numbers or active loans, and test request/cancel/approve/issue, audited deletion/restore and kiosk revocation with synthetic accounts. Use one authoritative circulation desk; snapshot sync does not merge concurrent desks.

See [rollout and known risks](https://github.com/NuclearGG/Tomeva/blob/v1.0.10/documentation/KNOWN_RISKS.md), [database integrity](https://github.com/NuclearGG/Tomeva/blob/v1.0.10/documentation/DATABASE_INTEGRITY.md), and [query-plan baselines](https://github.com/NuclearGG/Tomeva/blob/v1.0.10/documentation/QUERY_PLAN_BASELINES.md).

## Trust and platform status

This remains an **unsigned pilot release**. Signing is intentionally deferred and no publisher key/certificate was generated. GitHub HTTPS checksums detect changed package bytes; publisher authenticity requires an existing configured trust key. Control Center uses explicit download/install, verifies the installer again, and requires a recovery checkpoint before updating.

Windows 10/11 is the maintained line. Legacy builds use unsupported Electron 22; physical Windows 7/8/8.1 acceptance remains an operator check. Large-library hardware/quota benchmarks and institutional retention decisions remain deployment requirements.

## Verification and repository hygiene

136 application/native tests and 202 Firestore emulator/REST tests, desktop smoke and recovery checks, source/package comparisons and release checksums are release gates. See [release verification](https://github.com/NuclearGG/Tomeva/blob/v1.0.10/documentation/RELEASE_VERIFICATION.md) for the completed evidence and limits.

`.gitignore` now also excludes SQLite3 databases and WAL files, schema/migration/update checkpoints, encrypted kiosk credentials, diagnostic JSON lines and private installed-profile QA notes. Release packages remain in Git LFS. Published older installers are preserved.

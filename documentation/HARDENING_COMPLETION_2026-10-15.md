# Priority hardening — 15 October 2026

## Status

Implemented and verified in the working tree. These changes are **not deployed to the institution project or included in the published v1.0.9 installers**. This is a coordinated client/rules protocol change, not a claim that the running institution is already hardened. Published package files were left unchanged. Signing remains intentionally deferred for pilots; no publisher keys or certificates were generated.

## Completed changes

| Priority | Area | Implementation |
| --- | --- | --- |
| P0 | Request state machine | Pending → Approved/Declined/Issued; Approved → Issued/Declined; terminal Issued/Declined/Cancelled. Only the requester may cancel Pending. Decisions require bounded text, server time, ISO display time and truthful actor UID. |
| P0 | Student record deletion | Student/other-account/plain unaudited deletes are denied. Staff deletion commits an immutable before-image journal atomically. Students request removal; staff completes it after access/profile removal. Re-enrolled accounts can request removal again. |
| P0 | Circulation integrity | Indexed Unicode case-insensitive accession lookup and uniqueness; one active loan per copy; canonical references survive import; active copies cannot be damaged/freed/reissued; stale imported Issued state is reconciled against actual loans. |
| P1 | Administrative audit/recovery | Actor/time/target/before/after events, protected writes tied to their events, recent history UI, and restore without overwriting a current record or stealing an admission claim. Removal resolves current ownership inside its transaction. |
| P1 | Release/update policy | Clean-source/version/tag/SBOM publication gates; checksummed SBOM archive tied to its source commit; explicit operator-managed Control Center downloads/install; checksum recheck and checkpoint before installation; unsigned pilot trust labelled honestly. |
| P1 | IPC and kiosk credentials | Trusted local main-frame/lock checks, bounded IPC arguments/migration input and bursts, OS-encrypted project/workstation-bound atomic credential storage, and native backup writes outside the live application profile. |
| P2 | Bounded data views | Local 25-row catalogue/student/transaction/fine windows, FTS5 with maintained transactional indexes, indexed overdue queries; Admin catalogue/circulation lazy pages and bounded temporary cache; administrative directories use server cursors with 25 rows plus one lookahead. |
| P2 | Open-source hygiene | CONTRIBUTING, SECURITY policy, third-party notices, MIT package metadata, CycloneDX/license inventory generation and documented deployment/operational risks. |

Staff authorization retains a verified **current Google sign-in**, configured staff domain and active staff grant. Domain membership alone does not grant authority. Kiosk provisioning and appearance publishing retain their administrator grant requirements.

## Verification

- `npm test`: **124 tests passed**, including **26 native SQLite tests**. Coverage includes circulation/import regressions, Unicode accession variants, 10,000-book FTS/page fixture, IPC limits, credentials, exports, update checks and release policy.
- `npm run test:rules`: **190 Jest emulator tests plus 12 REST tests passed**, including generated institution rules, the transition matrix, decision metadata, unauthorized deletion, immutable events, recovery, password-provider rejection and four-record audited removal.
- All three apps' `test:desktop` passed. Specialized Admin catalogue and directory, Librarian import, and Control Center recovery desktop tests also passed.
- Admin directory UI: 5,000 synthetic records, 25-row DOM, cursor navigation, email prefix lookup, escaped text and private-row cleanup. This is a functional fixture, not a complete production hardware/quota benchmark.
- Actual Recovery Kit + Librarian restore drill passed using fresh disposable profiles and a read-only snapshot of the existing library: 102 books, 6 students, one active loan, one payment, returned-loan history and native checkpoint preserved. Live profiles were not changed. The Kit, circulation backup and password are stored in separate local locations under the user's LocalAppData; details are in the private drill report, not committed data.
- Control Center UI and Admin/Student bundles built successfully. Canonical rules, `firestore.txt` and Control Center template copies match.
- CycloneDX previews generated for Control Center (308 components), Admin (277) and Librarian/shared web SDK (646). Preview provenance correctly records dirty source; release SBOMs must be regenerated from the committed release source.
- The real release preflight rejected this dirty development tree as intended. No release upload/publication was attempted.

## Coordinated rollout before live use

1. Take and verify separate Recovery Kit and circulation backups. Check existing accession aliases and duplicate active loans; resolve conflicts from reviewed records before enabling circulation. New indexes intentionally refuse conflicting data rather than discard records.
2. Prepare a new release version and committed source. Build all affected clients, generate the clean-source SBOM/archive, verify packages/checksums and pass the release gate. Keep the pilot trust status visible if signing is still deferred.
3. Schedule a short maintenance window for administrative/cloud writes. Install the new Control Center, Admin and Librarian clients, prepare the new Student Portal, and close older sessions. Hold their cloud workflows until the matching rules and portal are ready.
4. Generate rules for the configured institution, deploy the matching portal/rules together, then restart clients and recheck grants with a current Google session. Reactivate kiosks whose old credentials used unscoped storage. The old clients omit required audit/decision fields and must not remain in privileged use.
5. Re-verify unauthenticated public catalogue access, denial of private circulation/kiosk reads, student request/cancel, staff approve/issue, audited access removal/restore, account-removal completion and kiosk revocation using synthetic accounts. Resume real student requests/data/circulation only after these deployment checks pass.

## Limits requiring operator decisions

See [known risks](KNOWN_RISKS.md). One authoritative circulation desk remains required; snapshots do not merge concurrent desks. Set retention for restricted audit/recovery copies. Directory search uses indexed email/admission prefixes; local FTS uses words/prefixes. Bounded pages replace unlimited DOM lists; there is no infinite-scroll recycler. Snapshot construction still holds the publication in memory. Large-institution quota, latency, disk and supported-hardware benchmarks, publisher signing, upstream license review and independent security review remain distribution/deployment gates.

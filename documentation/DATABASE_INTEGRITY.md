# SQLite integrity decision and schema upgrades

Decision date: 16 October 2026. Scope: the Librarian SQLite store and its main-process service.

## Decision: app-level relationships, not blanket foreign keys

The current JSON-backed tables intentionally **do not declare FOREIGN KEY constraints**. `PRAGMA foreign_keys = ON` is defensive configuration for future constraints; it does not enforce relationships that have not been declared.

Completed circulation history may outlive a deleted student or a catalogue replacement that omits a retired copy. Staff loans have no student parent. Imports replace catalogue/student lists inside a transaction; a restrictive immediate FK would reject the temporary replacement, and cascading deletion would erase history and financial evidence. Preserving these behaviors requires conditional relationships and explicit retention rules. A future relational redesign must define archived parents, teacher borrowers and deferrable replacement semantics before introducing FKs.

### Invariants and enforcement

| Relationship | Required behavior and enforcement |
| --- | --- |
| Active loan → book | The service requires an existing Available copy before issue and makes it Issued atomically. Imports cannot omit an active copy. Native unique indexes enforce one active loan per Unicode lowercase accession key. Damage/restoration cannot free an active copy. |
| Active student loan → student | Issue resolves a current student and stores the canonical admission number. Individual deletion rejects active borrowers. Student replacement imports reject omitted active borrowers and preserve canonical admission numbers across case variants. Teacher loans are exempt from a student parent. |
| Completed loan → historical book/student | Missing parents are allowed after deliberate catalogue/roster replacement or student removal. Historical transactions are retained. Do not reuse a retired accession or admission number for a different identity. |
| Payment → transaction | Fine payment resolves the transaction in the service; backup validation rejects an unknown transaction reference. Payment/loan mutations and undo use the same database transaction. There is no cascade deletion. |
| Issued state ↔ active loan | Service status changes, imports and backup validation check the graph. Import repairs stale Issued flags and legacy accession case aliases; imported flags cannot invent a loan. Legacy inconsistent statuses must be reviewed or closed through supported workflows. |
| Backup graph | The checksummed backup decoder validates active book/student references, active-loan uniqueness, payment references and statuses before restore writes. Historical missing book/student parents remain permitted. |

`main/library-service.js` owns public mutations; `main/db-ipc.js` exposes an explicit method allowlist to the trusted unlocked local frame. Imports and restore commit or roll back as a unit, including FTS, undo settings and the audit outbox. Direct SQL and `store.collections` are trusted internal APIs used by migrations/tests, **not an integrity-enforcing public API**. Firebase rules do not enforce local SQLite relationships.

This decision does not certify arbitrary existing databases. Legacy migration preserves original bytes and does not silently delete or fabricate conflicting history. Uniqueness conflicts stop an upgrade, retain a backup and require reconciliation. A startup schema check is not a complete business-data audit; validate an application backup and review legacy inconsistencies before live circulation. Direct edits by SQLite tools, OS-user malware, same-user file tampering and concurrent independent desks are outside this app-level guarantee.

## `user_version` migration harness

`main/schema-migrations.js` applies a consecutive ordered migration list. The database's `PRAGMA user_version` is independent of the JSON backup format's schema version and the old browser-to-SQLite `migration_state` marker.

| Version | Migration |
| --- | --- |
| 0 | Existing unversioned SQLite profiles, or a new empty database. |
| 1 | Core JSON tables, audit outbox, generated lookup columns, circulation/Unicode uniqueness and lookup indexes. Existing unversioned tables are adopted idempotently. |
| 2 | Book/student FTS5 tables, transactional maintenance triggers and initial index population. |
| 3 | Index for ordered student page windows. |

Before upgrading a nonempty database, `VACUUM INTO` creates a consistent copy, including committed WAL data, under `userData/schema-backups/`. The file is flushed before any upgrade write. Backup failure stops the upgrade. All outstanding schema steps, data changes and version increments run in one immediate SQLite transaction. Any failure rolls everything back. A current profile does not rerun upgrades or create another upgrade backup. A newer schema is rejected before changing journal settings; downgrades are not attempted.

Migration copies include personal data and must remain restricted to the workstation owner. They are rollback checkpoints, not a substitute for separately stored circulation backups. Review their retention rather than automatically deleting the only pre-upgrade copy. For recovery, close Tomeva and restore the pre-upgrade checkpoint into a separate profile for inspection; never copy a SQLite file over an open WAL database.

Append future migrations; do not edit a version already shipped. The tests cover fresh/unversioned adoption, FTS rebuilding, idempotent reopen, backup failure, multi-step DDL/data/FTS rollback, version preservation, and future-schema refusal.

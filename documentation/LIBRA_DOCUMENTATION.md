# Tomeva technical architecture

Release reference: **v1.0.10**, updated 16 October 2026.

Open the [visual architecture webpage](https://nucleargg.github.io/Tomeva/architecture.html) for the system map, application trust boundaries, request workflow, setup and recovery. It uses the current Tomeva catalogue-slip interface language. The page lives under the project website’s `/web` source directory and is intentionally absent from its navigation and sitemap; `noindex` discourages indexing. It is a public page, not an access-controlled resource.

This document replaces the earlier three-interface Libra/LokiJS prototype description. These are source capabilities; an institution must deploy matching clients, rules and grants before relying on them.

## Applications and authority

| Application | Runtime | Authority and data |
| --- | --- | --- |
| Control Center | Electron desktop | Institution configuration, separate verified package downloads, generated deployment files, appearance settings and encrypted configuration Recovery Kits |
| Librarian | Electron desktop | The single authoritative SQLite circulation desk: books, borrowers, loans, returns, fines, backups and protected synchronization |
| Admin | Electron desktop | Granted staff manage roster/access, kiosks, update approvals and recoverable administrative changes; reads synchronized circulation |
| Student Portal | Institution-hosted static HTTPS site | Authorized readers browse the catalogue, submit their own requests/messages and manage their account |

Each institution owns its Firebase project, accounts, data and portal hosting. The public Tomeva website (`web/`) is separate from the institution’s Student Portal.

## Local circulation and cloud snapshots

The Librarian renderer calls an allowlisted preload IPC surface. The main process checks the trusted frame, workstation unlock and input limits before the library service applies transactional changes to SQLite/WAL. Schema migrations use `PRAGMA user_version` (current version 3), pre-migration backups, atomic rollback and refusal of newer schemas. FTS5 and indexed queries support 25-row result windows.

Relationship integrity is enforced in the application layer for the JSON record tables, rather than through SQL foreign keys. This preserves archived history and the supported borrower types. Canonical accession matching, one active loan per copy, loan-safe imports and damage transitions are checked by the library service. See the [integrity decision](DATABASE_INTEGRITY.md).

A durable outbox supports synchronization. Public catalogue shards are separate from protected circulation shards. Shards contain at most 50 rows and bounded writes run sequentially; a new manifest is published after staging. Admin snapshot viewers read 25 records at a time and retain at most four shards in memory, clearing that cache on close or sign-out. Directory reads use server cursors.

**Independent circulation desks do not merge.** Snapshot publication is last-writer-wins. Use one authoritative desk and follow the [desk transfer procedure](SINGLE_DESK_CIRCULATION.md). Snapshot construction still holds the full dataset in memory.

## Identity and administrative changes

- Staff access requires a verified current Google provider, the configured staff email domain and an active `staff_accounts/{lowercase-email}` record.
- Library administration additionally requires an enabled `kiosk_admins/{uid}` grant for that library. An email-domain match alone does not grant administrative authority.
- Librarian cloud access uses an active library-bound `kiosk_accounts/{uid}` identity. Workstation credentials use operating-system protection; daily circulation uses the local PIN.
- Protected administrative writes atomically record target changes, immutable `admin_audit` events (actor, server time, before/after) and audit heads. Recovery checks current records and admission claims before restoring deleted data.
- Students request account removal; staff remove the protected student records and mark completion before the user deletes their own Firebase Auth account. Institutional history and archive retention remain a separate policy.

## Requests are distinct from loans

The portal uses a 10-hour session. Each UID may submit **100 book requests in a 10-hour window**. A Firestore transaction writes the request and quota increment together; rules validate the count and window. This caps book requests, not all asset loads or catalogue reads.

Allowed transitions:

- `Pending → Approved`, `Declined` or `Issued`.
- `Approved → Issued` or `Declined`.
- The owner may cancel a `Pending` request.
- `Issued`, `Declined` and `Cancelled` are terminal.

Decisions validate actor UID, server timestamp and a bounded note. Circulation decisions remain the desk’s responsibility. Deploy matching portal and rules together.

## Configuration, appearance and distribution

Control Center downloads separate applications from GitHub Releases, verifies SHA-256 and size, then generates configured handoff folders and the institution’s portal bundle/rules. Generated rules require explicit deployment.

Authorized administrators publish revisioned appearance properties at `libraries/main/public/appearance`: optional brand colours, surfaces, typography, spacing, corners, library heading and notice. Apps receive supported property changes through Firebase listeners and cache the last settings offline; these changes require no package download.

Control Center’s stable updater requires an explicit operator action, re-verification and a recovery checkpoint. Admin/Librarian update approvals are institution policy. **Signing is intentionally deferred for unsigned development/pilot releases.** Checksums detect changes relative to the manifest but do not independently authenticate the publisher. Trust-key support is available for future signature enforcement; no publisher key is generated automatically.

## Recovery boundaries

An encrypted Recovery Kit restores institution configuration, **not circulation data**. Keep its password separately. Store checksummed Librarian circulation backups and native SQLite checkpoints apart from Kits; validate the loan graph during restore. A replacement workstation requires kiosk credential activation. Follow the desk transfer procedure before resuming writes.

Legacy Windows builds use Electron 22, an unsupported runtime. Prefer the maintained Windows build when the operating system supports it.

## Source map

- `Librarian's End/firestore.rules`: canonical security rules; Control Center ships a matching template and substitutes institution configuration.
- `Librarian's End/main/library-service.js` and `main/sqlite-store.js`: circulation integrity, persistence and migrations.
- `Librarian's End/preload.js`: renderer IPC boundary.
- `Admin's End/`: administration UI, paged reads, protected writes and audit recovery.
- `Control Center/`: setup, package verification, appearance, recovery and distribution.
- `Student Search/search.html` and `Control Center/web-template/search.html`: matching institution portal sources.
- `desktop-integration/interface/workspace.css`: shared desktop interface tokens and catalogue-slip patterns.
- [Visual architecture webpage](https://nucleargg.github.io/Tomeva/architecture.html): canonical visual reference; old documentation HTML URLs forward here.

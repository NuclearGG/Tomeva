# Changelog

## 2026-09-30

- Synced staff-approved portal students into the local SQLite roster by email or
  admission number, resolving older approvals through portal login profiles.
  New local records now require the student's actual admission number.
- Added an offline workstation PIN lock with configurable idle timeout, a quick
  keyboard shortcut, startup lock persistence, and main-process database gating.
- Removed the production Reload menu item alongside DevTools.

## 2026-09-29

- Split cloud sync into a public availability catalog and staff-only circulation;
  public and legacy documents now replace older content so borrower fields are
  removed on the next successful sync. Updated rules and emulator tests guard the
  public schema and restrict legacy reads during transition.
- Centered the Admin kiosk credential dialog with a fixed backdrop, constrained
  height, keyboard focus handling, and Escape dismissal.
- Completed Prompt 5: SQLite in Electron main, WAL mode, narrow IPC bridge and
  compatible synchronous LibraryDB methods.
- Added backed-up, transactional and verified legacy localStorage migration with
  safe retry after interrupted cleanup and a completion notice.
- Added atomic imports and restores, rollback checks and offline desktop tests.
- Preserved student email data and corrected return/teacher undo handling and
  duplicate fine-payment recording while moving circulation into main.
- Loaded Firebase SDKs locally for offline startup; removed the LokiJS CDN.
- Added single-instance handling, explicit renderer sandboxing and native SQLite
  install verification. Packaging includes application files and production dependencies.

Full CSP extraction and the remaining Prompt 12 hardening work are separate tasks.

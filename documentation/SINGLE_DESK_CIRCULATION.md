# Circulation policy: one authoritative desk

Tomeva currently supports **one active circulation workstation per library**. Multiple Admin dashboards and Student Portal clients are supported. Each Librarian installation has its own SQLite database; cloud snapshots are a dashboard publication mechanism and do not merge independent loans, returns, fine payments, or inventory edits. Registering two kiosks does not make concurrent circulation safe.

## Daily use

1. Name the institution's authoritative Librarian computer and responsible operator.
2. Perform all circulation, catalogue replacement imports, and fine collection there, including offline work.
3. Keep other Librarian installations closed or their kiosk grants revoked. Use Admin for remote read-only circulation review.
4. Back up circulation after each workday and before imports, restores, or a desk transfer. Keep the latest off-computer copy separately from the Control Center Recovery Kit. Store the kit password in a separate institution-controlled location.
5. Imports accept JSON up to 2 MiB and 1,000 rows. They replace a list; they are not append batches. Books publish to Firebase in sequential groups of at most 50 records. Admin displays 25 records at a time and removes its temporary row cache when that view closes, on sign-out, or on window close.

## Transfer the desk

1. Stop circulation at the old desk and finish outstanding work. Export a fresh Librarian circulation backup using its Backup command. Do not copy only a live SQLite main file because WAL changes may be pending.
2. Record the backup time and counts of books, students, active loans, and fine payments. Verify its checksum/restore preview.
3. Close the old Librarian app and revoke its kiosk credential in Admin. Do not resume it after transfer.
4. Configure the replacement computer for the same institution. Restore the circulation backup there while offline. A Control Center Kit alone cannot restore loans or fine history.
5. Compare the restored counts and sample active loans, returns, and payments before taking new circulation transactions. Restore creates a local SQLite checkpoint before replacing data.
6. Activate only the replacement kiosk, reconnect, and perform one manual sync. Check Admin's generation/time and records, then resume circulation.

If two desks have already diverged, stop both, back up both independently, and reconcile records under an institution operator's supervision. Do not alternate their Sync buttons: the last published manifest wins and no automatic reconciliation occurs.

This is an operational restriction, not a distributed lock. Tomeva does not currently prevent a separately provisioned second computer from circulating offline.

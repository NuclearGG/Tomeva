# SQLite query-plan baselines

`main/query-plans.js` defines the structural baseline queries. `npm --prefix "Librarian's End" run test:sqlite` checks their access paths and writes `Librarian's End/test-artifacts/query-plans.json` using the 10,000-book fixture. That ignored artifact records SQLite/Node versions and the actual EXPLAIN details; it contains synthetic data only.

| Query | Required access path |
| --- | --- |
| Canonical accession lookup | `books_access_fold` |
| Active copy lookup | `transactions_book_fold_status` |
| Overdue loans, ordered by due date | `transactions_overdue` |
| Student active-loan counts | `transactions_student_status` |
| Ordered catalogue window | `books_access_nocase` |
| Ordered student window | `students_adm_page` |
| Catalogue FTS | `books_fts VIRTUAL TABLE INDEX`, then integer primary-key lookup |
| Pending fine window | `transactions_overdue` status prefix |

Catalogue, student and overdue ordered windows must not introduce a temporary sort. FTS result ordering and pending-fine ordering currently use a temporary B-tree; those are recorded, not hidden by the baseline. Fine totals intentionally aggregate their ledger, and OFFSET/count operations can grow with depth/size. These baselines are access-path regression checks, not a promise of constant-time search, a general prohibition on index scans, or a production latency benchmark.

Tests assert access paths rather than SQLite instruction IDs or elapsed milliseconds. If a dependency upgrade chooses a different plan, inspect its correctness, index use, sort work and representative sizes before updating the baseline. Do not weaken an assertion merely to accept a table scan. Larger datasets and real deployment hardware/quotas still require capacity measurements.

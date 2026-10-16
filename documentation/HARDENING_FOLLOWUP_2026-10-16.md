# Integrity and rendering follow-up — 16 October 2026

## Implemented locally

- Written [app-level integrity decision](DATABASE_INTEGRITY.md), including explicit absence of physical FKs, conditional active/history relationships, teacher loans, payment references, service boundaries and legacy-data limits.
- Transactional `user_version` schema harness with pre-upgrade flushed SQLite backups, ordered versions, FTS population, rollback and downgrade refusal. JSON backup versions remain separate.
- Book import compares active accession keys case-insensitively, preserves canonical book IDs, and repairs legacy case aliases in transaction references atomically. An omitted active copy leaves the original catalogue intact.
- Student replacement also preserves canonical admission IDs and rejects removal of active borrowers.
- Portal status text is escaped, and catalogue CSS classes use fixed availability values. Admin monetary output accepts only finite nonnegative numeric amounts within the supported safe range; malformed values display `—`. Overdue day text is escaped too.
- The four primary app/portal CSPs explicitly deny objects and upgrade insecure resource requests; exported portal templates inherit this policy. The separate OAuth helper intentionally submits to a state-validated HTTP loopback callback: its restrictive object-denying CSP retains that explicit form destination and is not blindly given an upgrade directive that could require nonexistent loopback TLS.
- Three desktop mains use rotating structured JSON-line diagnostics with allowlisted fields. Raw error messages, arguments, tokens, passwords, URLs, paths, emails and record payloads are not diagnostic fields. Files rotate at 5 MiB with three older files retained. Logging failure does not change circulation results. The separately signed circulation audit remains restricted personal-data-bearing history with its own retention requirements; diagnostics do not replace it.
- [Query-plan baselines](QUERY_PLAN_BASELINES.md) cover eight hot access paths and record an actual 10,000-book plan artifact. Expected temporary sorts and scale limits are documented.

## Verification

`npm test` passed **135 tests**, including **32 native SQLite tests** and the new migration/import/query-plan, structured-logging, CSP and renderer validation regressions. All three desktop smoke tests passed, along with Admin catalogue and Control Center recovery UI checks. An actual Kit + circulation restore drill passed using disposable profiles after schema upgrades; live profiles were untouched.

The first Control Center desktop smoke hit its overall timeout while running alongside other desktop work. A traced rerun completed every export/navigation step successfully without changing production behavior or extending the deadline.

No rules deployment, release upload, signing-key generation or published-package replacement is part of this follow-up. The coordinated client/rules rollout described in [the previous report](HARDENING_COMPLETION_2026-10-15.md) is still required for the earlier security protocol changes.

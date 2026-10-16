# Security policy

## Reporting

Use the repository's private GitHub vulnerability-reporting channel when available: [Report a vulnerability](https://github.com/NuclearGG/Tomeva/security/advisories/new). If that feature is unavailable, ask the maintainer for a private reporting channel without posting exploit details, credentials, or student data in a public issue.

Include the affected version/commit, component, a synthetic reproduction, expected versus observed access, and whether rules, clients, or both are affected. Remove personal records and tokens from screenshots and logs. Do not test an institution's production Firebase project without its operator's authorization.

## Release status

Current 1.0.x packages are pilots. Security fixes are developed against the current source branch; older installers do not gain a source fix automatically. Review release-specific deployment instructions. This hardening batch changes the request-decision and administrative-audit protocols and requires coordinated updated clients and generated rules before using real student requests/data.

Unsigned pilots are intentionally supported. They verify package checksums from GitHub HTTPS, which detects corruption but does not provide independent publisher authenticity. Configured publisher keys require signatures with no unsigned fallback. No new signing keys or certificates are generated automatically. Broad signed distribution remains dependent on publisher-supplied trust material.

## Trust boundaries

- Each institution controls its Firebase project and IAM operators. Verified Google identity, configured domain and explicit staff/admin grants determine access. Students do not directly delete authorization or sign-in records; they submit removal requests for staff processing.
- Sensitive Admin changes require an immutable journal with matching before/after data in the same transaction. Recovery copies and audit history contain personal data and follow the institution's retention policy; removing an active profile does not erase historical audit copies.
- One Librarian desk is authoritative. Snapshots do not merge independent offline circulation databases. See the [desk-transfer procedure](documentation/SINGLE_DESK_CIRCULATION.md).
- The workstation PIN gates application access. It does not encrypt SQLite, FTS indexes or portable JSON backups and does not defend against a malicious OS administrator or another process running as the same OS user.
- Kiosk credentials use secure OS storage and are scoped to the current Firebase project and workstation. Firebase's renderer SDK needs access to the current kiosk credential while the desk is unlocked; renderer integrity and the OS account remain part of the trust model.
- Public catalogue/appearance reads remain public. Client batching/caching does not enforce a server-side read quota or prevent deliberate quota exhaustion.

See [known risks and rollout gates](documentation/KNOWN_RISKS.md). Passing the automated suite is evidence for its tested cases, not a claim that all deployments or threat models are covered.

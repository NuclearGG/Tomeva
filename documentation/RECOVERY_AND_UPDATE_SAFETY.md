# Recovery and updates

CC encrypts bootstrap settings into a password-protected Recovery Kit. Verification does not replace live settings. Restore and migrations create checkpoints; configuration changes mark old kits stale. Keep the password separately because Tomeva holds no recovery key.

Kits do not contain circulation records. Use Librarian's database backup command. Do not copy only a live SQLite main file while WAL writes may be pending.

Updates require a restart decision. CC creates a configuration checkpoint before installation. Admin and Librarian respect exact approved versions and paused/scheduled rollouts. Existing institution settings survive replacement. These checkpoints do not implement automatic binary rollback.

Tests cover encryption, tampering, wrong passwords, migration, approval, and isolated exports. Live institution authentication, hosting deployment, and operating-system installation prompts require separate acceptance checks.

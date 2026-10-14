# Tomeva 1.0.9 release verification

Verified on 14 October 2026 with isolated profiles and synthetic institution data.

## Passed

- 87 application tests covering Control Center setup/export/recovery, appearance validation, Admin sign-in/staff/roster, native SQLite circulation, kiosk access, synchronization, backup validation, local calendar calculations and release verification.
- Firestore emulator: 130 Jest rules tests plus 12 REST authorization tests. Includes appearance publishing permissions, administrator revocation, schema bounds and stale revision rejection.
- Source Electron smoke tests for Control Center, Admin and Librarian.
- 63 rendered interface views, plus custom appearance checks in all four apps. Includes local fonts, viewport containment, cached settings, project isolation, offline misses, unsupported schemas and plain-text notices.
- Modern Windows x64 and legacy Windows x64 installers for all three desktop applications, plus the Student Portal ZIP.
- Packaged modern startup smoke tests for all three apps, and legacy Admin and Librarian startup/circulation tests. An additional packaged Control Center test in Electron 22.3.27 verified Firebase appearance initialization with existing institution settings and brand-colour preview.
- 369 packaged source/asset comparisons, six desktop version checks, Student ZIP metadata and all 19 release asset SHA-256 checksums. Installer metadata also matches the corresponding SHA-512 digests.
- Git whitespace checks and ignore checks for generated bundles/assets, local tools, screenshots, databases, credentials and configuration backups.

Reproduce package comparisons with `node scripts/verify-built.cjs` after both Windows builds and Student ZIP generation. Other gates are `npm test`, `npm run test:rules`, `npm run test:desktop`, `npm run review:interface` and `npm run verify:packages`.

## Scope and rollout

This is an unsigned pilot release, as requested by the publisher. No production signing key was generated. The modern installers were checked as NotSigned; future publisher keys can enforce signatures through the existing update infrastructure.

Install the updated clients, deploy the Student Portal and publish the institution-generated Firestore rules once to enable live appearance settings. Subsequent supported appearance changes need no package downloads. No live institution settings were changed during verification.

Clean-machine installer acceptance, physical Windows 7/8/8.1 acceptance, a live institution Google login, production Firebase deployment, signed publishing, Linux packaging and macOS packaging remain outside these checks. Legacy Electron 22 no longer receives security fixes.

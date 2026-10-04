# Tomeva 1.0.5

## Users

Choose the Control Center installer for the destination operating system:

- **tomeva-control-center-1.0.5-win-x64.exe** for Windows 10/11 x64.
- **tomeva-control-center-1.0.5-win7-x64.exe** for Windows 7/8/8.1 x64 legacy computers.

Control Center now offers separate Windows 10/11 and Windows 7/8.1 package selections. Each line downloads matching Admin and Librarian installers and uses its own update metadata, preventing a legacy computer from receiving a modern-only runtime.

The legacy line uses Electron 22.3.27 and a compatible SQLite native build. Network operations include the compatibility layer required by its Node 16 runtime.

Electron 22 stopped receiving security fixes in October 2023. Use the legacy packages only where an operating-system upgrade is not yet possible. The modern Windows 10/11 packages remain the default.

This release includes both Windows x64 compatibility lines for all three desktop apps and the Student Portal ZIP. Linux and macOS binaries are not included.

## Developers

The legacy build runs from an isolated staging tree, pins Electron 22.3.27, and uses a Node 16-compatible SQLite dependency without changing the modern dependency lockfiles. `build-variant.json` keeps update feeds separated at runtime.

Clone the repository and run `git lfs pull` to download the installation packages alongside the complete source. See the root README for installation, tests, builds, and publishing commands. `packages/SHA256SUMS` records all committed package checksums.

## Verification

The full unit suite, all three modern Electron smoke suites, 112 Firestore rules tests, and 12 kiosk REST authorization tests passed. Modern and legacy package contents, SQLite startup, update metadata, and checksums were verified. Interactive installation on physical Windows 7/8.1 hardware remains an acceptance check. The installers are unsigned.

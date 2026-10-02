# Tomeva 1.0.0

## Users

Download **tomeva-control-center-1.0.0-win-x64.exe**. Control Center downloads Admin, Librarian, and the Student Portal and adds your institution configuration locally.

This release includes Windows x64 installers for all three desktop apps and the Student Portal ZIP. Linux and macOS binaries are not included in this release.

## Developers

Clone the repository and run `git lfs pull` to download the installation packages alongside the complete source. See the root README for installation, tests, builds, and publishing commands. `packages/SHA256SUMS` records all release asset checksums.

## Verification limits

Automated checks cover database operations, offline circulation, configuration, package downloads, recovery, authorization, and rules in a local emulator. Live institution Google sign-in, production Firebase deployment, and interactive installation on a clean Windows computer still need institution acceptance testing. The installers are unsigned.

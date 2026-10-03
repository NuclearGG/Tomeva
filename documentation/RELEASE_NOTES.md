# Tomeva 1.0.2

## Users

Download **tomeva-control-center-1.0.2-win-x64.exe**. Control Center downloads Admin, Librarian, and the Student Portal from this GitHub Release, verifies them, and adds your institution configuration locally. It has no local installer bundling path.

Admin now has a clearer desktop update approval workspace with release cards, current policy cards, automatic form filling, rollout timing, and explicit approval, pause, loading, and saving states.

The downloader falls back from the GitHub API to the public release page and `SHA256SUMS`, which fixes setup on networks where GitHub API access fails. A separately downloaded Admin or Librarian app can connect without a Tomeva login by entering the institution's deployed Student Portal URL.

This release includes Windows x64 installers for all three desktop apps and the Student Portal ZIP. Linux and macOS binaries are not included in this release.

## Developers

Clone the repository and run `git lfs pull` to download the installation packages alongside the complete source. See the root README for installation, tests, builds, and publishing commands. `packages/SHA256SUMS` records all release asset checksums.

## Verification limits

Automated checks cover database operations, offline circulation, configuration, package downloads, recovery, authorization, and rules in a local emulator. Live institution Google sign-in, production Firebase deployment, and interactive installation on a clean Windows computer still need institution acceptance testing. The installers are unsigned.

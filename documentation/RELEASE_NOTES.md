# Tomeva 1.0.4

## Users

Download **tomeva-control-center-1.0.4-win-x64.exe**. Control Center downloads the matching Admin, Librarian, and Student Portal packages from this GitHub Release, verifies them, and adds the institution configuration locally.

This release fixes the Admin **Check releases** action. The Admin installer now includes its release-discovery module inside `app.asar`, so the update approval screen can read the latest GitHub release without the `Cannot find module './release-discovery.js'` error.

The packaged Admin app was opened in an isolated profile and its release IPC was exercised after the build. The package contents were also inspected to confirm that `release-discovery.js` and `public-releases.json` are present.

Tomeva desktop apps support Windows 10 and 11 x64. Electron 22 was the final Electron release that ran on Windows 7, 8, and 8.1, and it reached end of support in October 2023. Tomeva stays on a maintained Electron line because the apps process staff authorization, student details, and circulation data.

This release includes Windows x64 installers for all three desktop apps and the Student Portal ZIP. Linux and macOS binaries are not included.

## Developers

The Admin now owns `release-discovery.js` within its application directory instead of asking electron-builder to copy a file from the Control Center directory. A focused unit test covers successful and failed GitHub release checks, and the Admin desktop smoke test invokes the same IPC used by the update approval UI.

Clone the repository and run `git lfs pull` to download the installation packages alongside the complete source. See the root README for installation, tests, builds, and publishing commands. `packages/SHA256SUMS` records all committed package checksums.

## Verification

The full unit suite, all three Electron smoke suites, 112 Firestore rules tests, and 12 kiosk REST authorization tests passed. All Windows installers and update metadata were rebuilt at 1.0.4 and their hashes were verified. Live institution Google sign-in and interactive installation on a clean Windows computer remain institution acceptance checks. The installers are unsigned.

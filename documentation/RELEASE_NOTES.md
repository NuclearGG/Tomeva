# Tomeva 1.0.9

## Downloads

Choose `tomeva-control-center-1.0.9-win-x64.exe` for Windows 10/11 x64 or `tomeva-control-center-1.0.9-win7-x64.exe` for Windows 7/8/8.1 x64. Control Center downloads the matching Admin and Librarian installers. The Student Portal is `tomeva-student-1.0.9.zip`.

## Institution appearance, managed from Control Center

- Toggle institution brand colours and choose a readable accent colour.
- Choose cool white or warm paper surfaces, Manrope/system/editorial typography, comfortable or compact spacing, and soft or crisp corners.
- Set a library display name, Student Portal heading and a public institution notice.
- Preview locally, publish through the institution's existing Firebase project, or restore Tomeva defaults.
- Connected apps receive changes live; offline apps keep their last received appearance. After this one-time client and rules rollout, these settings require no package downloads or Hosting redeployments.
- Only verified, explicitly granted institution administrators may publish. Versioned properties, bounded plain text, colour contrast checks and revision transactions protect the shared appearance.

## Four connected workspaces

Librarian, Admin, Control Center and Student Portal share a circulation-slip and catalogue identity, locally bundled fonts/icons, consistent controls and responsive layouts. The librarian desk prioritizes issue/return; Admin prioritizes collection state and actionable exceptions; Control Center guides institution setup; students get a search-focused catalogue with mobile improvements. Keyboard navigation and dialog focus handling are improved.

## Security and usability fixes

- Restrict renderer database IPC to explicitly allowed methods and restore missing student edit/delete bridge methods.
- Escape record fields and errors when rendering HTML; simplify duplicate circulation handlers.
- Validate backup fields, calendar dates and record relationships before restore.
- Use local calendar dates for circulation and fine calculations, including daylight-saving boundaries.
- Preserve canonical admission numbers when issuing books and normalize imported catalogue records.
- Show an honest working-locally state when cloud setup is absent.

## One-time deployment

Install the new desktop apps, deploy the new Student Portal and publish the institution-generated Firestore rules. Use the existing verified staff and enabled `kiosk_admins/{uid}` grant to publish appearance in Control Center. The existing hosted `admin-sign-in/` helper is used for Google sign-in. See [live appearance rollout](https://github.com/NuclearGG/Tomeva/blob/v1.0.9/documentation/LIVE_APPEARANCE.md).

No live institution configuration is changed by installing this release. Local circulation remains available independently of appearance connectivity.

## Signing and platform status

This is an **unsigned pilot release**. Release signing remains intentionally deferred; no publisher key has been generated. Downloads verify checksums from trusted GitHub HTTPS endpoints. Configuring an existing publisher key enables mandatory signature verification for future signed releases.

Windows 10/11 x64 is the maintained installer line. Windows 7/8/8.1 compatibility builds use Electron 22, which no longer receives security fixes. Physical legacy-machine acceptance and live institution deployment remain external checks.

## Repository hygiene

All application versions are 1.0.9. Generated renderer bundles, shared asset copies, test screenshots, local tools, databases, configuration backups and credentials are ignored. Canonical interface sources and their font/icon licenses are tracked. Release packages remain managed by Git LFS.

## Verification

87 application tests, 130 Firestore rules tests, 12 REST authorization tests, source and packaged desktop smoke checks, 63 rendered views, both Windows build lines, 369 packaged source/asset comparisons and all 19 release asset checksums passed. See [release verification](https://github.com/NuclearGG/Tomeva/blob/v1.0.9/documentation/RELEASE_VERIFICATION.md).

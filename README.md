# Tomeva

**Library management for schools, institutions, and small libraries.**

Tomeva combines an offline desktop circulation app, an online administration dashboard, and a student catalog. Each institution owns its Firebase project, data, accounts, and hosting. **Control Center (CC)** guides setup and downloads the other applications.

[Download Control Center](https://github.com/NuclearGG/Tomeva/releases/latest) · [User guide](#for-users) · [Developer guide](#for-developers) · [Installation packages](packages/)

## Applications

| Application | Who uses it | Purpose |
| --- | --- | --- |
| **Control Center** | Institution setup person | Configure Firebase, generate installation packages and rules, export the student site, manage recovery kits. |
| **Librarian** | Library desk staff | Manage books, students, loans, returns, fines, backups, and a local workstation PIN. Daily circulation works offline. |
| **Admin** | Authorized institution staff | Manage student access, provision/revoke kiosks, view synchronized information, and approve updates. Requires internet. |
| **Student Portal** | Students and teachers | Browse availability and submit requests through the institution's website. Cloud features require internet. |

## For users

### Download only Control Center

Open the [latest release](https://github.com/NuclearGG/Tomeva/releases/latest). Download **`tomeva-control-center-X.Y.Z-win-x64.exe`** for Windows 10/11, or **`tomeva-control-center-X.Y.Z-win7-x64.exe`** for a Windows 7/8.1 legacy computer. You do not need source code, Node.js, npm, Git, or separate manual downloads of Admin and Librarian.

Control Center contains only Control Center. When you request Admin, Librarian, or the Student Portal, it downloads that package from the official GitHub Release, verifies its SHA-256 checksum and size, and then adds the institution configuration to the exported folder. It first uses the GitHub API and automatically falls back to the public release page and `SHA256SUMS` if API access is unavailable. Application updates also come from GitHub Releases.

Windows downloads are separated by operating-system generation:

- **Windows 10/11 x64** (`win-x64`) is the default build and uses the maintained Electron line.
- **Windows 7/8/8.1 x64 legacy** (`win7-x64`) uses Electron 22, the final compatible runtime. Electron stopped security support for this line on October 10, 2023, so use it only where an operating-system upgrade is not yet possible. Legacy apps update only from the separate legacy feeds.

Choose the matching Windows line in Control Center. These labels describe operating-system compatibility; both current Windows packages target 64-bit processors. Linux packages, when provided, use `.AppImage`. macOS build scripts are available to developers, but CC does not currently distribute macOS packages. See Electron's [Windows 7/8/8.1 support notice](https://www.electronjs.org/blog/electron-22-0) and [end-of-support notice](https://www.electronjs.org/blog/electron-27-0).

Installers include Electron and application dependencies. Internet access is needed for initial downloads, Firebase setup, Admin sign-in, and synchronization. Librarian's local circulation remains available offline. Builds without a publisher signing certificate are unsigned.

### Set up your institution

1. **Create a Firebase project.** Register a web app, create Firestore, and enable Google, Anonymous, and Email/Password authentication.
2. **Configure CC.** Enter the Firebase web configuration and institution staff email domain. The Firebase Web API key is the public browser value under **Firebase Console → Project settings → Your apps → SDK setup**. For custom web hosting, enter the final HTTPS site URL.
3. **Publish generated rules.** Review and publish CC's `PASTE_IN_FIRESTORE_RULES.txt` in Firestore and create the included indexes. The repository's `staff.example` rules are a template.
4. **Generate the Student Portal package.** Host its `public` folder over HTTPS. Keep the `admin-sign-in` directory and add the hostname to Firebase Authentication's authorized domains.
5. **Generate Admin and Librarian packages in CC.** CC checks official downloads against their SHA-256 and size, then adds institution configuration locally. Copy each whole generated folder to its destination and keep `institution.json` beside the installer.
6. **Sign in to Admin.** Use a verified Google account in the configured staff domain. Create a kiosk credential and enter it in Librarian Settings for protected sync and request decisions.
7. **Back up.** Create and verify an encrypted CC Recovery Kit; store its password separately. Use Librarian's **Backup Database** command for circulation records.

In Admin → Student Access, staff can pre-register admission numbers from CSV or JSON. Only `adm_no` is required; name, email, class, section, and group are optional. Rows with email addresses can be authorized during import. Admission-only rows remain in a private staff roster and are highlighted when a student's sign-in profile matches. For Microsoft Access, export the table or query as CSV before importing it.

If Admin or Librarian was downloaded separately, open it and enter the institution's deployed Student Portal URL. The app reads `tomeva-institution.json` from that HTTPS site without a Tomeva login. This public file contains browser Firebase settings and the institution name/domain; it contains no password, token, service-account key, or library records.

Cloud Functions are not required. Firebase service quotas apply. The Firebase CLI is needed only if you choose CLI deployment; generated rules can be published through Firebase Console.

### Updates and recovery

- CC checks GitHub Releases for its own updates. Admin and Librarian download their approved versions from the same repository and follow the exact version, rollout time, and approved/paused policy set by staff in Admin.
- Installation preserves existing configuration. Use **Import institution setup** to intentionally change it.
- CC Recovery Kits contain bootstrap configuration, **not circulation records**. Keep Librarian backups separately.
- Export Student Portal updates through CC and redeploy them to your hosting.
- A failed export is marked `INCOMPLETE.txt`. Generate a fresh package before distributing it.

## For developers

### Download the whole project

Install **Git**, **Git LFS**, and **Node.js 22.12+** (Node 24 was used locally):

```sh
git lfs install
git clone https://github.com/NuclearGG/Tomeva.git
cd Tomeva
git lfs pull
npm run install:all
npm run verify:packages
```

`packages/` contains installers, the Student Portal archive, update metadata, and SHA-256 checksums. Large binaries use Git LFS. Use a clone with `git lfs pull` for the complete project; GitHub source ZIPs can contain LFS pointers instead of binaries.

`install:all` runs `npm ci` in each desktop application using committed lockfiles. `node_modules` and unpacked build output are generated locally; installation packages include runtime dependencies.

### Repository map

```text
Control Center/       Setup, downloads, recovery, and distribution
Admin's End/          Administration and browser sign-in helper
Librarian's End/      SQLite circulation, Firebase sync, rules, and tests
Student Search/       Student Portal source and assets
web/                  Public Tomeva website deployed through GitHub Pages
desktop-integration/  Shared institution import and update policy
scripts/              Project checks and release packaging
packages/             Installable software, update feeds, and checksums
documentation/        Architecture, setup, and verification notes
```

### Run from source

Run each command in its own terminal from the repository root:

```sh
npm --prefix "Control Center" start
npm --prefix "Admin's End" start
npm --prefix "Librarian's End" start
```

CC rebuilds its UI on startup. Edit `Control Center/src/renderer.js`, then run `npm --prefix "Control Center" run build:ui`. Configure development profiles through CC exports and each desktop's import menu. The student source starts unconfigured; use an institution-configured export for deployment.

### Tests and requirements

| Root command | Checks | Extra requirement |
| --- | --- | --- |
| `npm test` | CC distribution/recovery/configuration; Admin OAuth/staff; Librarian SQLite/kiosk/sync | Application dependencies |
| `npm run test:desktop` | Real Electron windows, isolated profiles, offline circulation, setup exports | Desktop session; Linux needs a display or Xvfb |
| `npm run test:rules` | Firestore authorization, privacy, revocation, update approval | Firebase CLI and Java 21+ on PATH |
| `npm run verify:packages` | Packaged files against `packages/SHA256SUMS` | Downloaded LFS files |

Install Firebase Tools with `npm install -g firebase-tools` for emulator testing. Tests use the isolated `demo-tomeva` project on port 8080 and do not deploy to an institution. On Linux without a desktop, use `xvfb-run -a` for Electron checks.

### Build and collect installers

Build on the target operating system. On Windows:

```sh
npm test
npm run test:desktop
npm run test:rules
npm run build:win
npm run build:legacy-win
npm run release:win
npm run release:legacy-win
npm run verify:packages
```

On Linux use `build:linux` and `release:linux`. macOS developers can run each application's `build:mac` on a Mac; those packages need separate verification and are outside CC's current platform selector.

All application versions must agree. Builds go to each application's `dist/`; the collector copies current assets to `packages/` and checks SHA-512 against Electron update metadata. The Student packager includes the catalog, Admin sign-in helper, rules template, and indexes. Institution settings are added only on the institution's computer.

### Publish a release

Use a matching `vX.Y.Z` GitHub Release and upload every collected package:

| Asset | Purpose |
| --- | --- |
| `tomeva-control-center-X.Y.Z-win-x64.exe` | Windows 10/11 user's initial download |
| `tomeva-admin-X.Y.Z-win-x64.exe` | Windows 10/11 Admin package downloaded by CC |
| `tomeva-librarian-X.Y.Z-win-x64.exe` | Windows 10/11 Librarian package downloaded by CC |
| `tomeva-control-center-X.Y.Z-win7-x64.exe` | Windows 7/8.1 legacy Control Center |
| `tomeva-admin-X.Y.Z-win7-x64.exe` | Windows 7/8.1 legacy Admin package |
| `tomeva-librarian-X.Y.Z-win7-x64.exe` | Windows 7/8.1 legacy Librarian package |
| `tomeva-student-X.Y.Z.zip` | Student site downloaded and configured by CC |
| `latest.yml`, `admin.yml`, `librarian.yml` | Windows 10/11 update feeds |
| `latest-legacy.yml`, `admin-legacy.yml`, `librarian-legacy.yml` | Windows 7/8.1 update feeds |
| `*.blockmap`, `SHA256SUMS` | Update data and integrity checks |

Linux filenames use `linux-x64.AppImage`; feed names end in `-linux.yml`. CC downloads components at runtime and never embeds the Admin or Librarian installers. It uses GitHub asset metadata when the API is available and the release's `SHA256SUMS` manifest as its public fallback. See [distribution architecture](documentation/SOFTWARE_DISTRIBUTION.md) and [verification notes](documentation/RELEASE_VERIFICATION.md).

### Publish the project website

The public static website lives in `web/`. The `.github/workflows/pages.yml` workflow publishes that directory without exposing the rest of the repository as website content. In **GitHub → Settings → Pages**, set **Source** to **GitHub Actions** once. After that, a push that changes `web/` deploys the site automatically. You can also run **Deploy website to GitHub Pages** manually from the Actions tab.

### Data and contributions

Librarian uses SQLite with WAL journaling in Electron's user-data directory. Use application backups while it is running. Public catalog data is separated from restricted circulation records. Never commit institution exports, Recovery Kits, service-account keys, OAuth secrets, or real library data.

Run relevant checks, rebuild affected packages, update checksums, and include source and current release artifacts with changes. Component READMEs describe implementation details.

## License

[MIT](LICENSE).

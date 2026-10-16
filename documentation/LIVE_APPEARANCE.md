# Institution appearance

Control Center → **Appearance** previews and publishes a shared visual identity.

## Customization list

| Setting | Choices / limits | Applies to |
| --- | --- | --- |
| Institution brand colours | On / off; off restores Tomeva indigo | All four apps |
| Brand accent | Hex colour; white button labels require at least 4.5:1 contrast | Actions, selection and circulation slip accents |
| Surface tone | Catalogue (cool white) / reading room (warm paper) | All four apps |
| Typography | Manrope / system sans / editorial serif headings | All four apps; no font downloads |
| Spacing | Comfortable / compact records; navigation retains 40 px minimum height | Tables, panels and navigation |
| Corner style | Soft / crisp | Panels, controls, catalogue entries and dialogs |
| Library display name | Optional, up to 120 characters; blank uses institution setup name | Institution labels; project identity stays unchanged |
| Student catalogue heading | Up to 100 characters; blank restores the built-in heading | Student Portal |
| Institution notice | Optional, up to 280 characters; plain text, public | Notice strip in the connected workspaces |

Success, warning and error colours keep their original meanings. The Tomeva mark stays recognizable. There is no remote HTML, custom CSS, script execution or downloadable font setting.

## One-time rollout

1. Install a release containing this implementation on the three desktop apps and deploy its Student Portal once. Existing v1.0.8 binaries do not contain the appearance listener.
2. For a project using the standard Tomeva rules, open Control Center → Firebase setup → Copy complete rules. Publish the generated rules in that institution’s Firestore project. The generated rules include the institution’s actual staff domain. For projects with additional custom rules, integrate the scoped `public/appearance` block without removing those rules. Never deploy the repository’s `staff.example` template directly.
3. Save the existing institution settings in Control Center. The hosted `admin-sign-in/` helper from the existing setup must be available for browser Google sign-in.
4. Open Appearance, sign in with an active staff Google account with an enabled `kiosk_admins/{uid}` grant for `main`, preview the choices and select **Publish appearance**.

After this rollout, the listed appearance changes need no package export, installer download, Hosting deployment or application restart. Offline apps receive the changes on reconnect. Apps must be open and connected to receive live changes. Adding a new customization capability or changing application code still requires a software update.

## Firebase properties and access

Uses the existing Cloud Firestore project and its realtime snapshot listeners, rather than a second database. Public document:

`libraries/main/public/appearance`

The document contains the versioned presentation fields above plus `revision`, server `updatedAt` and `updatedBy`. Public readers receive only this presentation data. Firestore rules require the existing active staff account, verified institution Google identity and enabled institution administrator grant for writes. Students, anonymous users and registered kiosks cannot publish. Deletes are denied; restore defaults publishes a new revision.

Control Center publishes with a transaction against the loaded revision. A concurrent change requires loading the published version before editing again. Google sign-in uses the same state-checked browser callback as Admin’s End. Control Center remembers its Firebase session locally on this computer across restarts and reconnects. Explicit sign-out clears the saved session and cancels a pending browser sign-in. Switching Firebase project, authentication settings, library or staff domain signs out of the previous institution. Editing a display name or site URL keeps the session. Restored sessions still require the current administrator grants before publishing.

Verify persistence with `npm --prefix "Control Center" run test:session:emulator` (requires Firebase CLI). This uses demo accounts and isolated profiles across three Electron processes; it checks reconnect, full restart, explicit sign-out and institution switching without accessing production accounts.

## Offline and failure behaviour

Each app caches validated public appearance locally, keyed by Firebase project and library. Startup uses the last received settings; invalid data or listener failures preserve that appearance. An offline cache miss does not erase known settings. Unconfirmed writes are never cached. Unsupported schemas are rejected. A server-confirmed missing document restores built-in defaults.

Previews are local until publication, and are not persisted as published settings. Publishing requires connectivity. Local circulation continues independently of appearance connectivity.

## Verification

- 87 application tests passed, including appearance validation and contrast cases.
- Firestore emulator: 130 Jest rules tests plus 12 REST tests passed, including appearance authorization, revocation, schema bounds and stale revisions.
- Desktop smoke checks cover all three apps; Control Center checks brand on/off, warm surfaces, reset and signed-out publishing protection.
- Source rendering checks cover 63 views, plus custom appearance screenshots in all four apps. Checks include cached settings, project isolation, offline misses, pending writes, unsupported schemas and plain-text rendering.

Reproduce with `npm test`, `npm run test:rules`, `npm run test:desktop` and `npm run review:interface`. The Firebase emulator uses synthetic accounts and a demo project. No live institution settings have been published by these checks.

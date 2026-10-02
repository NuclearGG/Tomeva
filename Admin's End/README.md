# Tomeva Admin

Electron dashboard for the online Firestore admin tools. The librarian desktop app remains independent and offline first.

## Google sign-in

**No Google OAuth client ID or client secret is required in the Admin app.** The former `server.js` is no longer used or shipped. Do not recreate it or add OAuth credentials to source files, environment variables, or installers for this flow. Firebase Authentication manages the Google provider configuration.

Setup still requires the institution's Firebase web configuration, Google sign-in enabled in Firebase Authentication, an authorized hosting domain, and the deployed browser sign-in helper described below. Users still sign in with their staff Google account.

The desktop app opens `https://YOUR_PROJECT_ID.web.app/admin-sign-in/` in the system browser. That page uses Firebase `signInWithPopup` with in-memory persistence. Firebase handles the Google provider credentials. A POST to `http://127.0.0.1:51734/auth-callback` returns the short-lived Google credential to the desktop. `oauth-flow.js` checks the exact browser origin, loopback host, and one-use CSRF state before passing it through Electron IPC to Firebase `signInWithCredential`. Tokens never appear in callback URLs or HTML responses. The web dashboard also uses Firebase `signInWithPopup`.

The old direct Google token exchange was removed because this OAuth client requires a client secret even when PKCE is supplied. A client secret must never be placed in this repository, an installer, or a renderer. Rotate the secret that appeared in earlier source and installers, and replace old installer copies.

The browser helper source is in `auth-hosting/public/admin-sign-in/`. Publish changes with `firebase deploy --only hosting --config firebase.auth.json --project YOUR_PROJECT_ID`. Its production origin must remain authorized in Firebase Authentication. The callback destination is fixed in `login.js`; keep its port synchronized with `oauth-flow.js`.

## Run and verify

```powershell
npm install
npm run test:oauth
npm start
```

Complete one live Google sign-in to verify the hosted helper and Firebase credential exchange. The automated tests cover the real local HTTP callback, origin and state rejection, invalid responses, timeout, and browser-launch recovery. They do not sign into a real Google account.

Before deploying Firestore rules, run `npm run test:rules` from `Librarian's End` with the Firestore emulator running. One way is `firebase emulators:exec --only firestore --project YOUR_PROJECT_ID 'npm run test:rules'`. Firebase Tools requires Java 21 or newer.

Build a Windows installer with `npm run build:win` (or use `build:mac` / `build:linux` on those systems). Builds go to `dist/`. The admin dashboard requires network access. DevTools are available only in development builds.

## Kiosk credentials

Use **Kiosk → Create credential** to generate a workstation email/password, and **Revoke** to remove its approval access. See [the setup guide](../documentation/KIOSK_CREDENTIALS.md) for the rules deployment.

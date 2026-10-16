import { initializeApp, deleteApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, signOut } from 'firebase/auth';

export function sessionScope(config) {
  return JSON.stringify([
    config.firebase.projectId, config.firebase.apiKey, config.firebase.authDomain,
    config.firebase.appId, config.libraryId || 'main', config.staffDomain.trim().toLowerCase(),
  ]);
}

export function openAppearanceSession(config) {
  // A stable institution-specific app name restores only that institution's
  // session from this Electron profile. Display name and web URL are cosmetic.
  const app = initializeApp(config.firebase, 'tomeva-control-appearance:' + encodeURIComponent(sessionScope(config)));
  const auth = initializeAuth(app, { persistence:[indexedDBLocalPersistence, browserLocalPersistence] });
  return { app, auth, config };
}

export async function closeAppearanceSession(session, nextConfig) {
  // Reconnect/reload preserves sign-in. Switching institutions clears the old
  // saved session so returning to it requires an intentional sign-in.
  if (!nextConfig || sessionScope(session.config) !== sessionScope(nextConfig)) await signOut(session.auth);
  await deleteApp(session.app);
}

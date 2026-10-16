import { openAppearanceSession, closeAppearanceSession } from '../../src/appearance-session.js';
import { connectAuthEmulator, signInAnonymously, signOut } from 'firebase/auth';

let active;
const config = project => ({
  firebase:{apiKey:'demo-session-key',projectId:project,authDomain:project+'.firebaseapp.com',appId:'1:123:web:session-fixture'},
  staffDomain:'school.example',libraryId:'main',institutionName:'Session fixture',
});
async function open(project, cosmetic = false) {
  const value = config(project);
  if (cosmetic) { value.institutionName = 'Renamed fixture'; value.webUrl = 'https://school.example/'; }
  if (active) await closeAppearanceSession(active,value);
  active = openAppearanceSession(value);
  connectAuthEmulator(active.auth,'http://127.0.0.1:9099',{disableWarnings:true});
  await active.auth.authStateReady();
  return active.auth.currentUser?.uid || null;
}
window.sessionTest = {
  open,
  async login() { return (await signInAnonymously(active.auth)).user.uid; },
  async logout() { await signOut(active.auth); },
};

// Local UI fixture. All Firebase operations below stay in memory.
const http = require('http');
const fs = require('fs');
const path = require('path');
const admin = path.resolve(__dirname, "../../Admin's End");
const mocks = `
export const inMemoryPersistence = {};
const adminUser = { uid: 'test-admin', email: 'admin@example.org', emailVerified: true, providerData: [{ providerId: 'google.com' }] };
const auth = { currentUser: adminUser };
const accounts = new Map();
const listeners = [];
export function initializeApp(options, name) { return { options, name }; }
export async function deleteApp() {}
export function getFirestore() { return {}; }
export function getAuth() { return auth; }
export function initializeAuth() { return {}; }
export class GoogleAuthProvider {}
export async function signOut() {}
export async function signInWithCredential() {}
export function onAuthStateChanged(_, cb) { queueMicrotask(() => cb(adminUser)); return () => {}; }
export function doc(_, ...parts) { return { path: parts.join('/') }; }
export const collection = doc;
export function where(...args) { return args; }
export function query(ref) { return ref; }
export function orderBy() {} export function limit() {}
export function serverTimestamp() { return new Date(); }
const snap = data => ({ exists: () => !!data, data: () => data });
export async function getDocFromServer() { return snap({ enabled: true, libraryId: 'main' }); }
export function onSnapshot(ref, cb) {
  if (ref.path.startsWith('kiosk_admins/')) queueMicrotask(() => cb(snap({ enabled: true, libraryId: 'main' })));
  else if (ref.path === 'kiosk_accounts') { listeners.push(cb); queueMicrotask(notify); }
  else if (ref.path === 'libraries/main' || ref.path.endsWith('/control') || ref.path.endsWith('/circulation')) queueMicrotask(() => cb(snap(null)));
  else queueMicrotask(() => cb({ docs: [], forEach() {}, docChanges() { return []; }, empty: true }));
  return () => {};
}
function notify() { listeners.forEach(cb => cb({ docs: [...accounts].map(([id, data]) => ({ id, data: () => data })) })); }
export async function createUserWithEmailAndPassword(_, email) { return { user: { uid: 'fixture-desk', email } }; }
export async function deleteUser() {}
export async function setDoc(ref, data) { accounts.set(ref.path.split('/').pop(), data); notify(); }
export async function updateDoc(ref, data) { const id = ref.path.split('/').pop(); accounts.set(id, { ...accounts.get(id), ...data }); notify(); }
export async function deleteDoc() {} export async function addDoc() {}
`;
http.createServer((req, res) => {
  const route = req.url.split('?')[0];
  if (route === '/mocks.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(mocks); return; }
  const file = route === '/' ? 'index.html' : route === '/kiosk-management.js' ? 'kiosk-management.js' : null;
  if (!file) { res.writeHead(404); res.end(); return; }
  let source = fs.readFileSync(path.join(admin, file), 'utf8');
  source = source.replace(/<link[^>]+https:\/\/fonts\.[^>]+>/g, '');
  source = source.replace(/https:\/\/www\.gstatic\.com\/firebasejs\/12\.13\.0\/firebase-[a-z]+\.js/g, '/mocks.js');
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(source);
}).listen(8765, '127.0.0.1', () => console.log('Mock Admin UI: http://127.0.0.1:8765'));

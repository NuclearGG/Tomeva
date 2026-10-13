'use strict';
// Operator-run migration. Dry-run by default; requires existing Admin SDK credentials.
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const { admissionKey } = require('../desktop-integration/admission-key.cjs');
const admin = createRequire(path.join(__dirname, "../Librarian's End/package.json"))('firebase-admin');
const projectId = process.argv.find(arg => arg.startsWith('--project='))?.slice(10);
const output = process.argv.find(arg => arg.startsWith('--backup='))?.slice(9);
if (!projectId) throw new Error('Pass --project=YOUR_INSTITUTION_PROJECT; uses existing Application Default Credentials.');
admin.initializeApp({ projectId, credential: admin.credential.applicationDefault() });
const db = admin.firestore(), library = db.doc('libraries/main');
async function migrate() {
  const collections = ['student_logins', 'authorized_students', 'admission_roster', 'adm_claims'];
  const snapshots = await Promise.all(collections.map(name => library.collection(name).get()));
  const rows = Object.fromEntries(snapshots.map((snapshot, index) => [collections[index], snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }))]));
  const claims = new Map();
  const byEmail = new Map();
  for (const table of collections) for (const row of rows[table]) {
    const email = String(row.data.email || (table === 'student_logins' || table === 'authorized_students' ? row.id : '')).trim().toLowerCase();
    const fallback = rows.student_logins.find(profile => profile.id === email)?.data;
    const admission = String(row.data.adm_no || fallback?.adm_no || '').trim();
    if (!email || !admission) continue;
    if (admission.length > 40) throw new Error('Invalid admission number in existing records: ' + admission);
    const key = admissionKey(admission), previous = claims.get(key);
    if (byEmail.has(email) && byEmail.get(email) !== key) throw new Error('Conflicting admission numbers require staff review for: ' + email);
    byEmail.set(email, key);
    if (previous && previous.email !== email) throw new Error('Conflicting admission number requires staff review: ' + admission);
    claims.set(key, { email, adm_no: admission });
  }
  console.log(JSON.stringify({ projectId, counts: Object.fromEntries(collections.map(name => [name, rows[name].length])), admissionClaims: claims.size, mode: process.argv.includes('--apply') ? 'apply' : 'dry-run' }));
  if (!process.argv.includes('--apply')) return;
  if (!output) throw new Error('--backup=ABSOLUTE_PATH outside the repository is required for --apply.');
  const target = path.resolve(output), root = path.resolve(__dirname, '..');
  if (!path.isAbsolute(output) || target === root || target.startsWith(root + path.sep)) throw new Error('Store the PII backup outside the repository.');
  fs.writeFileSync(target, JSON.stringify(rows, null, 2), { flag: 'wx', mode: 0o600 });
  for (const [key, claim] of claims) await db.runTransaction(async transaction => {
    const ref = library.collection('adm_claims').doc(key), current = await transaction.get(ref);
    if (current.exists && current.data().email !== claim.email) throw new Error('Admission ownership changed during migration.');
    transaction.set(ref, claim);
    const access = rows.authorized_students.find(row => row.id === claim.email);
    if (access && !access.data.adm_no) transaction.update(library.collection('authorized_students').doc(access.id), { adm_no: claim.adm_no });
  });
  console.log('Admission claims migrated. Staff and administrator grants are configured separately by the institution operator.');
}
migrate().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => admin.app().delete());

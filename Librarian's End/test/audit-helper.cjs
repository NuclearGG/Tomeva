// Exercise the production audit transaction implementation with compat test clients.
const fs = require('node:fs');
const path = require('node:path');
const box = { exports: {} };
new Function('module', 'globalThis', fs.readFileSync(path.join(__dirname, '../../desktop-integration/admin-audit.mjs'), 'utf8').replace('export function', 'function') + '\nmodule.exports = createAuditedFirestore;')(box, { crypto: require('node:crypto').webcrypto });
const protectedKinds = new Set(['meta', 'admission_roster', 'authorized_students', 'student_logins', 'adm_claims', 'update_approvals', 'kiosk_accounts', 'account_deletion_requests']);
function audited(db, uid, email) {
  const sdk = { doc: (_, ...parts) => db.doc(parts.join('/')), runTransaction: (_, fn) => db.runTransaction(transaction => fn({
    get: async ref => { const snapshot = await transaction.get(ref); return { exists: () => snapshot.exists, data: () => snapshot.data() }; },
    set: (...args) => transaction.set(...args), update: (...args) => transaction.update(...args), delete: (...args) => transaction.delete(...args),
  })), serverTimestamp: () => require('firebase/compat/app').default.firestore.FieldValue.serverTimestamp() };
  const writer = box.exports({ db, actor: () => ({ uid, email }), sdk });
  const protectedRef = ref => protectedKinds.has(ref.path.split('/').at(-2)) || ref.path === 'libraries/main/public/appearance';
  const native = ref => ref.__native || ref;
  function wrapRef(ref) { return new Proxy(ref, { get(target, key) {
    if (key === '__native') return target;
    if (key === 'collection') return name => wrapCollection(target.collection(name));
    if (protectedRef(target) && key === 'set') return (data, options) => writer.setDoc(target, data, options);
    if (protectedRef(target) && key === 'update') return data => writer.updateDoc(target, data);
    if (protectedRef(target) && key === 'delete') return () => writer.deleteDoc(target);
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } }); }
  function wrapCollection(ref) { return new Proxy(ref, { get(target, key) { if (key === 'doc') return id => wrapRef(target.doc(id)); const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } }); }
  return new Proxy(db, { get(target, key) {
    if (key === 'testUid') return uid;
    if (key === 'doc') return name => wrapRef(target.doc(name));
    if (key === 'collection') return name => wrapCollection(target.collection(name));
    if (key === 'batch') return () => {
      const operations = []; const batch = {};
      for (const method of ['set', 'update', 'delete']) batch[method] = (ref, ...args) => { operations.push([method, native(ref), args]); return batch; };
      batch.commit = () => writer.runTransaction(db, transaction => { for (const [method, ref, args] of operations) transaction[method](ref, ...args); });
      return batch;
    };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
}
module.exports = { audited };

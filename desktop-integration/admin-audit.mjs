// One immutable before/after event for every administrative document mutation.
// The SDK is injected so desktop clients share exactly the same transaction code.
export function createAuditedFirestore({ db, actor, sdk, libraryId = 'main' }) {
  async function runTransaction(_, action) {
    const user = actor();
    if (!user?.uid || !user.email) throw new Error('Sign in before changing institution records.');
    return sdk.runTransaction(db, async transaction => {
      const pending = new Map(), snapshots = new Map();
      const proxy = {
        async get(ref) { if (!snapshots.has(ref.path)) snapshots.set(ref.path, await transaction.get(ref)); return snapshots.get(ref.path); },
        set(ref, data, options) { pending.set(ref.path, { ref, data, options, operation: 'SET' }); return proxy; },
        update(ref, data) { if (Object.keys(data).some(key => key.includes('.'))) throw new Error('Nested field updates require a complete audited record.'); pending.set(ref.path, { ref, data, operation: 'UPDATE' }); return proxy; },
        delete(ref) { pending.set(ref.path, { ref, operation: 'DELETE' }); return proxy; },
      };
      const result = await action(proxy);
      if (pending.size > 4) throw new Error('Change at most four records per audited transaction.');
      for (const change of pending.values()) await proxy.get(change.ref);
      if (actor()?.uid !== user.uid) throw new Error('The signed-in administrator changed. Retry.');
      for (const change of pending.values()) {
        const { ref, data, options, operation } = change;
        const snapshot = snapshots.get(ref.path);
        const before = snapshot.exists() ? snapshot.data() : {};
        if (operation === 'DELETE' && !snapshot.exists()) continue;
        if (operation === 'UPDATE' && !snapshot.exists()) throw new Error('This record no longer exists.');
        const after = operation === 'DELETE' ? {} : operation === 'UPDATE' || options?.merge ? { ...before, ...data } : data;
        const parts = ref.path.split('/'), kind = parts.at(-2), documentId = parts.at(-1);
        const eventId = globalThis.crypto.randomUUID();
        const event = sdk.doc(db, 'libraries', libraryId, 'admin_audit', eventId);
        const head = sdk.doc(db, 'libraries', libraryId, 'audit_heads', kind + '--' + documentId);
        transaction.set(event, { actorUid: user.uid, actorEmail: user.email, target: ref.path, kind, documentId, operation, at: sdk.serverTimestamp(), before, after });
        transaction.set(head, { eventId, at: sdk.serverTimestamp() });
        if (operation === 'DELETE') transaction.delete(ref);
        else if (operation === 'UPDATE') transaction.update(ref, data);
        else if (options) transaction.set(ref, data, options);
        else transaction.set(ref, data);
      }
      return result;
    });
  }
  const setDoc = (ref, data, options) => runTransaction(db, transaction => transaction.set(ref, data, options));
  const updateDoc = (ref, data) => runTransaction(db, transaction => transaction.update(ref, data));
  const deleteDoc = ref => runTransaction(db, transaction => transaction.delete(ref));
  const addDoc = async (collection, data) => { const ref = sdk.doc(collection); await setDoc(ref, data); return ref; };
  return { runTransaction, setDoc, updateDoc, deleteDoc, addDoc };
}

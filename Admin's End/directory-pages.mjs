// One live 25-record window. Cursor history contains IDs, never prior records.
export function createDirectoryPager({ sdk, reference, receive, failure, enrich = async rows => rows }) {
  let stop = () => {}, epoch = 0, disposed = false, prefix = '', page = 0, cursors = [null];
  function load(nextPage = 0, search = prefix) {
    if (disposed) return;
    const normalized = String(search).trim().toLowerCase().slice(0, 128);
    if (normalized !== prefix) { prefix = normalized; cursors = [null]; nextPage = 0; }
    if (!Number.isInteger(nextPage) || nextPage < 0 || nextPage >= cursors.length) return;
    stop(); const ticket = ++epoch; page = nextPage;
    const clauses = [sdk.orderBy(sdk.documentId())];
    if (prefix) clauses.push(sdk.where(sdk.documentId(), '>=', prefix), sdk.where(sdk.documentId(), '<=', prefix + '\uf8ff'));
    if (cursors[page]) clauses.push(sdk.startAfter(cursors[page]));
    clauses.push(sdk.limit(26));
    stop = sdk.onSnapshot(sdk.query(reference, ...clauses), async snapshot => {
      try {
        const docs = snapshot.docs.slice(0, 25), hasMore = snapshot.docs.length > 25;
        cursors.length = page + 1;
        if (hasMore) cursors.push(docs.at(-1).id);
        const rows = await enrich(docs.map(entry => ({ id: entry.id, ...entry.data() })));
        if (ticket === epoch && !disposed) receive({ rows, page, hasMore, prefix });
      } catch (error) { if (ticket === epoch && !disposed) failure(error); }
    }, error => { if (ticket === epoch && !disposed) failure(error); });
  }
  return { load, clear() { disposed = true; epoch++; stop(); cursors = []; } };
}

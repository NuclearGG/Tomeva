// Cache only a few cloud pages in memory. No localStorage or IndexedDB writes.
function decodeField(value) {
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeField);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, field]) => [key, decodeField(field)]));
  if ('integerValue' in value) return Number(value.integerValue);
  for (const key of ['stringValue', 'booleanValue', 'doubleValue', 'timestampValue']) if (key in value) return value[key];
  throw new Error('Unsupported catalogue field.');
}
// REST avoids leaving row copies in the Firestore SDK's internal document cache.
export async function fetchSnapshotPage({ projectId, apiKey, token, collection, generation, index, signal, request = fetch }) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/libraries/main/${collection}/${generation}-${index}?key=${encodeURIComponent(apiKey)}`;
  const response = await request(url, { signal, cache: 'no-store', headers: token ? { Authorization: 'Bearer ' + token } : {} });
  if (!response.ok) throw new Error(response.status === 403 || response.status === 401 ? 'Sign in with an authorized staff account to load circulation.' : 'Catalogue page unavailable. Retry after the next sync.');
  const text = await response.text();
  if (text.length > 2 * 1024 * 1024) throw new Error('Catalogue page is too large.');
  const data = JSON.parse(text);
  return Object.fromEntries(Object.entries(data.fields || {}).map(([key, value]) => [key, decodeField(value)]));
}
export function createSnapshotPager(fetchPage) {
  const cache = new Map();
  const cursors = new Map();
  let cursorScope = '';
  let epoch = 0;
  function clear() { epoch++; cache.clear(); cursors.clear(); cursorScope = ''; }
  async function read(manifest, key, page = 0, search = '') {
    if (!Number.isInteger(page) || page < 0) throw new Error('Invalid catalogue page.');
    const ticket = epoch;
    const check = () => { if (ticket !== epoch) throw new Error('Catalogue view closed.'); };
    const query = search.trim().toLowerCase();
    const matches = row => !query || Object.values(row).some(value => typeof value === 'string' && value.toLowerCase().includes(query));
    const scope = manifest.generation + ':' + key + ':' + query;
    if (scope !== cursorScope) { cursors.clear(); cursorScope = scope; }
    const cursor = cursors.get(page);
    const start = cursor ? 0 : page * 25, rows = [];
    let matched = 0;
    let nextCursor;
    function accept(items, index, offset = 0) {
      for (let position = offset; position < items.length; position++) if (matches(items[position])) {
        if (matched++ >= start) rows.push(items[position]);
        if (rows.length === 25) nextCursor = { index, offset: position + 1 };
        if (rows.length > 25) return true;
      }
      return false;
    }
    if (manifest.sync_version !== 7) {
      accept(manifest[key] || []);
    } else {
      if (!Number.isInteger(manifest.shard_count) || manifest.shard_count < 0 || manifest.shard_count > 5000 || !/^[a-z0-9-]{1,80}$/.test(manifest.generation)) throw new Error('Invalid catalogue manifest.');
      for (let index = cursor?.index || 0; index < manifest.shard_count; index++) {
        check();
        const cacheKey = manifest.generation + ':' + index;
        let shard = cache.get(cacheKey);
        if (!shard) {
          shard = await fetchPage(manifest.generation, index);
          check();
          if (!shard || shard.generation !== manifest.generation || shard.index !== index || !Array.isArray(shard[key]) || shard[key].length > 200) throw new Error('Catalogue page is incomplete. Retry after the next sync.');
        }
        cache.delete(cacheKey); cache.set(cacheKey, shard);
        if (cache.size > 4) cache.delete(cache.keys().next().value);
        if (accept(shard[key], index, cursor?.index === index ? cursor.offset : 0)) break;
      }
    }
    check();
    if (nextCursor && manifest.sync_version === 7) cursors.set(page + 1, nextCursor);
    return { rows: rows.slice(0, 25), hasMore: rows.length > 25, page };
  }
  return { read, clear, cancel() { epoch++; }, get cacheSize() { return cache.size; } };
}

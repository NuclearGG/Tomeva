import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotPager, fetchSnapshotPage } from '../snapshot-pages.mjs';
const manifest = { sync_version: 7, generation: 'page-test', shard_count: 6 };
const rows = Array.from({ length: 263 }, (_, index) => ({ book_id: 'B' + index, title: 'Title ' + index }));
const shard = index => ({ generation: manifest.generation, index, availableList: rows.slice(index * 50, (index + 1) * 50) });
test('Admin fetches on demand, renders 25, reuses pages, bounds cache and deletes it on completion', async () => {
  let reads = 0;
  const pager = createSnapshotPager(async (_, index) => { reads++; return shard(index); });
  assert.equal(reads, 0);
  const first = await pager.read(manifest, 'availableList');
  assert.deepEqual(first.rows, rows.slice(0, 25)); assert.equal(first.hasMore, true); assert.equal(reads, 1);
  assert.deepEqual((await pager.read(manifest, 'availableList', 1)).rows, rows.slice(25, 50));
  assert.equal(reads, 2, 'one extra shard establishes whether Next exists');
  await pager.read(manifest, 'availableList', 0); assert.equal(reads, 2);
  assert.deepEqual((await pager.read(manifest, 'availableList', 10)).rows, rows.slice(250));
  assert.ok(pager.cacheSize <= 4);
  pager.clear(); assert.equal(pager.cacheSize, 0);
});
test('search spans unloaded pages, and failed or superseded loads never populate a cleared cache', async () => {
  const pager = createSnapshotPager(async (_, index) => shard(index));
  const result = await pager.read(manifest, 'availableList', 0, 'Title 262');
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].book_id, 'B262');
  assert.equal(result.hasMore, false);
  const broken = createSnapshotPager(async () => null);
  await assert.rejects(broken.read(manifest, 'availableList'), /incomplete/);
  let finish;
  const late = createSnapshotPager(() => new Promise(resolve => { finish = resolve; }));
  const pending = late.read(manifest, 'availableList'); late.clear(); finish(shard(0));
  await assert.rejects(pending, /closed/); assert.equal(late.cacheSize, 0);
});
test('legacy snapshots are also limited to 25 rows per view', async () => {
  const pager = createSnapshotPager(() => { throw new Error('Legacy needs no shard reads'); });
  assert.equal((await pager.read({ availableList: rows }, 'availableList')).rows.length, 25);
  assert.equal((await pager.read({ availableList: rows }, 'availableList', 10)).hasMore, false);
});
test('page REST requests disable HTTP caching, carry staff authorization, and decode Firestore fields', async () => {
  let captured;
  const value = await fetchSnapshotPage({ projectId: 'demo-school', apiKey: 'public-key', token: 'fixture-token', collection: 'catalog_shards', generation: 'page-test', index: 0,
    request: async (url, options) => { captured = { url, options }; return { ok: true, text: async () => JSON.stringify({ fields: { generation: { stringValue: 'page-test' }, index: { integerValue: '0' }, availableList: { arrayValue: { values: [{ mapValue: { fields: { book_id: { stringValue: 'B0' } } } }] } } } }) }; },
  });
  assert.equal(captured.options.cache, 'no-store'); assert.equal(captured.options.headers.Authorization, 'Bearer fixture-token');
  assert.equal(value.index, 0); assert.equal(value.availableList[0].book_id, 'B0');
});
test('forward paging reads each shard only once even after older cached shards are evicted', async () => {
  const seen = [];
  const pager = createSnapshotPager(async (_, index) => { seen.push(index); return shard(index); });
  for (let page = 0; page < 11; page++) {
    assert.deepEqual((await pager.read(manifest, 'availableList', page)).rows, rows.slice(page * 25, page * 25 + 25));
  }
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5]);
});

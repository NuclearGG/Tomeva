const { test } = require('node:test');
const assert = require('node:assert/strict');
const { split, hydrate } = require('../js/cloud-shards');
test('large Unicode catalogs stay bounded and readers reject incomplete snapshots', async () => {
  const rows = Array.from({ length: 10000 }, (_, index) => ({ book_id: 'B' + index, title: 'अ'.repeat(200), author: '作'.repeat(100) }));
  const snapshot = split({ availableList: rows, issuedList: [], damagedList: [], stats: { total_books: rows.length } }, 'large-catalog');
  assert.ok(snapshot.shards.length > 1);
  for (const page of snapshot.shards) assert.ok(Buffer.byteLength(JSON.stringify(page)) < 500000);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot.manifest)) < 1000);
  await assert.rejects(hydrate(snapshot.manifest, async () => snapshot.shards.slice(1)), /incomplete/);
  let reads = 0;
  const value = await hydrate(snapshot.manifest, async () => { reads++; return snapshot.shards.slice(); });
  assert.deepEqual(value.availableList, rows);
  await hydrate(snapshot.manifest, async () => { reads++; return snapshot.shards.slice(); });
  assert.equal(reads, 1, 'reuse a complete generation without more shard reads');
});

/* Shared by the desktop writer and bundled web readers. */
(function(root) {
  'use strict';
  const cache = new Map();
  function split(payload, generation, restricted = false) {
    const keys = restricted ? ['overdueList', 'issuedList', 'finesList', 'recentCollections'] : ['availableList', 'issuedList', 'damagedList'];
    const shards = [];
    let page = Object.fromEntries(keys.map(key => [key, []]));
    let count = 0;
    const flush = () => { if (count) shards.push({ ...page, generation, index: shards.length }); page = Object.fromEntries(keys.map(key => [key, []])); count = 0; };
    for (const key of keys) for (const row of payload[key] || []) {
      // A conservative UTF-8 bound keeps every document far below 1 MiB.
      if (JSON.stringify(row).length * 3 > 16000) throw new Error('Oversized cloud row.');
      if (count >= 200 || JSON.stringify(page).length * 3 > 300000) flush();
      page[key].push(row); count++;
    }
    flush();
    if (shards.length > 5000) throw new Error('Cloud snapshot exceeds supported size.');
    const manifest = { stats: payload.stats, last_synced: payload.last_synced, last_synced_iso: payload.last_synced_iso, sync_version: 7, generation, shard_count: shards.length };
    return { shards, manifest };
  }
  async function hydrate(manifest, fetchShards, restricted = false) {
    if (manifest.sync_version !== 7) return manifest;
    if (!Number.isInteger(manifest.shard_count) || manifest.shard_count < 0 || manifest.shard_count > 5000) throw new Error('Invalid snapshot manifest.');
    const keys = restricted ? ['overdueList', 'issuedList', 'finesList', 'recentCollections'] : ['availableList', 'issuedList', 'damagedList'];
    const cacheKey = (restricted ? 'private:' : 'public:') + manifest.generation;
    if (!restricted && cache.has(cacheKey)) return { ...cache.get(cacheKey), ...manifest };
    if (!restricted) {
      try {
        const saved = JSON.parse(root.localStorage?.getItem('tomeva-public-catalog-cache') || 'null');
        if (saved?.generation === manifest.generation && Date.now() - saved.savedAt < 24 * 60 * 60 * 1000
          && keys.every(key => Array.isArray(saved.data[key]))
          && keys.reduce((count, key) => count + saved.data[key].length, 0) <= manifest.shard_count * 200) {
          cache.set(cacheKey, saved.data);
          return { ...saved.data, ...manifest };
        }
      } catch (error) { /* storage may be disabled or full */ }
    }
    const pages = manifest.shard_count ? await fetchShards(manifest.generation) : [];
    if (pages.length !== manifest.shard_count) throw new Error('Snapshot is incomplete. Try again after the next sync.');
    pages.sort((a, b) => a.index - b.index);
    const value = { ...manifest, ...Object.fromEntries(keys.map(key => [key, []])) };
    pages.forEach((page, index) => {
      if (page.generation !== manifest.generation || page.index !== index) throw new Error('Invalid snapshot page.');
      for (const key of keys) {
        if (!Array.isArray(page[key]) || page[key].length > 200) throw new Error('Invalid snapshot rows.');
        value[key].push(...page[key]);
      }
    });
    if (!restricted) {
      cache.set(cacheKey, value);
      if (cache.size > 4) cache.delete(cache.keys().next().value);
      try {
        const saved = JSON.stringify({ generation: manifest.generation, savedAt: Date.now(), data: value });
        if (saved.length < 4 * 1024 * 1024) root.localStorage?.setItem('tomeva-public-catalog-cache', saved);
      } catch (error) { /* storage may be disabled or full */ }
    }
    return value;
  }
  const api = { split, hydrate };
  root.TomevaCloudShards = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis === 'undefined' ? window : globalThis);

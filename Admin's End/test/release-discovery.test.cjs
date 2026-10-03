'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkDesktopReleases } = require('../release-discovery.js');

test('returns GitHub release details for both Admin components', async () => {
  const requested = [];
  const result = await checkDesktopReleases(
    { owner: 'NuclearGG', librarian: 'Tomeva', admin: 'Tomeva' },
    async url => {
      requested.push(url);
      return {
        ok: true,
        json: async () => ({ tag_name: 'v1.2.3', body: 'Approved release', published_at: '2026-10-04T00:00:00Z' }),
      };
    },
  );

  assert.equal(requested.length, 2);
  assert.deepEqual(result.admin, {
    state: 'current-release', version: '1.2.3', notes: 'Approved release', publishedAt: '2026-10-04T00:00:00Z',
  });
  assert.deepEqual(result.librarian, result.admin);
});

test('reports request failures without rejecting the Admin IPC call', async () => {
  const result = await checkDesktopReleases(
    { owner: 'NuclearGG', librarian: 'Tomeva', admin: 'Tomeva' },
    async () => { throw new Error('offline'); },
  );
  assert.deepEqual(result, {
    librarian: { state: 'error', message: 'offline' },
    admin: { state: 'error', message: 'offline' },
  });
});

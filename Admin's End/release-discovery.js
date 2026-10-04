'use strict';

const fs = require('node:fs');
const path = require('node:path');
const compatibleFetch = globalThis.fetch || require('node-fetch');

const COMPONENTS = ['librarian', 'admin'];
const validName = value => typeof value === 'string' && /^[A-Za-z0-9_.-]+$/.test(value);

function readChannels() {
  const file = path.join(__dirname, 'public-releases.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function checkDesktopReleases(channels = readChannels(), request = compatibleFetch) {
  const result = {};
  for (const component of COMPONENTS) {
    const owner = channels.owner;
    const repo = channels[component];
    if (!validName(owner) || !validName(repo)) {
      result[component] = { state: 'unconfigured' };
      continue;
    }

    try {
      const endpoint = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
      const response = await request(endpoint, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Tomeva-Admin' },
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`Release channel returned HTTP ${response.status}.`);
      const release = await response.json();
      result[component] = {
        state: 'current-release',
        version: String(release.tag_name || '').replace(/^v/, ''),
        notes: String(release.body || '').slice(0, 3000),
        publishedAt: release.published_at || '',
      };
    } catch (error) {
      result[component] = { state: 'error', message: error.message };
    }
  }
  return result;
}

module.exports = { readChannels, checkDesktopReleases };

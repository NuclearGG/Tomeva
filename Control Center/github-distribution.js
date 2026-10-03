'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const OWNER = 'NuclearGG';
const REPO = 'Tomeva';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const WEB = `https://github.com/${OWNER}/${REPO}`;
const hosts = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Tomeva-Control-Center' };

async function requestGitHub(url, { request = fetch, signal, headers: requestHeaders = {}, maxRedirects = 5 } = {}) {
  let current = url;
  for (let hops = 0; hops <= maxRedirects; hops++) {
    const parsed = new URL(current);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !hosts.has(parsed.hostname)) throw new Error('GitHub redirected outside its release service.');
    const response = await request(current, { headers: requestHeaders, redirect: 'manual', signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const next = response.headers.get('location');
    await response.body?.cancel();
    if (!next || hops === maxRedirects) throw new Error('GitHub returned an invalid release redirect.');
    current = new URL(next, current).href;
  }
}

async function latestReleaseFromWeb(request = fetch, signal) {
  const timeout = AbortSignal.timeout(15000);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await request(`${WEB}/releases/latest`, { headers: { 'User-Agent': headers['User-Agent'] }, redirect: 'manual', signal: abort });
  const location = response.headers.get('location');
  await response.body?.cancel();
  if (![301, 302, 303, 307, 308].includes(response.status) || !location) throw new Error(`GitHub release page returned HTTP ${response.status}.`);
  const target = new URL(location, WEB);
  const match = new RegExp(`^/${OWNER}/${REPO}/releases/tag/(v\\d+\\.\\d+\\.\\d+)$`).exec(target.pathname);
  if (target.protocol !== 'https:' || target.hostname !== 'github.com' || !match) throw new Error('GitHub returned unsupported release information.');
  const tag = match[1];
  const checksumUrl = `${WEB}/releases/download/${tag}/SHA256SUMS`;
  const checksumResponse = await requestGitHub(checksumUrl, { request, signal: abort, headers: { 'User-Agent': headers['User-Agent'] } });
  if (!checksumResponse.ok) throw new Error(`GitHub checksum download returned HTTP ${checksumResponse.status}.`);
  const checksumBytes = Buffer.from(await checksumResponse.arrayBuffer());
  if (!checksumBytes.length || checksumBytes.length > 128 * 1024) throw new Error('GitHub checksum manifest is empty or too large.');
  const assets = [];
  for (const line of checksumBytes.toString('utf8').trim().split(/\r?\n/)) {
    const entry = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
    if (!entry) throw new Error('GitHub checksum manifest is invalid.');
    const [, digest, name] = entry;
    assets.push({ name, size: null, digest: `sha256:${digest}`, browser_download_url: `${WEB}/releases/download/${tag}/${name}` });
  }
  return { tag_name: tag, assets, version: tag.slice(1), source: 'github-release-page' };
}
async function latestRelease(request = fetch, signal) {
  const timeout = AbortSignal.timeout(15000);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await request(`${API}/releases/latest`, { headers, redirect: 'error', signal: abort });
    if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}.`);
    const release = await response.json();
    if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name) || !Array.isArray(release.assets)) throw new Error('Unsupported official release metadata.');
    return { ...release, version: release.tag_name.slice(1), source: 'github-api' };
  } catch (apiError) {
    if (signal?.aborted) throw signal.reason || apiError;
    try { return await latestReleaseFromWeb(request, signal); }
    catch (webError) { throw new Error(`Could not read the official GitHub release. API: ${apiError.message} Release page: ${webError.message}`); }
  }
}
function selectAsset(release, component, platform = 'win', arch = 'x64') {
  if (!['librarian', 'admin', 'student'].includes(component) || !['win', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Unsupported application or platform.');
  const name = component === 'student' ? `tomeva-student-${release.version}.zip` : `tomeva-${component}-${release.version}-${platform}-${arch}.${platform === 'win' ? 'exe' : 'AppImage'}`;
  const matches = release.assets.filter(asset => asset.name === name);
  if (matches.length !== 1) throw new Error(`The official release does not contain ${name}. The publisher must provide this platform package.`);
  const asset = matches[0];
  const expected = `https://github.com/${OWNER}/${REPO}/releases/download/${release.tag_name}/${name}`;
  if (asset.browser_download_url !== expected || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') || (asset.size !== null && (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 2 * 1024 ** 3))) throw new Error('The release asset is missing trusted URL, size or SHA-256 metadata.');
  return asset;
}
async function downloadAsset(asset, directory, { request = fetch, signal, progress = () => {} } = {}) {
  if (!/^[a-zA-Z0-9._-]+$/.test(asset.name || '') || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') || (asset.size !== null && (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 2 * 1024 ** 3)) || !asset.browser_download_url?.startsWith(`https://github.com/${OWNER}/${REPO}/releases/download/v`)) throw new Error('Invalid official release asset.');
  const destination = path.join(directory, asset.name);
  const temporary = destination + '.' + crypto.randomUUID() + '.part';
  const timeout = AbortSignal.timeout(30 * 60 * 1000);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let handle;
  try {
    const response = await requestGitHub(asset.browser_download_url, { request, signal: abort });
    if (!response?.ok || !response.body) throw new Error(`GitHub asset download failed (${response?.status}).`);
    const headerSize = Number(response.headers.get('content-length'));
    const expectedSize = asset.size === null ? headerSize : asset.size;
    if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > 2 * 1024 ** 3) throw new Error('GitHub asset has no safe download size.');
    await fs.mkdir(directory, { recursive: true });
    handle = await fs.open(temporary, 'wx', 0o600);
    const hash = crypto.createHash('sha256');
    let received = 0;
    for await (const chunk of response.body) {
      abort.throwIfAborted();
      received += chunk.length;
      if (received > expectedSize) throw new Error('Download exceeds the published size.');
      hash.update(chunk);
      await handle.writeFile(chunk);
      progress({ state: 'downloading', name: asset.name, received, total: expectedSize, percent: Math.floor(received * 100 / expectedSize) });
    }
    if (received !== expectedSize || hash.digest('hex') !== asset.digest.slice(7).toLowerCase()) throw new Error('Package integrity verification failed. The download was discarded.');
    await handle.close(); handle = null;
    await fs.rename(temporary, destination);
    progress({ state: 'verified', name: asset.name, percent: 100 });
    return destination;
  } finally {
    await handle?.close();
    await fs.rm(temporary, { force: true });
  }
}
async function downloadPackage(component, platform, arch, directory, options = {}) {
  const release = options.release || await latestRelease(options.request, options.signal);
  const asset = selectAsset(release, component, platform, arch);
  const filename = await downloadAsset(asset, directory, options);
  await fs.writeFile(path.join(directory, 'software-origin.json'), JSON.stringify({ repository: `${OWNER}/${REPO}`, tag: release.tag_name, asset: asset.name, sha256: asset.digest.slice(7) }, null, 2));
  return { filename, version: release.version, release };
}
module.exports = { latestRelease, latestReleaseFromWeb, selectAsset, downloadAsset, downloadPackage, OWNER, REPO };

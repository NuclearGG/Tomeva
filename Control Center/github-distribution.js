'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const OWNER = 'NuclearGG';
const REPO = 'Tomeva';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const hosts = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Tomeva-Control-Center' };
async function latestRelease(request = fetch, signal) {
  const timeout = AbortSignal.timeout(15000);
  const response = await request(`${API}/releases/latest`, { headers, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (response.status === 404) throw new Error('No official release has been published yet. Please try again after the publisher releases Tomeva.');
  if (!response.ok) throw new Error(`GitHub release check failed (${response.status}). Please try again later.`);
  const release = await response.json();
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name) || !Array.isArray(release.assets)) throw new Error('Unsupported official release metadata.');
  return { ...release, version: release.tag_name.slice(1) };
}
function selectAsset(release, component, platform = 'win', arch = 'x64') {
  if (!['librarian', 'admin', 'student'].includes(component) || !['win', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Unsupported application or platform.');
  const name = component === 'student' ? `tomeva-student-${release.version}.zip` : `tomeva-${component}-${release.version}-${platform}-${arch}.${platform === 'win' ? 'exe' : 'AppImage'}`;
  const matches = release.assets.filter(asset => asset.name === name);
  if (matches.length !== 1) throw new Error(`The official release does not contain ${name}. The publisher must provide this platform package.`);
  const asset = matches[0];
  const expected = `https://github.com/${OWNER}/${REPO}/releases/download/${release.tag_name}/${name}`;
  if (asset.browser_download_url !== expected || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 2 * 1024 ** 3) throw new Error('The release asset is missing trusted URL, size or SHA-256 metadata.');
  return asset;
}
async function downloadAsset(asset, directory, { request = fetch, signal, progress = () => {} } = {}) {
  if (!/^[a-zA-Z0-9._-]+$/.test(asset.name || '') || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 2 * 1024 ** 3 || !asset.browser_download_url?.startsWith(`https://github.com/${OWNER}/${REPO}/releases/download/v`)) throw new Error('Invalid official release asset.');
  const destination = path.join(directory, asset.name);
  const temporary = destination + '.' + crypto.randomUUID() + '.part';
  const timeout = AbortSignal.timeout(30 * 60 * 1000);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let handle;
  try {
    let url = asset.browser_download_url;
    let response;
    for (let hops = 0; hops < 5; hops++) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !hosts.has(parsed.hostname)) throw new Error('Release download redirected outside GitHub.');
      response = await request(url, { redirect: 'manual', signal: abort });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const next = response.headers.get('location');
      await response.body?.cancel();
      if (!next) throw new Error('Invalid GitHub redirect.');
      url = new URL(next, url).href;
    }
    if (!response?.ok || !response.body) throw new Error(`GitHub asset download failed (${response?.status}).`);
    await fs.mkdir(directory, { recursive: true });
    handle = await fs.open(temporary, 'wx', 0o600);
    const hash = crypto.createHash('sha256');
    let received = 0;
    for await (const chunk of response.body) {
      abort.throwIfAborted();
      received += chunk.length;
      if (received > asset.size) throw new Error('Download exceeds the published size.');
      hash.update(chunk);
      await handle.writeFile(chunk);
      progress({ state: 'downloading', name: asset.name, received, total: asset.size, percent: Math.floor(received * 100 / asset.size) });
    }
    if (received !== asset.size || hash.digest('hex') !== asset.digest.slice(7).toLowerCase()) throw new Error('Package integrity verification failed. The download was discarded.');
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
module.exports = { latestRelease, selectAsset, downloadAsset, downloadPackage, OWNER, REPO };

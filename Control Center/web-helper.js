'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { app, dialog } = require('electron');
const { validateConfig: validateInstitution } = require('./config-store');
const compatibleFetch = globalThis.fetch || require('node-fetch');

const VERSION = require('./package.json').version;

function validateConfig(input) {
  const config = validateInstitution(input);
  return { ...config, version: VERSION };
}

async function exportWebPackage(window, rawConfig, options = {}) {
  return require('./setup-export').exportSetupBundle(window, rawConfig, 'student', 'win', options);
}

async function checkWebDeployment(rawUrl) {
  const url = new URL(String(rawUrl || ''));
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Enter an HTTPS Tomeva Web URL.');
  const manifest = new URL('tomeva-version.json', url.href.endsWith('/') ? url : new URL('.', url));
  const response = await compatibleFetch(manifest, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok) throw new Error(`Deployment returned HTTP ${response.status}.`);
  const data = await response.json();
  const available = (await require('./github-distribution').latestRelease()).version;
  if (!/^\d+\.\d+\.\d+$/.test(data.version)) throw new Error('Deployment has no valid Tomeva Web version.');
  const compare = (a, b) => {
    const left = a.split('.').map(Number), right = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
    return 0;
  };
  return { deployedVersion: data.version, availableVersion: available, updateAvailable: compare(available, data.version) > 0 };
}

module.exports = { exportWebPackage, checkWebDeployment, validateConfig, VERSION };

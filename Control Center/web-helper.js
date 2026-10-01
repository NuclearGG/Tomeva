'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { app, dialog } = require('electron');
const { validateConfig: validateInstitution } = require('./config-store');

const VERSION = '1.0.0';

function validateConfig(input) {
  const config = validateInstitution(input);
  return { ...config, version: VERSION };
}

async function exportWebPackage(window, rawConfig) {
  const config = validateConfig(rawConfig);
  const selection = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'], title: 'Choose an export folder' });
  if (selection.canceled) return { cancelled: true };
  const template = app.isPackaged
    ? path.join(__dirname, 'web-template')
    : path.join(__dirname, '..', 'Student Search');
  const name = `TomevaWeb-${VERSION}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const destination = path.join(selection.filePaths[0], name);
  await fs.mkdir(destination);
  for (const filename of ['search.html']) {
    await fs.copyFile(path.join(template, filename), path.join(destination, filename));
  }
  await fs.copyFile(path.join(template, 'search.html'), path.join(destination, 'index.html'));
  await fs.cp(path.join(template, 'assets'), path.join(destination, 'assets'), { recursive: true });
  await fs.writeFile(path.join(destination, 'tomeva-config.js'),
    'globalThis.TOMEVA_WEB_CONFIG = ' + JSON.stringify(config, null, 2).replace(/</g, '\\u003c') + ';\n');
  await fs.writeFile(path.join(destination, 'tomeva-version.json'), JSON.stringify({ version: VERSION, projectId: config.firebase.projectId }) + '\n');
  return { path: destination, version: VERSION };
}

async function checkWebDeployment(rawUrl) {
  const url = new URL(String(rawUrl || ''));
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Enter an HTTPS Tomeva Web URL.');
  const manifest = new URL('tomeva-version.json', url.href.endsWith('/') ? url : new URL('.', url));
  const response = await fetch(manifest, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok) throw new Error(`Deployment returned HTTP ${response.status}.`);
  const data = await response.json();
  if (!/^\d+\.\d+\.\d+$/.test(data.version)) throw new Error('Deployment has no valid Tomeva Web version.');
  const compare = (a, b) => {
    const left = a.split('.').map(Number), right = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
    return 0;
  };
  return { deployedVersion: data.version, availableVersion: VERSION, updateAvailable: compare(VERSION, data.version) > 0 };
}

module.exports = { exportWebPackage, checkWebDeployment, validateConfig, VERSION };

'use strict';

const MAX_PUBLIC_SETUP_BYTES = 32768;
const compatibleFetch = globalThis.fetch || require('node-fetch');

function combinedSignal(signal, timeout) {
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  const controller = new AbortController();
  const abort = source => controller.abort(source.reason);
  if (signal.aborted) abort(signal);
  else if (timeout.aborted) abort(timeout);
  else {
    signal.addEventListener('abort', () => abort(signal), { once: true });
    timeout.addEventListener('abort', () => abort(timeout), { once: true });
  }
  return controller.signal;
}

function resolvePublicSetupUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) throw new Error('Enter the institution Student Portal URL.');
  const input = new URL(value);
  if (input.protocol !== 'https:' || input.username || input.password) {
    throw new Error('The institution setup address must use HTTPS.');
  }
  input.hash = '';
  input.search = '';
  if (input.pathname.toLowerCase().endsWith('.json')) return input.href;
  if (input.pathname.split('/').pop().includes('.')) return new URL('tomeva-institution.json', input).href;
  if (!input.pathname.endsWith('/')) input.pathname += '/';
  return new URL('tomeva-institution.json', input).href;
}

async function downloadPublicSetup(rawUrl, { request = compatibleFetch, validate, signal } = {}) {
  if (typeof validate !== 'function') throw new Error('Institution validation is unavailable.');
  const url = resolvePublicSetupUrl(rawUrl);
  const timeout = AbortSignal.timeout(10000);
  const response = await request(url, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: combinedSignal(signal, timeout),
  });
  if (!response.ok) throw new Error(`Public institution setup returned HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_PUBLIC_SETUP_BYTES) throw new Error('Public institution setup is empty or too large.');
  let data;
  try { data = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Public institution setup is not valid JSON.'); }
  if (data?.schemaVersion !== 1) throw new Error('Public institution setup uses an unsupported format.');
  return { config: validate(data), url };
}

module.exports = { resolvePublicSetupUrl, downloadPublicSetup, MAX_PUBLIC_SETUP_BYTES };

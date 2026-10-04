'use strict';
const compatibleFetch = globalThis.fetch || require('node-fetch');
// Public, non-sensitive rollout metadata. Firestore permits only staff to write.
async function approvedVersion(config, component, fetchImpl = compatibleFetch) {
  if (!config) throw new Error('Import institution settings before updating.');
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(config.firebase.projectId)}/databases/(default)/documents/libraries/main/update_approvals/${component}`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok) throw new Error('No institution update approval is available. Ask staff to approve the release in Admin.');
  const fields = (await response.json()).fields || {};
  const version = fields.version?.stringValue;
  if (!/^\d+\.\d+\.\d+$/.test(version || '') || version.length > 40 || fields.policy?.stringValue !== 'approved') throw new Error('This version is not approved for rollout by the institution.');
  const starts = Date.parse(fields.notBefore?.timestampValue);
  if (!Number.isFinite(starts) || starts > Date.now()) throw new Error('The institution rollout has not started yet.');
  return version;
}
async function checkApproval(config, component, version, fetchImpl = compatibleFetch) {
  if (await approvedVersion(config, component, fetchImpl) !== version) throw new Error('This version is not approved for rollout by the institution.');
  return true;
}
module.exports = { checkApproval, approvedVersion };

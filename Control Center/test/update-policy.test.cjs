const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkApproval } = require('../../desktop-integration/update-policy.cjs');
const config = { firebase: { projectId: 'demo-school' } };
const reply = (version = '1.2.0', policy = 'approved', time = '2026-01-01T00:00:00Z') => async () => ({ ok: true, json: async () => ({ fields: { version: { stringValue: version }, policy: { stringValue: policy }, notBefore: { timestampValue: time } } }) });
test('desktop updates fail closed unless exact version and active rollout are approved', async () => {
  assert.equal(await checkApproval(config, 'admin', '1.2.0', reply()), true);
  await assert.rejects(checkApproval(config, 'admin', '1.3.0', reply()), /not approved/);
  await assert.rejects(checkApproval(config, 'admin', '1.2.0', reply('1.2.0', 'paused')), /not approved/);
  await assert.rejects(checkApproval(config, 'admin', '1.2.0', reply('1.2.0', 'approved', '2099-01-01T00:00:00Z')), /not started/);
  await assert.rejects(checkApproval(config, 'admin', '1.2.0', async () => { throw new Error('offline'); }), /offline/);
});

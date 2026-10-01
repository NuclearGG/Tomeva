const test = require('node:test');
const assert = require('node:assert/strict');
const { OAuthFlow } = require('../oauth-flow');
const LOGIN_ORIGIN = 'https://demo-institution.web.app';

test('unconfigured app cannot start a sign-in or choose a fallback project', async () => {
  let opened = false;
  const flow = new OAuthFlow({ openExternal: async () => { opened = true; }, notify: () => {} });
  await assert.rejects(flow.start(), /Import the institution setup/);
  assert.equal(opened, false);
  assert.equal(flow.server, null);
});

async function startFlow(options = {}) {
  const notifications = [];
  let opened;
  const flow = new OAuthFlow({
    port: 0,
    getLoginUrl: () => LOGIN_ORIGIN + '/admin-sign-in/',
    openExternal: async (url) => { opened = new URL(url); },
    notify: (value) => notifications.push(value),
    ...options,
  });
  await flow.start();
  const callback = `http://127.0.0.1:${flow.server.address().port}/auth-callback`;
  const state = new URLSearchParams(opened.hash.slice(1)).get('state');
  const post = (body, origin = LOGIN_ORIGIN) => fetch(callback, {
    method: 'POST',
    headers: { Origin: origin },
    body: new URLSearchParams(body),
  });
  return { flow, opened, state, callback, post, notifications };
}

test('opens HTTPS Firebase sign-in and delivers its credential only through IPC', async () => {
  const { flow, opened, state, post, notifications } = await startFlow();
  try {
    assert.equal(opened.protocol, 'https:');
    assert.equal(opened.origin, LOGIN_ORIGIN);
    assert.equal(opened.pathname, '/admin-sign-in/');
    assert.equal(opened.search, '');
    assert.equal(await flow.start(), false);
    const response = await post({ state, credential: 'test-google-id-token', accessToken: 'test-access-token' });
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /test-google-id-token|test-access-token/);
    assert.deepEqual(notifications, [{ credential: 'test-google-id-token', accessToken: 'test-access-token' }]);
    assert.equal(flow.state, null);
    assert.equal(flow.inProgress, false);
  } finally { flow.stop(); }
});

test('forged origins, missing state, and wrong state cannot consume a valid login', async () => {
  const { flow, state, post, notifications } = await startFlow();
  try {
    assert.equal((await post({ state, credential: 'forged' }, 'https://evil.example')).status, 403);
    assert.equal((await post({ state, credential: 'forged' }, 'null')).status, 403);
    assert.equal((await post({ credential: 'forged' })).status, 400);
    assert.equal((await post({ state: 'wrong', credential: 'forged' })).status, 400);
    assert.equal((await post({ state })).status, 400);
    assert.deepEqual(notifications, []);
    assert.equal((await post({ state, credential: 'valid' })).status, 200);
    assert.equal(notifications.length, 1);
  } finally { flow.stop(); }
});

test('old GET callbacks and oversized responses are rejected', async () => {
  const { flow, callback, state, post, notifications } = await startFlow();
  try {
    assert.equal((await fetch(`${callback}?state=${state}&code=old-code`)).status, 404);
    assert.equal((await post({ state, credential: 'a'.repeat(40000) })).status, 413);
    assert.deepEqual(notifications, []);
  } finally { flow.stop(); }
});

test('browser launch failure releases the listener so sign-in can be retried', async () => {
  const flow = new OAuthFlow({ port: 0, getLoginUrl: () => LOGIN_ORIGIN + '/admin-sign-in/', notify: () => {}, openExternal: async () => { throw new Error('browser unavailable'); } });
  await assert.rejects(flow.start(), /browser unavailable/);
  assert.equal(flow.server, null);
  assert.equal(flow.state, null);
  assert.equal(flow.inProgress, false);
  flow.openExternal = async () => {};
  try { assert.equal(await flow.start(), true); } finally { flow.stop(); }
});

test('abandoned sign-in expires and allows another attempt', async () => {
  const { flow, notifications } = await startFlow({ timeoutMs: 25 });
  try {
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(flow.inProgress, false);
    assert.equal(flow.state, null);
    assert.equal(notifications[0].error, 'sign_in_timed_out');
    assert.equal(await flow.start(), true);
  } finally { flow.stop(); }
});

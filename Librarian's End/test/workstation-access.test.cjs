const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createWorkstationAccess } = require('../main/workstation-access');

test('only the local main frame of an unlocked workstation can access sensitive IPC', () => {
  const entry = path.resolve(__dirname, '../index.html');
  const frame = { url: pathToFileURL(entry).href };
  const contents = { mainFrame: frame };
  let locked = false;
  const access = createWorkstationAccess(() => ({ webContents: contents }), () => ({ isLocked: () => locked }), entry);
  const event = { sender: contents, senderFrame: frame };
  assert.doesNotThrow(() => access.assertUnlocked(event));
  assert.throws(() => access.assertUnlocked({ sender: {}, senderFrame: frame }), /denied/);
  assert.throws(() => access.assertUnlocked({ sender: contents, senderFrame: { ...frame } }), /denied/);
  frame.url = 'https://example.org/';
  assert.throws(() => access.assertUnlocked(event), /denied/);
  frame.url = pathToFileURL(entry).href + '#settings';
  locked = true;
  assert.throws(() => access.assertUnlocked(event), /locked/);
  assert.equal(access.trusted(event), true, 'lock/unlock IPC must remain available');
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../js/import-policy');
test('imports reject wrong files and excessive bytes before reading; Windows empty MIME is supported', () => {
  for (const patch of [{ name: 'books.exe' }, { type: 'text/html' }, { size: policy.MAX_BYTES + 1 }, { size: 0 }]) assert.throws(() => policy.validateFile({ name: 'books.json', type: 'application/json', size: 10, ...patch }));
  for (const type of ['', 'application/json', 'text/plain']) policy.validateFile({ name: 'books.JSON', size: 10, type });
});
test('main-process parser caps UTF-8 bytes and rows and rejects malformed rows', () => {
  assert.equal(policy.parse(JSON.stringify(Array.from({ length: 1000 }, () => ({ name: 'Book' })))).length, 1000);
  for (const input of [JSON.stringify(Array.from({ length: 1001 }, () => ({}))), ' '.repeat(policy.MAX_BYTES + 1), JSON.stringify({ text: 'अ'.repeat(800000) }), 'null', '[]', '[null]', '[[]]', '{broken']) assert.throws(() => policy.parse(input));
  assert.equal(policy.parse('{"name":"One"}').length, 1);
});

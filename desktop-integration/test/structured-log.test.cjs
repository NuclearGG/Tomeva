const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createStructuredLogger } = require('../structured-log.cjs');
test('structured diagnostics omit secrets, reject injection and remain independent of app success', () => {
  const lines = [], log = createStructuredLogger({ component: 'test', sink: line => lines.push(line) });
  log('warn', 'ipc.operation.failed', { code: 'EACCES', channel: 'recovery:run', password: 'secret', token: 'secret', email: 'reader@example.org', message: 'private path', state: 'bad\nforged', count: Infinity, schemaVersion: 999, dbSchemaVersion: 3 });
  log('warn', 'bad\nevent');
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]); assert.equal(record.schemaVersion, 1); assert.equal(record.dbSchemaVersion, 3);
  assert.equal(record.code, 'EACCES'); assert.equal(record.channel, 'recovery:run');
  for (const key of ['password', 'token', 'email', 'message', 'state', 'count']) assert.equal(record[key], undefined);
  assert.doesNotMatch(lines[0], /secret|reader@|forged|private path/);
  assert.doesNotThrow(() => createStructuredLogger({ component: 'test', sink() { throw new Error('Full disk'); } })('error', 'write.failed'));
});
test('structured diagnostic files rotate with bounded retention and retain valid JSON lines', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tomeva-diagnostics-')); t.after(() => fs.rmSync(directory, {recursive:true,force:true}));
  const log = createStructuredLogger({ directory, component: 'test' }), filename = path.join(directory, 'diagnostics.jsonl');
  for (let i = 0; i < 5; i++) { fs.writeFileSync(filename, 'x'.repeat(5 * 1024 * 1024)); log('info', 'rotation.test', {count:i}); }
  assert.equal(fs.readdirSync(directory).length, 4); assert.equal(JSON.parse(fs.readFileSync(filename,'utf8')).count, 4);
});

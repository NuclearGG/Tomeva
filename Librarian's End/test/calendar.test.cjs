const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
test('circulation days use local midnight and date labels survive negative UTC offsets and DST', () => {
  const script = `const {localDate,lateDays,formatDate}=require(${JSON.stringify(path.resolve(__dirname, '../main/calendar.js'))}); console.log(JSON.stringify({today:localDate(new Date('2026-10-13T19:00:00Z')),late:lateDays('2026-10-13',new Date('2026-10-13T19:00:00Z')),label:formatDate('2026-10-14'),dst:lateDays('2026-03-07',new Date('2026-03-09T05:00:00Z'))}));`;
  const run = zone => JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: zone }, encoding: 'utf8' }));
  const india = run('Asia/Kolkata'), west = run('America/Los_Angeles'), dst = run('America/New_York');
  assert.equal(india.today, '2026-10-14'); assert.equal(india.late, 1);
  assert.equal(west.today, '2026-10-13'); assert.equal(west.late, 0);
  assert.match(west.label, /^14/); assert.equal(dst.dst, 2);
});

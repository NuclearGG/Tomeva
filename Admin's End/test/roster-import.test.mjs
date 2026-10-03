import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRosterFile, parseRosterText } from '../roster-import.mjs';

test('CSV roster accepts admission numbers with optional student details', () => {
  const rows = parseRosterText('Admission No,Full Name,Google Email,Grade,Section,Group\nA-001,"Rao, Mira",mira@example.com,10,A,Literary Club\nA-002,Sam,,9,B,Unknown\n');
  assert.deepEqual(rows, [
    { adm_no: 'A-001', name: 'Rao, Mira', email: 'mira@example.com', class: '10', section: 'A', group: 'Literary Club' },
    { adm_no: 'A-002', name: 'Sam', email: '', class: '9', section: 'B', group: 'Regular' },
  ]);
});

test('JSON roster accepts common aliases and rejects unsafe rows', () => {
  assert.equal(parseRosterText(JSON.stringify({ students: [{ student_id: 42, student_name: 'Test Student' }] }), 'json')[0].adm_no, '42');
  assert.throws(() => parseRosterText('adm_no,name\nA1,One\na1,Two\n'), /duplicate admission number/i);
  assert.throws(() => parseRosterText('adm_no,email\nA1,not-an-email\n'), /email address is invalid/i);
});

test('Access files return an export instruction', async () => {
  await assert.rejects(parseRosterFile({ name: 'students.accdb', size: 10, text: async () => '' }), /export.*CSV/i);
});

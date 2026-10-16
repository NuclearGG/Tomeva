const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { institutionRules } = require('../rules-config');
const source = fs.readFileSync(path.join(__dirname, '../../Librarian\'s End/firestore.rules'), 'utf8');

test('institution rules use the selected staff domain with literal dots', () => {
  for (const domain of ['school.edu', 'gmail.com', 'staff.school.edu']) {
    const result = institutionRules(source, domain);
    assert.ok(result.includes(domain.replace(/\./g, '\\\\.')));
    assert.ok(!result.includes('staff.example'));
    assert.ok(!result.includes('staff\\\\.example'));
    assert.ok(result.includes('request.auth.token.email_verified == true'));
    assert.ok(result.includes("request.auth.token.firebase.sign_in_provider == 'google.com'"));
    assert.equal(result, source.replaceAll('staff\\\\.example', domain.replace(/\./g, '\\\\.')).replaceAll('staff.example', domain));
  }
});
test('institution rules reject an unset or template domain', () => {
  for (const domain of ['', 'staff.example', '.*', "school.edu'", undefined]) {
    assert.throws(() => institutionRules(source, domain), /staff domain/);
  }
});

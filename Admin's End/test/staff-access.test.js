const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the dashboard's actual configuration, auth callback and gate rendering.
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const domainCode = html.slice(html.indexOf('const STAFF_DOMAIN ='), html.indexOf('let _data ='));
const accessCode = html.slice(html.indexOf('onAuthStateChanged(auth, (user) => {'), html.indexOf('const kioskManager ='));
function access(staffDomain, user) {
  const nodes = new Map();
  const labels = [{}, {}];
  let onAuth;
  const context = {
    institution: { staffDomain }, auth: {},
    _staffListeners: [], _adminCurrentUser: null, _isStaffVerified: false,
    _restrictedUnsub: null, _restrictedData: null,
    _allRequests: [], _allAuthorizedStudents: [], _allPendingLogins: [],
    document: {
      querySelectorAll: () => labels,
      getElementById: id => {
        if (!nodes.has(id)) nodes.set(id, { style: {}, textContent: '' });
        return nodes.get(id);
      },
    },
    onAuthStateChanged: (_, callback) => { onAuth = callback; },
  };
  for (const name of ['refreshDashboardData', 'startRestrictedListener', 'startApprovalListener',
    'startLibrarianNotifListener', 'startRequestsListener', 'startAuthorizedStudentsListener',
    'startPendingLoginsListener', 'renderAdminRequests', 'updateRequestsBadge', 'updateAdminBadge',
    'renderAuthorizedStudents', 'renderPendingVerification']) context[name] = () => () => {};
  vm.runInNewContext(domainCode + accessCode, context);
  onAuth(user);
  return { context, nodes, labels };
}

for (const domain of ['school.edu', 'college.ac.in', 'gmail.com']) {
  test(`Student Access accepts the configured ${domain} domain`, () => {
    const { nodes, labels } = access(domain, { email: `admin@${domain}`, emailVerified: true });
    assert.equal(nodes.get('access-management').style.display, 'block');
    assert.equal(nodes.get('access-gate-denied').style.display, 'none');
    assert.ok(labels.every(label => label.textContent === '@' + domain));
  });
}
test('Student Access rejects other domains, suffix lookalikes and unverified accounts', () => {
  for (const user of [
    { email: 'admin@meacademy.in', emailVerified: true },
    { email: 'admin@evilschool.edu', emailVerified: true },
    { email: 'admin@school.edu.evil.com', emailVerified: true },
    { email: 'admin@school.edu', emailVerified: false },
  ]) {
    const { nodes } = access('school.edu', user);
    assert.equal(nodes.get('access-gate-denied').style.display, 'block');
    assert.equal(nodes.get('access-management').style.display, 'none');
  }
});
test('configured domain and email comparisons ignore case', () => {
  const { nodes, labels } = access(' School.EDU ', { email: 'Admin@SCHOOL.edu', emailVerified: true });
  assert.equal(nodes.get('access-management').style.display, 'block');
  assert.equal(labels[0].textContent, '@school.edu');
});
test('signed-out users see the sign-in gate', () => {
  assert.equal(access('school.edu', null).nodes.get('access-gate-signedout').style.display, 'block');
});

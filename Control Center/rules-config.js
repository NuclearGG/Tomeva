'use strict';

function institutionRules(source, staffDomain) {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(staffDomain || '') || staffDomain === 'staff.example') {
    throw new Error('Choose the institution staff domain before generating Firestore rules.');
  }
  const placeholder = 'staff\\\\.example';
  if (!source.includes(placeholder)) throw new Error('Firestore rules template is not compatible with this exporter.');
  return source.replaceAll(placeholder, staffDomain.replace(/\./g, '\\\\.'))
    .replaceAll('staff.example', staffDomain);
}

module.exports = { institutionRules };

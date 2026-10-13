'use strict';
function admissionKey(value) {
  return 'adm-' + String(value).trim().toLowerCase().replace(/%/g, '%25').replace(/\//g, '%2f');
}
module.exports = { admissionKey };

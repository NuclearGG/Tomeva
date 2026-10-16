(function(root, factory) {
  const policy = factory();
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else root.TomevaImportPolicy = policy;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const MAX_BYTES = 2 * 1024 * 1024;
  const MAX_ROWS = 1000;
  function validateFile(file) {
    if (!file || !/\.json$/i.test(file.name || '')) throw new Error('Choose a .json import file.');
    if (!Number.isFinite(file.size) || file.size < 1 || file.size > MAX_BYTES) throw new Error('Import files must be nonempty and 2 MiB or smaller.');
    const mime = String(file.type || '').toLowerCase().split(';')[0].trim();
    if (!['', 'application/json', 'text/json', 'text/plain'].includes(mime)) throw new Error('Choose a JSON or plain-text file, not ' + mime + '.');
  }
  function parse(text) {
    if (typeof text !== 'string' || text.length > MAX_BYTES || new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('Import files must be 2 MiB or smaller.');
    let rows;
    try { rows = JSON.parse(text); } catch { throw new Error('The JSON file is not valid.'); }
    if (!Array.isArray(rows)) rows = [rows];
    if (!rows.length || rows.length > MAX_ROWS) throw new Error('Import between 1 and 1000 rows at a time.');
    if (rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Every import row must be an object.');
    return rows;
  }
  return { MAX_BYTES, MAX_ROWS, validateFile, parse };
});

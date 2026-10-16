const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
test('desktop and hosted portal CSPs deny objects and upgrade insecure resource requests', () => {
  for (const filename of ["Admin's End/index.html", "Librarian's End/index.html", 'Control Center/ui/index.html','Student Search/search.html','Control Center/web-template/search.html']) {
    const html=fs.readFileSync(path.join(__dirname,'../..',filename),'utf8');
    const csp=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
    assert.match(csp, /(?:^|;)\s*object-src 'none'(?:;|$)/, filename);
    assert.match(csp, /(?:^|;)\s*upgrade-insecure-requests(?:;|$)/, filename);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-(?:eval|inline)'/, filename);
  }
});

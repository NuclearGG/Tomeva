const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const parser = require('../../Librarian\'s End/node_modules/@babel/parser');
function functions(filename, names) {
  const source = fs.readFileSync(path.join(__dirname, '../..', filename), 'utf8'), found = [];
  function visit(node) { if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionDeclaration' && names.includes(node.id?.name)) { found.push(source.slice(node.start, node.end)); return; }
    for (const [key, value] of Object.entries(node)) if (key !== 'loc') { if (Array.isArray(value)) value.forEach(visit); else visit(value); }
  }
  visit(parser.parse(source,{sourceType:'module'})); assert.equal(found.length,names.length);
  const context = vm.createContext({}); vm.runInContext(found.join('\n'),context); return context;
}
test('portal status and availability cannot inject elements or attributes in either catalogue view', () => {
  const portal = functions('Student Search/portal.mjs', ['escHtml','highlight','bookCard','bookListItem']);
  const row = {book_id:'B1',title:'Book',status:'<img src=x onerror=alert(1)>',availability:'unavailable" onclick="alert(1)'};
  for (const html of [portal.bookCard(row),portal.bookListItem(row,'')]) { assert.doesNotMatch(html, /<img|onclick=/); assert.match(html, /class="(?:book-card|book-list-item) unavailable"/); }
  assert.match(portal.bookListItem(row,''), /&lt;img/);
});
test('Admin amounts accept finite nonnegative numbers only and format every amount safely', () => {
  const { money } = functions("Admin's End/app.mjs",['money']);
  assert.equal(money(0),'₹0.00'); assert.equal(money(1234.5),'₹1,234.50');
  for (const value of ['<img src=x>','12',null,undefined,{},[],NaN,Infinity,-1,Number.MAX_VALUE]) assert.equal(money(value),'—');
});

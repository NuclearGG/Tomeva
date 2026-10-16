const { app, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tomeva-import-security-'));
app.setPath('userData', directory); app.disableHardwareAcceleration();
const { SqliteStore } = require('../main/sqlite-store');
const { createLibraryService } = require('../main/library-service');
const store = new SqliteStore(directory); store.initializeLegacy(null);
const api = createLibraryService(store);
const admission = '<img data-xss src=x>';
assert.equal(api.importStudents(JSON.stringify([{ adm_no: admission, name: 'Imported markup reader' }])).ok, true);
api.addBook({ access_no: 'XSS-BOOK', document: 'Book' }); api.issueBook(admission, 'XSS-BOOK');
const loan = store.collections.transactions.findOne({ status: 'Active' }); loan.due_date = '2020-01-01'; store.collections.transactions.update(loan);
assert.ok(api.returnBook('XSS-BOOK').ok); assert.ok(api.markFinePaid(loan.transaction_id));
const payment = store.collections.finePayments.findOne({});
payment.payment_id = '<svg data-xss>'; payment.book_access_no = '<img data-xss>'; store.collections.finePayments.update(payment); store.close();
const deadline = setTimeout(() => { console.error('Import security UI timed out'); app.exit(1); }, 30000);
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => cb({ cancel: true }));
  session.defaultSession.enableNetworkEmulation({ offline: true });
});
app.on('browser-window-created', (_, window) => {
  window.hide();
  window.webContents.once('did-finish-load', async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        await new Promise(resolve => LibraryDB.onReady(resolve));
        _currentFinesTab = 'collected'; _renderFines();
        const escaped = !document.querySelector('#fines-tbody [data-xss]') && document.getElementById('fines-tbody').textContent.includes(${JSON.stringify(admission)});
        let reads = 0, imports = 0;
        const read = FileReader.prototype.readAsText;
        FileReader.prototype.readAsText = function(...args) { reads++; return read.apply(this, args); };
        const books = LibraryDB.importBooks;
        LibraryDB.importBooks = function(...args) { imports++; return books.apply(this, args); };
        const input = document.getElementById('setup-import-books');
        async function select(name, type, text) {
          const data = new DataTransfer(); data.items.add(new File([text], name, { type })); input.files = data.files; input.dispatchEvent(new Event('change'));
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        await select('books.json', 'application/json', 'x'.repeat(2 * 1024 * 1024 + 1));
        await select('books.json', 'text/html', '[]');
        const rejectedBeforeRead = reads === 0 && imports === 0;
        const excess = JSON.stringify(Array.from({ length:1001 }, (_, i) => ({ access_no:'B'+i, document:'Book' })));
        await select('books.json', 'application/json', excess);
        const rejectedRows = reads === 1 && imports === 0 && !LibraryDB.importBooks(excess).ok;
        imports = 0;
        await select('books.json', 'application/json', '[{"access_no":"ONE-IMPORT","document":"One import"}]');
        return { escaped, rejectedBeforeRead, rejectedRows, oneReader: reads === 2, oneImport: imports === 1, books: LibraryDB.getBooks().length };
      })()`);
      assert.deepEqual(result, { escaped: true, rejectedBeforeRead: true, rejectedRows: true, oneReader: true, oneImport: true, books: 1 });
      console.log('PASS: stored imported admission/payment markup remains text; excessive file bytes/MIME reject before FileReader; rows reject before IPC; setup import runs once.');
      clearTimeout(deadline); app.exit(0);
    } catch (error) { console.error(error); clearTimeout(deadline); app.exit(1); }
  });
});
require('../main');

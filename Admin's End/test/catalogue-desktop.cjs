// Real table/controller functions and pager, synthetic REST responses, no cloud writes.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const parser = require('../../Librarian\'s End/node_modules/@babel/parser');
const { split } = require('../../Librarian\'s End/js/cloud-shards');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tomeva-admin-pages-'))); app.disableHardwareAcceleration();
const source = fs.readFileSync(path.join(__dirname, '../app.mjs'), 'utf8');
const wanted = new Set(['_esc', 'money', 'setText', 'fmtDate', 'closeTableView', 'tableRows', 'loadTablePage', 'renderAvailable', 'renderIssued', 'renderDamaged', 'renderFines', 'renderOverdue']);
const declarations = [];
function visit(value) {
  if (!value || typeof value !== 'object') return;
  if (value.type === 'FunctionDeclaration' && wanted.has(value.id?.name)) { declarations.push(source.slice(value.start, value.end)); return; }
  for (const [key, child] of Object.entries(value)) if (key !== 'loc') { if (Array.isArray(child)) child.forEach(visit); else visit(child); }
}
visit(parser.parse(source, { sourceType: 'module' }));
const books = Array.from({ length: 123 }, (_, index) => ({ book_id: 'B' + index, title: 'Title ' + index, author: 'Author' }));
const issued = Array.from({ length: 57 }, (_, index) => ({ book_id: 'I' + index, book_title: 'Loan ' + index, student_name: 'Private reader', student_id: 'S' + index }));
const publicSnapshot = split({ availableList: books, issuedList: [], damagedList: [], stats: { available: 123, issued: 57 } }, 'public-page-test');
const privateSnapshot = split({ overdueList: [], issuedList: issued, finesList: [], recentCollections: [], stats: { issued: 57 } }, 'private-page-test', true);
const deadline = setTimeout(() => { console.error('Admin catalogue desktop timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*', 'file://*/*'] }, (details, cb) => cb({ cancel: /^https?:/.test(details.url) || /app\.bundle\.js/.test(details.url) }));
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadFile(path.join(__dirname, '../index.html'));
  try {
    const result = await window.webContents.executeJavaScript(`(async () => {
      const module = await import('./snapshot-pages.mjs');
      window.createSnapshotPager = module.createSnapshotPager; window.fetchSnapshotPage = module.fetchSnapshotPage;
      var fixtures = ${JSON.stringify({ publicSnapshot, privateSnapshot })};
      window.pageRequests = []; window.failPages = false;
      const encode = value => value === null ? {nullValue:null} : Array.isArray(value) ? {arrayValue:{values:value.map(encode)}} : typeof value === 'object' ? {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encode(item)]))}} : typeof value === 'number' ? {integerValue:String(value)} : typeof value === 'boolean' ? {booleanValue:value} : {stringValue:value};
      window.fetch = async (url, options) => {
        window.pageRequests.push({url,options});
        await new Promise(resolve => setTimeout(resolve, 15));
        if(window.failPages) return {ok:false,status:503};
        const snapshot = url.includes('/circulation_shards/') ? fixtures.privateSnapshot : fixtures.publicSnapshot;
        const index = Number(new URL(url).pathname.match(/-(\\d+)$/)[1]);
        return {ok:true,text:async()=>JSON.stringify({fields:encode(snapshot.shards[index]).mapValue.fields})};
      };
      window._publicData = fixtures.publicSnapshot.manifest; window._restrictedData = fixtures.privateSnapshot.manifest;
      window._data = {stats:{available:123,issued:57}}; window._isStaffVerified = true;
      window.firebaseConfig = {projectId:'demo-school',apiKey:'public-key'}; window.auth = {currentUser:{getIdToken:async()=> 'fixture-token'}};
      window.tableView = null; window.tableEpoch = 0; window.searchTimer = null;
      window.tableKeys = {available:'availableList',issued:'issuedList',damaged:'damagedList',overdue:'overdueList',fines:'finesList'};
      ${declarations.join('\n')}
      const wait = async () => { for(let i=0;i<100;i++) { if(!tableView?.loading) return; await new Promise(resolve=>setTimeout(resolve,10)); } throw new Error('Paging stayed busy'); };
      await loadTablePage('available');
      const first = document.querySelectorAll('#available-tbody tr').length === 25 && pageRequests.length === 1;
      document.querySelector('#available-paging button:last-child').click(); await wait();
      const next = document.getElementById('available-tbody').textContent.includes('Title 25') && document.querySelectorAll('#available-tbody tr').length === 25;
      const afterNext = pageRequests.length;
      document.querySelector('#available-paging button:first-child').click(); await wait();
      const cached = pageRequests.length === afterNext;
      await loadTablePage('available',0,'Title 122');
      const search = document.querySelectorAll('#available-tbody tr').length === 1 && document.getElementById('available-tbody').textContent.includes('Title 122');
      const pager = tableView.pager; closeTableView();
      const cleared = pager.cacheSize === 0 && document.getElementById('available-tbody').children.length === 0;
      await loadTablePage('issued');
      const privateLoaded = document.querySelectorAll('#issued-tbody tr').length === 25 && pageRequests.at(-1).options.headers.Authorization === 'Bearer fixture-token';
      closeTableView(); const privateCleared = !document.getElementById('issued-tbody').textContent.includes('Private reader');
      failPages = true; await loadTablePage('available');
      const retryShown = document.querySelector('#available-paging button').textContent === 'Retry';
      failPages = false; document.querySelector('#available-paging button').click(); await wait();
      const retried = document.querySelectorAll('#available-tbody tr').length === 25;
      const noHttpCache = pageRequests.every(request=>request.options.cache === 'no-store');
      closeTableView();
      return {first,next,cached,search,cleared,privateLoaded,privateCleared,retryShown,retried,noHttpCache};
    })()`);
    assert.ok(Object.values(result).every(value => value === true), JSON.stringify(result));
    console.log('PASS: Admin 25-row loading, Next/Previous, cache reuse/deletion, search across unloaded records, staff REST token, no HTTP cache, error/retry and private row removal.');
    clearTimeout(deadline); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(deadline); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });

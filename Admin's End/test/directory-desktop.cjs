const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const parser = require('../../Librarian\'s End/node_modules/@babel/parser');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tomeva-directory-smoke-'))); app.disableHardwareAcceleration();
const source = fs.readFileSync(path.join(__dirname, '../app.mjs'), 'utf8'), declarations = [];
const wanted = new Set(['_esc','startDirectory','searchDirectory','renderAuthorizedStudents']);
function visit(value) {
  if (!value || typeof value !== 'object') return;
  if (value.type === 'FunctionDeclaration' && wanted.has(value.id?.name)) { declarations.push(source.slice(value.start, value.end)); return; }
  for (const [key, child] of Object.entries(value)) if (key !== 'loc') { if (Array.isArray(child)) child.forEach(visit); else visit(child); }
}
visit(parser.parse(source, { sourceType: 'module' }));
const deadline = setTimeout(() => { console.error('Directory desktop smoke timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*', 'file://*/*'] }, (details, callback) => callback({ cancel: /^https?:/.test(details.url) || /app\.bundle\.js/.test(details.url) }));
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await window.loadFile(path.join(__dirname, '../index.html'));
    const result = await window.webContents.executeJavaScript(`(async () => {
      const {createDirectoryPager} = await import('./directory-pages.mjs');
      const rows = Array.from({length:5000}, (_,i)=>({id:'student'+String(i).padStart(4,'0')+'@school.test',email:'student'+String(i).padStart(4,'0')+'@school.test',name:i===0?'<img src=x onerror=alert(1)>':'Reader '+i,adm_no:'S'+i,group:'Regular'}));
      const directoryViews = new Map(); let _allAuthorizedStudents = []; const db={}, LIBRARY_ID='main';
      const collection = (...args)=>args.slice(1).join('/'); const calls=[];
      const firestoreSdk = Object.fromEntries(['orderBy','where','startAfter','limit','query'].map(name=>[name,(...args)=>({name,args})]));
      firestoreSdk.documentId=()=>'__name__';
      firestoreSdk.onSnapshot=(query,receive)=>{
        let cancelled=false;
        const after=query.args.find(item=>item?.name==='startAfter')?.args[0];
        const prefix=query.args.find(item=>item?.name==='where')?.args[2] || '';
        const cap=query.args.find(item=>item?.name==='limit').args[0]; calls.push(cap);
        queueMicrotask(()=>{if(!cancelled)receive({docs:rows.filter(row=>(!after||row.id>after)&&row.id.startsWith(prefix)).slice(0,cap).map(row=>({id:row.id,data:()=>row}))});});
        return()=>{cancelled=true;};
      };
      ${declarations.join('\n')}
      const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Directory did not settle');};
      const stop=startDirectory('authorized_students','access',rows=>{_allAuthorizedStudents=rows;renderAuthorizedStudents();});
      await wait(()=>_allAuthorizedStudents.length===25);
      const body=document.getElementById('access-tbody'), controls=body.closest('.table-wrap').nextElementSibling;
      const first=body.querySelectorAll('tr').length===25&&!body.querySelector('img')&&body.textContent.includes('<img');
      controls.lastElementChild.click(); await wait(()=>_allAuthorizedStudents[0]?.id==='student0025@school.test');
      const next=body.querySelectorAll('tr').length===25;
      searchDirectory('access','student4999'); await wait(()=>_allAuthorizedStudents.length===1);
      const searched=body.textContent.includes('Reader 4999'); stop();
      return {first,next,searched,cleared:body.children.length===0&&directoryViews.size===0,bounded:calls.every(cap=>cap===26)};
    })()`);
    assert.deepEqual(result, {first:true,next:true,searched:true,cleared:true,bounded:true});
    console.log('PASS: Admin directory 5,000-record fixture — 25-row DOM, server cursors, prefix search, escaped text and cleared private rows.');
    clearTimeout(deadline); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(deadline); app.exit(1); }
});

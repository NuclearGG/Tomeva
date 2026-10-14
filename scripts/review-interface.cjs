/* Actual workspace markup/render functions with synthetic data and blocked network. */
const { app, BrowserWindow, protocol, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
// Software compositing keeps offscreen screenshots stable on Windows GPU drivers.
app.disableHardwareAcceleration();

const local = createRequire(path.join(root, "Librarian's End/package.json"));
const parser = local('@babel/parser');
const output = path.join(root, 'Control Center/test-artifacts/workspace-design');
require('./prepare-interface.cjs').prepareInterface();
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tomeva-design-')));
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([{ scheme: 'review', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const books = [
  { access_no:'F099/01', document:'A Brief History of Time', author:'Stephen Hawking', publisher:'Bantam', status:'Issued' },
  { access_no:'F103/08', document:'The Discovery of India', author:'Jawaharlal Nehru', publisher:'Penguin', status:'Issued' },
  { access_no:'L204/16', document:'The Blue Umbrella', author:'Ruskin Bond', publisher:'Rupa', status:'Available' },
  { access_no:'L220/03', document:'Malgudi Days', author:'R. K. Narayan', publisher:'Indian Thought', status:'Available' },
  { access_no:'S012/11', document:'The Story of My Experiments with Truth', author:'M. K. Gandhi', publisher:'Navajivan', status:'Available' },
  { access_no:'F018/02', document:'Wings of Fire', author:'A. P. J. Abdul Kalam', publisher:'Universities Press', status:'Damaged' },
];
const students = [
  { adm_no:'ADM2024012', name:'Ananya Rao', class:'10', section:'A', roll_no:'12', group:'Regular', email:'ananya@example.test' },
  { adm_no:'ADM2024038', name:'Kabir Shah', class:'11', section:'B', roll_no:'8', group:'Literary Club', email:'kabir@example.test' },
  { adm_no:'ADM2024024', name:'Meera Iyer', class:'9', section:'A', roll_no:'24', group:'Editorial Board', email:'meera@example.test' },
];
const txns = [
  { transaction_id:'TXN-01', book_access_no:'F099/01', student_adm_no:'ADM2024012', borrower_type:'student', issue_date:'2026-09-26', due_date:'2026-10-10', status:'Active', fine:0 },
  { transaction_id:'TXN-02', book_access_no:'F103/08', student_adm_no:'ADM2024038', borrower_type:'student', issue_date:'2026-10-08', due_date:'2026-10-22', status:'Active', fine:0 },
  { transaction_id:'TXN-03', book_access_no:'L204/16', student_adm_no:'ADM2024024', borrower_type:'student', issue_date:'2026-09-20', due_date:'2026-10-04', return_date:'2026-10-12', status:'FinePending', fine:16 },
];
const adminData = {
  stats:{total_books:1248,available:1086,issued:143,damaged:8,under_repair:6,lost:5,overdue_count:7,pending_fines:4,total_fine_amt:146,collected_total:2380,total_students:386},
  issuedList:txns.slice(0,2).map((t,i)=>({book_id:t.book_access_no,book_title:books[i].document,title:books[i].document,student_id:students[i].adm_no,student_name:students[i].name,student_class:students[i].class+' '+students[i].section,issue_date:t.issue_date,due_date:t.due_date})),
  availableList:books.filter(b=>b.status==='Available').map(b=>({book_id:b.access_no,title:b.document,author:b.author,publisher:b.publisher})),
  overdueList:[{book_title:books[0].document,student_name:students[0].name,student_class:'10 A',days_overdue:4,fine_accrued:8,book_id:'F099/01',student_id:'ADM2024012',due_date:'2026-10-10'}],
  finesList:[{student_name:students[2].name,student_id:students[2].adm_no,student_class:'9 A',book_title:books[2].document,fine_amount:16,return_date:'2026-10-12'}],
  damagedList:[{book_id:'F018/02',title:books[5].document,author:books[5].author,status:'Damaged'}],
};
function functions(source, filter) {
  const tree = parser.parse(source, { sourceType:'module' }); const found=[];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type==='FunctionDeclaration' && filter(node.id?.name)) { found.push(source.slice(node.start,node.end)); return; }
    for (const [key,value] of Object.entries(node)) if (key!=='loc' && key!=='comments') {
      if (Array.isArray(value)) value.forEach(visit); else if(value && typeof value==='object') visit(value);
    }
  }
  visit(tree); return found.join('\n');
}
const deadline = setTimeout(()=>{ console.error('Workspace rendering timed out'); app.exit(1); }, 90000);
app.whenReady().then(async()=>{
  fs.mkdirSync(output,{recursive:true});
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,done)=>done({cancel:true}));
  protocol.handle('review',async request=>{
    const file=path.resolve(root,'.'+decodeURIComponent(new URL(request.url).pathname));
    if (!file.startsWith(root+path.sep)) return new Response('',{status:403});
    try {
      const ext=path.extname(file); let body=fs.readFileSync(file);
      if(ext==='.html')body=body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
      return new Response(body,{headers:{'Content-Type':({'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[ext]||'application/octet-stream'}});
    }catch{return new Response('',{status:404});}
  });
  let screens=0;
  for(const [name,folder] of [['librarian',"Librarian's End"],['admin',"Admin's End"],['control','Control Center'],['student','Student Search']]) {
    if (process.argv[2] && process.argv[2] !== name) continue;
    console.log('Rendering workspace: '+name);
    const window=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true,nodeIntegration:false}});
    const failures=[];window.webContents.on('did-fail-load',(_,code,description)=>failures.push({code,description}));
    await window.loadURL('review://app/'+encodeURIComponent(folder)+'/'+(name==='control'?'ui/index.html':name==='student'?'search.html':'index.html'));
    await window.webContents.executeJavaScript(fs.readFileSync(path.join(root,'desktop-integration/interface/appearance.js'),'utf8'));
    if(name==='librarian') {
      await window.webContents.executeJavaScript(`var _books=${JSON.stringify(books)},_students=${JSON.stringify(students)},_txns=${JSON.stringify(txns)};
        window.LibraryDB={onReady:cb=>cb(),getBooks:()=>_books,getBook:id=>_books.find(b=>b.access_no===id),getStudents:()=>_students,getStudent:id=>_students.find(s=>s.adm_no===id),getStudentByAdmNo:id=>_students.find(s=>s.adm_no===id),getTransactions:()=>_txns,getActiveTransactions:()=>_txns.filter(t=>t.status==='Active'),getOverdueTransactions:()=>[_txns[0]],getReturnedToday:()=>[_txns[2]],getPendingFines:()=>[_txns[2]],getFinePayments:()=>[],getTotalCollected:()=>2380,getCollectedToday:()=>0,getSettings:()=>({loan_days:14,fine_per_day:2}),getActiveTxnForBook:id=>_txns.find(t=>t.status==='Active'&&t.book_access_no===id),calcLateDays:date=>date==='2026-10-10'?4:0,formatDate:date=>date?new Date(date+'T12:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'—',searchBooks:q=>_books.filter(b=>b.document.toLowerCase().includes(q.toLowerCase())),searchStudents:q=>_students.filter(s=>s.name.toLowerCase().includes(q.toLowerCase())),hasBooks:()=>true,hasStudents:()=>true};void 0;`);
      await window.webContents.executeJavaScript(fs.readFileSync(path.join(root,folder,'js/app.js'),'utf8'));
      await window.webContents.executeJavaScript(`document.getElementById('setup-overlay').classList.remove('visible'); document.getElementById('setup-overlay').style.display='none';_initAddBookModal(); _initAddStudentModal(); _initIssuePage(); _initReturnPage(); _initSearchPage(); document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.page)));`);
    }else if(name==='admin') {
      const source=fs.readFileSync(path.join(root,folder,'app.mjs'),'utf8');
      await window.webContents.executeJavaScript(`var _data=${JSON.stringify(adminData)},_lastUpdated=new Date('2026-10-14T04:00:00Z'),_allRequests=[{status:'Pending'},{status:'Pending'}],_allAuthorizedStudents=[],_allPendingLogins=[],_admissionRoster=[],_controlState={issuance_suspended:false},_isStaffVerified=true,_adminCurrentUser={email:'staff@example.test'};`+functions(source,n=>['_esc','fmtDate','setText','buildStatCards','renderOverview','renderIssued','renderAvailable','renderOverdue','renderFines','renderDamaged','renderAuthorizedStudents','renderPendingLogins','renderAdmissionRoster'].includes(n)));
      await window.webContents.executeJavaScript(`window.adminApp={navigate:page=>{document.querySelectorAll('.page-view').forEach(el=>el.classList.toggle('active',el.id==='page-'+page));document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.page===page));const render={overview:renderOverview,issued:renderIssued,available:renderAvailable,overdue:renderOverdue,fines:renderFines,damaged:renderDamaged}[page];if(render)render();}};renderOverview();renderIssued();renderAvailable();renderOverdue();renderFines();renderDamaged();`);
    }else if(name==='control') {
      await window.webContents.executeJavaScript(`window.controlCenter={onAppearanceOAuth:()=>()=>{},getConfig:async()=>({institutionName:'Riverside School Library',staffDomain:'riverside.example',webUrl:'https://riverside-library.web.app/',firebase:{projectId:'riverside-library',apiKey:'public-web-configuration',authDomain:'riverside-library.firebaseapp.com',appId:'1:123:web:example',messagingSenderId:'12345678'}}),onNavigate:()=>{},onDistributionProgress:()=>{},recoveryStatus:async()=>({exists:true,stale:false,createdAt:'2026-10-14T04:00:00Z',formatVersion:1}),updates:{onStatus:()=>{},getStatus:async()=>({state:'current',version:'1.0.9'}),desktopReleases:async()=>({admin:{state:'current-release',version:'1.0.9'},librarian:{state:'current-release',version:'1.0.9'}})}};void 0;`);
      await window.webContents.executeJavaScript(fs.readFileSync(path.join(root,folder,'ui/renderer.js'),'utf8'));
    }else {
      const source=fs.readFileSync(path.join(root,folder,'portal.mjs'),'utf8');
      const catalogue=books.map(book=>({book_id:book.access_no,title:book.document,author:book.author,publisher:book.publisher,status:book.status,availability:book.status==='Available'?'available':'unavailable'}));
      await window.webContents.executeJavaScript(`var _allBooks=${JSON.stringify(catalogue)},_filter='all',_searchQuery='';`+functions(source,n=>['escHtml','escapeRegExp','highlight','hashStr','bookCard','bookListItem','renderResults','setText'].includes(n)));
      await window.webContents.executeJavaScript(`document.getElementById('full-page-gate').style.display='none';document.getElementById('app-content').style.display='block';document.getElementById('stat-available').textContent='1086';document.getElementById('stat-issued').textContent='143';document.getElementById('stat-total').textContent='1248';document.getElementById('last-updated').textContent='Latest library sync: 14 Oct, 09:30';renderResults();`);
    }
    await window.webContents.executeJavaScript(fs.readFileSync(path.join(root,'desktop-integration/interface/workspace.js'),'utf8'));
    await window.webContents.executeJavaScript(`document.querySelectorAll('[data-institution-name]').forEach(el=>el.textContent='Riverside School Library');document.querySelectorAll('[data-staff-domain]').forEach(el=>el.textContent='@riverside.example'); document.querySelectorAll('[id*="auth-overlay"],[id*="login-overlay"]').forEach(el=>el.style.display='none');`);
    const pages=name==='librarian'?['dashboard','issue','return','students','books','settings']:name==='admin'?['overview','issued','available','access','updates']:name==='control'?['overview','setup','packages','recovery','customization']:['catalogue','search','signedout','profile','request'];
    for(const [width,height] of [[1440,1000],[1100,720],[name==='student'?390:600,900]]) {
      window.setSize(width,height);
      for(const page of pages) {
        if(name==='librarian') await window.webContents.executeJavaScript(`navigate('${page}');`);
        else if(name==='admin') await window.webContents.executeJavaScript(`adminApp.navigate('${page}');document.getElementById('page-heading').textContent=${JSON.stringify(page==='overview'?'Library Overview':page==='access'?'Student Access':page==='updates'?'Update approvals':page==='issued'?'Issued Books':'Available Books')};`);
        else if(name==='control') await window.webContents.executeJavaScript(`document.querySelector('[data-page="${page}"]').click();`);
        else await window.webContents.executeJavaScript(`document.querySelectorAll('.req-modal-overlay').forEach(el=>el.classList.remove('show'));document.getElementById('full-page-gate').style.display=${JSON.stringify(['signedout','profile'].includes(page)?'grid':'none')};document.getElementById('app-content').style.display=${JSON.stringify(['signedout','profile'].includes(page)?'none':'block')};document.querySelectorAll('[id^="fpg-state-"]').forEach(el=>el.style.display=el.id==='fpg-state-${page}'?'block':'none');_searchQuery=${JSON.stringify(page==='search'?'India':'')};document.getElementById('search-input').value=_searchQuery;renderResults();if('${page}'==='request'){document.getElementById('request-modal-overlay').classList.add('show');document.getElementById('req-modal-book-title').textContent='The Blue Umbrella';document.getElementById('req-modal-book-id').textContent='L204/16';}`);
        await window.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');
        await new Promise(resolve=>setTimeout(resolve,150));
        const overflow=await window.webContents.executeJavaScript(`({horizontal:document.documentElement.scrollWidth>innerWidth+1,font:document.fonts.check('14px Manrope'),nav:!!document.querySelector('.nav-item.active[aria-current="page"]')})`);
        assert.equal(overflow.horizontal,false,name+' '+page+' '+width+' viewport overflow');
        assert.equal(overflow.font,true,'Missing local Manrope');if(name!=='student')assert.equal(overflow.nav,true,'Missing active navigation state');
        console.log('Capture '+name+' '+page+' '+width);
        fs.writeFileSync(path.join(output,`${name}-${page}-${width}.png`),(await window.webContents.capturePage()).toPNG());screens++;
      }
    }
    window.setSize(name==='student'?390:1100,name==='student'?900:720);
    const appearanceChecks = await window.webContents.executeJavaScript(`(() => {
      const api=window.TomevaAppearance, project='riverside-library', defaults=api.defaults;
      const custom={...defaults,brandEnabled:true,accentColor:'#175a46',surfaceTone:'warm',typography:'editorial',density:'compact',corners:'crisp',displayName:'Riverside Reading Room',portalHeading:'A new chapter awaits.',notice:'Library open until 4 pm.'};
      const snap=(value,metadata={fromCache:false,hasPendingWrites:false})=>({exists:()=>value!==null,data:()=>value,metadata});
      api.receive(project,snap(custom),{institutionName:'Riverside School Library'});
      const applied=getComputedStyle(document.documentElement).getPropertyValue('--bookcloth').trim()==='#175a46';
      api.apply(defaults);api.load(project);
      const cached=document.documentElement.dataset.surfaceTone==='warm';
      api.receive(project,snap(null,{fromCache:true,hasPendingWrites:false}));
      const offlineRetained=document.documentElement.dataset.surfaceTone==='warm';
      api.receive(project,snap(defaults,{fromCache:false,hasPendingWrites:true}));
      const pendingIgnored=document.documentElement.dataset.surfaceTone==='warm';
      api.load('another-library');
      const isolated=document.documentElement.dataset.surfaceTone==='catalogue';
      let unsupported=false;try{api.receive(project,snap({...custom,schemaVersion:2}));}catch{unsupported=true;}
      api.apply({...custom,notice:'<img src=x onerror=alert(1)>'});
      const safe=document.getElementById('institution-appearance-notice').children.length===0;
      api.receive(project,snap(null));
      const deletedReset=document.documentElement.dataset.surfaceTone==='catalogue';
      api.receive(project,snap(custom),{institutionName:'Riverside School Library'});
      if(document.body.classList.contains('t-workspace-student'))document.querySelectorAll('.req-modal-overlay').forEach(el=>el.classList.remove('show'));
      return {applied,cached,offlineRetained,pendingIgnored,isolated,unsupported,safe,deletedReset};
    })()`);
    for (const [check,passed] of Object.entries(appearanceChecks)) assert.equal(passed,true,name+' appearance '+check);
    if(name==='control') {
      const controls=await window.webContents.executeJavaScript(`(() => {
        const form=document.getElementById('appearance-form');
        form.elements.brandEnabled.checked=true;form.elements.accentColor.value='#175a46';form.elements.surfaceTone.value='warm';form.elements.typography.value='editorial';form.elements.corners.value='crisp';form.elements.density.value='compact';form.elements.displayName.value='Riverside Reading Room';
        form.dispatchEvent(new Event('input',{bubbles:true}));
        return {preview:document.getElementById('appearance-preview-name').textContent==='Riverside Reading Room',publishDisabled:document.getElementById('appearance-publish').disabled};
      })()`);
      assert.equal(controls.preview,true);assert.equal(controls.publishDisabled,true,'Signed-out editor must not publish');
    }
    await new Promise(resolve=>setTimeout(resolve,200));
    fs.writeFileSync(path.join(output,name+'-appearance-custom.png'),(await window.webContents.capturePage()).toPNG());
    if(name==='librarian') {
      await window.webContents.executeJavaScript(`navigate('students');document.getElementById('add-student-btn').click();`);
      await window.webContents.executeJavaScript(fs.readFileSync(path.join(root,folder,'js/dialogs.js'),'utf8'));
      await new Promise(resolve=>setTimeout(resolve,350));
      fs.writeFileSync(path.join(output,'librarian-dialog-1100.png'),(await window.webContents.capturePage()).toPNG());
    }
    assert.deepEqual(failures,[]);window.destroy();
  }
  console.log(`PASS: ${screens} workspace views, local fonts, viewport containment and active navigation. ${output}`);
  clearTimeout(deadline);app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});

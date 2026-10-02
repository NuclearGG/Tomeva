// Render real app markup/CSS with local fixture configuration and no cloud calls.
// This checks presentation; it does not simulate sign-in or circulation operations.
const { app, BrowserWindow, protocol, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const output = path.join(__dirname, '../test-artifacts/branding');
const config = { institutionName: 'Northbridge Institute', staffDomain: 'northbridge.edu' };
app.setPath('userData', require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'tomeva-branding-')));
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([{ scheme: 'preview', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const deadline = setTimeout(() => app.exit(1), 60000);
app.whenReady().then(async () => {
  await fs.mkdir(output, { recursive: true });
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, done) => done({ cancel: true }));
  protocol.handle('preview', async request => {
    const filename = path.resolve(root, '.' + decodeURIComponent(new URL(request.url).pathname));
    if (!filename.startsWith(root + path.sep)) return new Response('', { status: 403 });
    try {
      let body = await fs.readFile(filename);
      const ext = path.extname(filename);
      if (ext === '.html') body = body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      return new Response(body, { headers: { 'Content-Type': ({ '.html': 'text/html', '.css': 'text/css', '.png': 'image/png' })[ext] || 'application/octet-stream' } });
    } catch { return new Response('', { status: 404 }); }
  });
  let screens = 0;
  for (const [name, file] of [['librarian', "Librarian's End/index.html"], ['admin', "Admin's End/index.html"], ['student', 'Student Search/search.html']]) {
    if (process.argv[2] && process.argv[2] !== name) continue;
    const window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await window.loadURL('preview://app/' + file.split('/').map(encodeURIComponent).join('/'));
    const source = await fs.readFile(path.join(root, file), 'utf8');
    let branding;
    if (name === 'librarian') {
      const script = await fs.readFile(path.join(root, "Librarian's End/js/app.js"), 'utf8');
      branding = script.slice(script.indexOf('window.electronAPI?'), script.indexOf('\n/*', script.indexOf('window.electronAPI?')));
      await window.webContents.executeJavaScript(`window.electronAPI = { getInstitution: async () => (${JSON.stringify(config)}) }; ${branding}`);
    } else {
      const start = source.indexOf("document.querySelectorAll('[data-institution-name]')");
      branding = source.slice(start, source.indexOf('\n});', start) + 4);
      await window.webContents.executeJavaScript(`{ const ${name === 'admin' ? 'institution' : 'webConfig'} = ${JSON.stringify(config)}; ${branding} }`);
      if (name === 'admin') {
        const start = source.indexOf('const STAFF_DOMAIN =');
        await window.webContents.executeJavaScript(`{ const institution = ${JSON.stringify(config)}; ${source.slice(start, source.indexOf('\nlet _data', start))} }`);
      }
    }
    assert.ok((await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-institution-name]'), el => el.textContent)`)).every(value => value === config.institutionName));
    assert.doesNotMatch(await window.webContents.executeJavaScript(`document.documentElement.outerHTML`), /me[\s_-]*academy/i);
    if (name === 'librarian') assert.equal(await window.webContents.executeJavaScript(`document.getElementById('issue-teacher-email').placeholder`), 'e.g. teacher@northbridge.edu');
    if (name === 'admin') assert.ok((await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-staff-domain]'), el => el.textContent)`)).every(value => value === '@northbridge.edu'));
    async function capture(label, script) {
      await window.webContents.executeJavaScript(script + `; new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      // Allow the offscreen compositor to publish the newly painted frame.
      await new Promise(resolve => setTimeout(resolve, 150));
      await fs.writeFile(path.join(output, name + '-' + label + '.png'), (await window.webContents.capturePage()).toPNG());
      screens++;
    }
    if (name === 'librarian') await capture('setup', `document.getElementById('setup-overlay').style.display='flex'`);
    const pages = await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.page-view'), el => el.id)`);
    for (const page of pages) {
      await capture(page, `document.getElementById('setup-overlay')?.style.setProperty('display','none'); document.querySelectorAll('.page-view').forEach(el => el.classList.toggle('active',el.id===${JSON.stringify(page)})); document.querySelectorAll('[data-page]').forEach(el => el.classList.toggle('active', 'page-' + el.dataset.page === ${JSON.stringify(page)})); document.querySelector('.page-title-area h2, .topbar h2')?.replaceChildren(document.createTextNode(${JSON.stringify(page.replace('page-', ''))}))`);
    }
    if (name === 'student') {
      for (const state of ['checking', 'signedout', 'profile', 'unverified']) await capture(state, `document.querySelectorAll('[id^="fpg-state-"]').forEach(el => el.style.display = el.id === 'fpg-state-${state}' ? 'block' : 'none')`);
      await capture('catalog', `document.getElementById('full-page-gate').style.display='none'; document.getElementById('app-content').style.display='block'`);
      for (const id of ['request-modal-overlay', 'my-requests-overlay', 'my-messages-overlay']) {
        await capture(id, `document.querySelectorAll('.req-modal-overlay').forEach(el => el.classList.toggle('show',el.id==='${id}'))`);
      }
    }
    window.destroy();
  }
  console.log(`PASS: ${screens} rendered screens; institution branding assertions passed. Screenshots: ${output}`);
  clearTimeout(deadline);
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });

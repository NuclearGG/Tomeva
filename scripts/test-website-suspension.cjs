'use strict';
// Run with an installed Playwright package; no dependency is added to the website.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require(process.env.TOMEVA_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'../web');
const release={tag_name:'v99.0.0',assets:[{name:'tomeva-control-center-99.0.0-win7-x64.exe',size:20,browser_download_url:'https://github.com/NuclearGG/Tomeva/releases/download/v99.0.0/tomeva-control-center-99.0.0-win7-x64.exe'},{name:'tomeva-control-center-99.0.0-win-x64.exe',size:30,browser_download_url:'https://github.com/NuclearGG/Tomeva/releases/download/v99.0.0/tomeva-control-center-99.0.0-win-x64.exe'}]};
test('legacy suspension: static pages, discovery, cached controls, keyboard, mobile and modern downloads',async()=>{
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;const filename=path.resolve(root,'.'+decodeURIComponent(name==='/'?'/index.html':name));if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{const bytes=fs.readFileSync(filename);const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream'});res.end(bytes);}catch{res.writeHead(404).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1080},reducedMotion:'reduce'});
  const requests=[],errors=[];const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\.exe(?:$|\?)/.test(r.url()))requests.push(r.url());});
  await context.route('https://api.github.com/repos/NuclearGG/Tomeva/releases/latest',r=>r.fulfill({json:release}));
  // Prevent real downloads; modern action is checked against the resolved URL.
  await context.route(/https:\/\/github\.com\/.*\.exe$/,r=>r.fulfill({status:200,body:'synthetic modern download',headers:{'Content-Disposition':'attachment; filename="modern-test.exe"'}}));
  await page.goto(base+'/index.html');await page.waitForFunction(()=>document.querySelector('.js-ver')?.textContent==='99.0.0');
  assert.equal(await page.locator('.js-dl-old').getAttribute('href'),'legacy-paused.html');
  assert.equal(await page.locator('a[href*="win7"],a[download][href*="legacy"]').count(),0);
  assert.equal(await page.locator('.edition-legacy .js-ver').count(),0);
  assert.equal(await page.locator('.js-dl-new').first().getAttribute('href'),release.assets[1].browser_download_url);
  await page.locator('.js-dl-old').click();await page.waitForURL('**/legacy-paused.html');assert.equal(requests.length,0);
  await page.getByRole('heading',{level:1}).waitFor();assert.match(await page.locator('h1').innerText(),/Priority Zero/);
  assert.equal(await page.locator('a[href$=".exe"]').count(),0);
  await page.getByText("Why can't I download Tomeva Legacy?",{exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await page.locator('details').first().getAttribute('open'),'');
  await page.keyboard.press('Escape');await page.waitForURL('**/index.html#download');
  // Capture-phase guard protects obsolete card hrefs as well as current markup.
  await page.locator('.js-dl-old').evaluate(a=>a.href='https://github.com/NuclearGG/Tomeva/releases/download/v99.0.0/tomeva-control-center-99.0.0-win7-x64.exe');
  await page.locator('.js-dl-old').click();await page.waitForURL('**/legacy-paused.html');assert.equal(requests.length,0);
  await page.getByRole('link',{name:'Understood — Back to Downloads'}).click();await page.waitForURL('**/index.html#download');
  const download=page.waitForEvent('download');await page.locator('.js-dl-new').nth(1).click();const modern=await download;assert.equal(modern.suggestedFilename(),'modern-test.exe');assert.equal(requests.length,1);assert(!requests[0].includes('win7'));
  await page.setViewportSize({width:390,height:844});await page.goto(base+'/legacy-paused.html');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#back-to-downloads').focus();assert.equal(await page.locator('#back-to-downloads').evaluate(a=>a===document.activeElement),true);
  await page.locator('.theme-toggle').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.goto(base+'/index.html#download');assert(await page.locator('.edition-legacy').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}));assert(await page.locator('.js-dl-old').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}));
  await context.unroute('https://api.github.com/repos/NuclearGG/Tomeva/releases/latest');await context.route('https://api.github.com/repos/NuclearGG/Tomeva/releases/latest',r=>r.fulfill({status:503,body:'Unavailable'}));await page.reload();await page.waitForFunction(()=>document.querySelector('.js-ver')?.textContent==='View release');assert.equal(await page.locator('.js-dl-old').getAttribute('href'),'legacy-paused.html');assert.equal(await page.locator('.js-dl-new').first().getAttribute('href'),'https://github.com/NuclearGG/Tomeva/releases/latest');
  assert.deepEqual(errors,[]);console.log('Verified: legacy has zero installer requests; modern synthetic download works; stale href interception; API success/failure; keyboard FAQ/Escape/return; 390px light/dark layouts; no script errors.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
});

// Invoked by session-persistence.cjs in separate Electron processes.
const {app,BrowserWindow} = require('electron');
const fs = require('node:fs');
const assert = require('node:assert/strict');
app.setPath('userData',process.env.TOMEVA_SESSION_PROFILE);
app.disableHardwareAcceleration();
const timer = setTimeout(()=>{console.error('Session test timed out');app.exit(1);},30000);
app.whenReady().then(async()=>{
  const window = new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  const run = source => window.webContents.executeJavaScript(source);
  await window.loadFile(process.env.TOMEVA_SESSION_HTML);
  const phase = Number(process.env.TOMEVA_SESSION_PHASE);
  if (phase === 1) {
    assert.equal(await run(`sessionTest.open('demo-tomeva')`),null);
    const uid = await run('sessionTest.login()');
    assert.ok(uid);
    assert.equal(await run(`sessionTest.open('demo-tomeva')`),uid,'Reconnect must retain sign-in');
    fs.writeFileSync(process.env.TOMEVA_SESSION_RESULT,JSON.stringify({uid}));
    console.log('PASS: sign-in survives reconnect.');
  } else if (phase === 2) {
    const {uid} = JSON.parse(fs.readFileSync(process.env.TOMEVA_SESSION_RESULT,'utf8'));
    assert.equal(await run(`sessionTest.open('demo-tomeva')`),uid,'Full process restart must retain sign-in');
    assert.equal(await run(`sessionTest.open('demo-tomeva',true)`),uid,'Display name and web URL changes must retain sign-in');
    await run('sessionTest.logout()');
    assert.equal(await run(`sessionTest.open('demo-tomeva')`),null,'Explicit sign-out must clear saved sign-in');
    await run('sessionTest.login()');
    assert.equal(await run(`sessionTest.open('demo-tomeva-other')`),null,'Another institution must not inherit sign-in');
    await run('sessionTest.login()');
    assert.equal(await run(`sessionTest.open('demo-tomeva')`),null,'Switching institutions must clear the previous saved session');
    await run('sessionTest.login()');
    await run('sessionTest.logout()');
    console.log('PASS: restart and cosmetic changes retain sign-in; sign-out and institution changes clear it.');
  } else {
    assert.equal(await run(`sessionTest.open('demo-tomeva')`),null,'Sign-out must survive a full process restart');
    console.log('PASS: explicit sign-out remains signed out after restart.');
  }
  clearTimeout(timer);app.exit(0);
}).catch(error=>{console.error(error);clearTimeout(timer);app.exit(1);});

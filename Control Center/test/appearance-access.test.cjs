const test = require('node:test');
const assert = require('node:assert/strict');
const { checkAppearanceAccess } = require('../src/appearance-access.cjs');
const config = { staffDomain:'college.ac.in', firebase:{projectId:'fixture-college'} };
const user = {uid:'admin-uid',email:'owner@college.ac.in',emailVerified:true,getIdTokenResult:async()=>({signInProvider:'google.com'})};
const snapshot = value => ({exists:()=>value !== null,data:()=>value});
const readers = {getStaff:async()=>snapshot({active:true}),getGrant:async()=>snapshot({enabled:true,libraryId:'main'})};

test('verified Google account on the configured domain needs both explicit grants', async()=>{
  const seen=[];
  const result=await checkAppearanceAccess({...user,email:'OWNER@COLLEGE.AC.IN'},config,{
    getStaff:async email=>{seen.push(email);return snapshot({active:true});},
    getGrant:async uid=>{seen.push(uid);return snapshot({enabled:true,libraryId:'main'});},
  });
  assert.equal(result.allowed,true);assert.deepEqual(seen,['owner@college.ac.in','admin-uid']);
});
test('configured domain, verification and Google sign-in failures are distinguished', async()=>{
  for (const [account,reason] of [[null,/Sign in/],[{...user,emailVerified:false},/not verified/],[{...user,email:'owner@gmail.com'},/@college.ac.in/],[{...user,getIdTokenResult:async()=>({signInProvider:'password'})},/not signed in through Google/],[{...user,getIdTokenResult:async()=>{throw Error('offline');}},/Could not verify/]]) {
    const result=await checkAppearanceAccess(account,config,readers);assert.equal(result.allowed,false);assert.match(result.message,reason);
  }
});
test('staff and administrator grant failures identify the exact document and field type', async()=>{
  for (const [staff,grant,reason] of [[null,{enabled:true,libraryId:'main'},/staff_accounts\/owner@college.ac.in.*boolean true/],[{active:'true'},{enabled:true,libraryId:'main'},/active to boolean true/],[{active:true},null,/kiosk_admins\/admin-uid.*libraryId/],[{active:true},{enabled:'true',libraryId:'main'},/enabled to boolean true/],[{active:true},{enabled:true,libraryId:'other'},/libraryId.*"main"/]]) {
    const result=await checkAppearanceAccess(user,config,{getStaff:async()=>snapshot(staff),getGrant:async()=>snapshot(grant)});assert.equal(result.allowed,false);assert.match(result.message,reason);assert.match(result.message,/staff_accounts|kiosk_admins/);
  }
});
test('server read failures are not reported as missing approval records', async()=>{
  for (const method of ['getStaff','getGrant']) {
    const result=await checkAppearanceAccess(user,config,{...readers,[method]:async()=>{throw Error('permission denied');}});
    assert.equal(result.allowed,false);assert.match(result.message,/Could not read/);assert.match(result.message,/fixture-college/);assert.doesNotMatch(result.message,/approval is missing/);
  }
});
test('rechecking newly created grants enables access without a second Google sign-in', async()=>{
  let grant=null;
  const checks={...readers,getGrant:async()=>snapshot(grant)};
  assert.equal((await checkAppearanceAccess(user,config,checks)).allowed,false);
  grant={enabled:true,libraryId:'main'};
  assert.equal((await checkAppearanceAccess(user,config,checks)).allowed,true);
});

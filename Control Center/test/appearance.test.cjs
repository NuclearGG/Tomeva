const test = require('node:test');
const assert = require('node:assert/strict');
const appearance = require('../../desktop-integration/interface/appearance.js');

test('appearance permits only bounded presentation properties, never executable content', () => {
  const value = appearance.validate({ ...appearance.defaults, brandEnabled:true, accentColor:'#175A46', displayName:'  School library  ', customCss:'body{display:none}', script:'evil()' });
  assert.equal(value.displayName,'School library');
  assert.equal(value.accentColor,'#175a46');
  assert.equal(Object.hasOwn(value,'customCss'),false);
  assert.equal(Object.hasOwn(value,'script'),false);
  for (const patch of [{schemaVersion:2},{brandEnabled:'true'},{accentColor:'url(https://bad.invalid)'},{surfaceTone:'dark'},{typography:'https://font.invalid'},{density:'hidden'},{corners:'100px'},{displayName:'x'.repeat(121)},{portalHeading:'x'.repeat(101)},{notice:'x'.repeat(281)}]) {
    assert.throws(() => appearance.validate({...appearance.defaults,...patch}));
  }
});

test('brand colours must retain readable white button labels, and may be switched off', () => {
  for (const color of ['#ffffff','#ffff00','#aaaaaa']) assert.throws(() => appearance.validate({...appearance.defaults,brandEnabled:true,accentColor:color}),/contrast/);
  for (const color of ['#302866','#175a46','#000000','#85351d']) {
    assert.ok(appearance.contrast(color) >= 4.5);
    assert.doesNotThrow(() => appearance.validate({...appearance.defaults,brandEnabled:true,accentColor:color}));
  }
  assert.doesNotThrow(() => appearance.validate({...appearance.defaults,brandEnabled:false,accentColor:'#ffffff'}));
  assert.equal(appearance.defaults.brandEnabled,false);
});

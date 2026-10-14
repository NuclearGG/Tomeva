/* Public, data-only institution appearance. No remote HTML, CSS or scripts. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TomevaAppearance = api;
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  const defaults = Object.freeze({
    schemaVersion: 1, brandEnabled: false, accentColor: '#302866',
    surfaceTone: 'catalogue', typography: 'manrope', density: 'comfortable',
    corners: 'soft', displayName: '', portalHeading: 'Find your next read.', notice: '',
  });
  const fields = Object.keys(defaults);
  function contrast(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return 0;
    const rgb = hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255)
      .map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
    return 1.05 / (.2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2] + .05);
  }
  function validate(input) {
    if (!input || input.schemaVersion !== 1) throw new Error('Unsupported appearance format. Update Tomeva to use these settings.');
    const result = {};
    if (typeof input.brandEnabled !== 'boolean') throw new Error('Choose whether to use brand colours.');
    if (typeof input.accentColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.accentColor) || (input.brandEnabled && contrast(input.accentColor) < 4.5)) throw new Error('Choose a darker accent colour so white button labels remain readable (contrast 4.5:1).');
    result.schemaVersion = 1; result.brandEnabled = input.brandEnabled; result.accentColor = input.accentColor.toLowerCase();
    for (const [key, allowed] of Object.entries({ surfaceTone:['catalogue','warm'], typography:['manrope','system','editorial'], density:['comfortable','compact'], corners:['soft','crisp'] })) {
      if (!allowed.includes(input[key])) throw new Error('Choose a supported ' + key + '.');
      result[key] = input[key];
    }
    for (const [key, max] of Object.entries({ displayName:120, portalHeading:100, notice:280 })) {
      if (typeof input[key] !== 'string' || input[key].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input[key])) throw new Error('Invalid ' + key + ' (maximum ' + max + ' characters).');
      result[key] = input[key].trim();
    }
    return result;
  }
  function mix(hex, white) {
    return '#' + hex.slice(1).match(/../g).map(x => Math.max(0, Math.min(255, Math.round(parseInt(x,16)*(1-white)+255*white))).toString(16).padStart(2,'0')).join('');
  }
  function apply(input, options = {}) {
    const value = validate(input), doc = options.document || document, html = doc.documentElement;
    const accent = value.brandEnabled ? value.accentColor : defaults.accentColor;
    html.style.setProperty('--bookcloth', accent);
    html.style.setProperty('--bookcloth-hover', mix(accent, -.2));
    html.style.setProperty('--selection', mix(accent, .91));
    html.style.setProperty('--focus', accent);
    html.style.setProperty('--rule-emphasis', mix(accent, .6));
    html.style.setProperty('--blue-mid', mix(accent, .65));
    html.dataset.surfaceTone = value.surfaceTone; html.dataset.typography = value.typography;
    html.dataset.density = value.density; html.dataset.corners = value.corners;
    const fallback = options.institutionName || '';
    doc.querySelectorAll('[data-institution-name]').forEach(el => {
      if (!el.dataset.appearanceOriginal) el.dataset.appearanceOriginal = fallback || el.textContent;
      el.textContent = value.displayName || fallback || el.dataset.appearanceOriginal;
    });
    const heading = doc.querySelector('.t-workspace-student .hero-title');
    if (heading) heading.textContent = value.portalHeading || defaults.portalHeading;
    let banner = doc.getElementById('institution-appearance-notice');
    if (!banner && doc.body) {
      banner = doc.createElement('div'); banner.id = 'institution-appearance-notice';
      banner.className = 'institution-appearance-notice'; banner.setAttribute('role', 'status');
      const host = doc.querySelector('.t-workspace-student header, .topbar');
      if (host) host.insertAdjacentElement('afterend', banner);
    }
    if (banner) { banner.textContent = value.notice; banner.hidden = !value.notice; }
    return value;
  }
  function cacheKey(projectId) {
    if (!/^[a-z0-9-]{4,80}$/.test(projectId || '')) throw new Error('Invalid appearance project.');
    return 'tomeva-appearance-v1:' + projectId + ':main';
  }
  function load(projectId, options = {}) {
    let value = defaults;
    try { const cached = JSON.parse(localStorage.getItem(cacheKey(projectId))); if (cached) value = validate(cached); } catch (_) { /* Safe built-in defaults. */ }
    return apply(value, options);
  }
  function receive(projectId, snapshot, options = {}) {
    // Do not cache speculative writes or erase last-known settings on an offline miss.
    if (snapshot.metadata?.hasPendingWrites) return;
    const exists = typeof snapshot.exists === 'function' ? snapshot.exists() : snapshot.exists;
    if (!exists && snapshot.metadata?.fromCache) return;
    const value = validate(exists ? snapshot.data() : defaults);
    apply(value, options);
    try { localStorage.setItem(cacheKey(projectId), JSON.stringify(value)); } catch (_) { /* Storage may be unavailable. */ }
    return value;
  }
  function bindCompat(db, projectId, options = {}) {
    load(projectId, options);
    return db.collection('libraries').doc('main').collection('public').doc('appearance')
      .onSnapshot({ includeMetadataChanges:true }, snap => {
        try { receive(projectId, snap, options); } catch (error) { console.warn('[Appearance]', error.message); }
      }, error => console.warn('[Appearance] Keeping cached appearance:', error.code));
  }
  return { defaults, fields, validate, contrast, apply, load, receive, bindCompat };
});

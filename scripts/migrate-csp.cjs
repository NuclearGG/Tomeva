'use strict';
// One-time source migration. Browser handlers become statically compiled listeners.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const [folder, htmlName, moduleName] of [["Admin's End", 'index.html', 'app.mjs'], ['Student Search', 'search.html', 'portal.mjs'], ["Librarian's End", 'index.html', null]]) {
  const base = path.join(root, folder), file = path.join(base, htmlName);
  let html = fs.readFileSync(file, 'utf8');
  if (!/\son(?:click|input)=/.test(html)) continue;
  const handlers = new Map();
  const transform = source => source.replace(/\son(click|input)="([^"]+)"/g, (_, event, expression) => {
    expression = expression.replace(/\\'/g, "'").replace(/\brenderSyncStats\b/g, '_renderSyncStats');
    const key = event + ':' + expression;
    if (!handlers.has(key)) handlers.set(key, { event, expression, id: 'h' + handlers.size });
    return ' data-handler-' + event + '="' + handlers.get(key).id + '"';
  });
  html = transform(html);
  if (!moduleName) {
    const appFile = path.join(base, 'js/app.js');
    fs.writeFileSync(appFile, transform(fs.readFileSync(appFile, 'utf8')));
  }
  let binding = '\n// Compiled event handlers. Data attributes never contain executable code.\n';
  for (const event of ['click', 'input']) {
    binding += `document.addEventListener('${event}', function(event) {\n  const element = event.target.closest('[data-handler-${event}]');\n  if (!element) return;\n  let result;\n  switch (element.dataset.handler${event[0].toUpperCase() + event.slice(1)}) {\n`;
    for (const item of handlers.values()) if (item.event === event) binding += `    case '${item.id}': result = (function(event) { ${item.expression} }).call(element, event); break;\n`;
    binding += '  }\n  if (result === false) event.preventDefault();\n});\n';
  }
  let classic = 0;
  html = html.replace(/<script([^>]*)>([\s\S]*?)<\/script>/g, (tag, attributes, source) => {
    if (/\bsrc=/.test(attributes)) return tag;
    const isModule = /type="module"/.test(attributes);
    const name = isModule ? moduleName : (moduleName ? 'connection.js' : `js/inline-${++classic}.js`);
    if (isModule) {
      const last = source.lastIndexOf('}');
      source = source.slice(0, last) + binding + '\n' + source.slice(last);
      source = source.replace(/https:\/\/www\.gstatic\.com\/firebasejs\/12\.13\.0\/firebase-(app|auth|firestore)\.js/g, 'firebase/$1');
    }
    fs.mkdirSync(path.dirname(path.join(base, name)), { recursive: true });
    fs.writeFileSync(path.join(base, name), source);
    return `<script${isModule ? ' type="module"' : ''} src="${isModule ? 'app.bundle.js' : name}"></script>`;
  });
  if (!moduleName) {
    fs.writeFileSync(path.join(base, 'js/event-bindings.js'), binding);
    html = html.replace('</body>', '<script src="js/event-bindings.js"></script>\n</body>');
  }
  html = html.replace("script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com", "script-src 'self' https://apis.google.com")
    .replace("script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://www.gstatic.com", "script-src 'self'");
  fs.writeFileSync(file, html);
}
const kioskFile = path.join(root, "Admin's End/kiosk-management.js");
fs.writeFileSync(kioskFile, fs.readFileSync(kioskFile, 'utf8').replace(/https:\/\/www\.gstatic\.com\/firebasejs\/12\.13\.0\/firebase-(app|auth|firestore)\.js/g, 'firebase/$1'));

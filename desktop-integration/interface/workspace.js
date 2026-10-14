/* Shared presentation and keyboard affordances; business rules remain in the apps. */
(() => {
  'use strict';
  const glyphs = new Map(Object.entries({
    '🏠':'squares-four', '📊':'chart-bar', '📚':'books', '📗':'book-open', '📖':'book-open',
    '📤':'arrow-up-right', '📥':'arrow-down-left', '💰':'coins', '⚠️':'warning-circle', '⚠':'warning-circle',
    '⏰':'clock', '🔍':'magnifying-glass', '📋':'list-bullets', '🎓':'student', '📩':'tray', '📭':'tray',
    '🔔':'bell', '⚙️':'gear-six', '⚙':'gear-six', '🔒':'lock-key', '🔐':'shield-check', '🔑':'key',
    '✅':'check-circle', '✓':'check', '✔':'check', '❌':'x', '🚫':'prohibit', '🚦':'shield-check',
    '👤':'user', '👨‍🏫':'user', '📡':'cloud-slash', '🔧':'gear-six', '💬':'chat-circle', '✉️':'chat-circle', '⏳':'clock', 'ℹ️':'file-text',
    '⬆':'upload-simple', '⬇':'download-simple', '↻':'arrows-clockwise', '🎉':'check-circle', '🎊':'check-circle', '💸':'coins', '⭐':'student'
  }));
  const pattern = new RegExp([...glyphs.keys()].sort((a,b) => b.length-a.length).join('|'), 'gu');
  const targets = '.nav-icon,.stat-icon,.action-card-icon,.empty-icon,.notif-icon-col,.card-title,.section-title,.btn,.button,.refresh-btn,.setup-btn,.issue-mode-btn,.toast>span:first-child,.search-bar>span:first-child,.modal-title,.workspace-symbol,.overdue-chip,.search-icon,.stat-pill-icon,.book-card-footer,.request-btn,.filter-chip,.state-icon,.fpg-icon:not(img),.card-icon,.update-icon';
  function icons(root) {
    const elements = [...root.querySelectorAll?.(targets) || []];
    if (root.matches?.(targets)) elements.unshift(root);
    for (const element of elements) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('.t-icon,script,style,textarea,option')) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const value = node.nodeValue; pattern.lastIndex = 0;
        if (!pattern.test(value)) continue;
        pattern.lastIndex = 0;
        const fragment = document.createDocumentFragment(); let index = 0;
        for (const match of value.matchAll(pattern)) {
          fragment.append(document.createTextNode(value.slice(index, match.index)));
          const icon = document.createElement('span'); icon.className = 't-icon'; icon.dataset.icon = glyphs.get(match[0]); icon.setAttribute('aria-hidden','true');
          fragment.append(icon); index = match.index + match[0].length;
        }
        fragment.append(document.createTextNode(value.slice(index))); node.replaceWith(fragment);
      }
    }
  }
  function navigation() {
    document.querySelectorAll('.nav-item[data-page]').forEach(button => {
      if (button.classList.contains('active')) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
  }
  function start() {
    const admin = !!document.getElementById('page-overview');
    if (!document.body.classList.contains('t-workspace-control') && !document.body.classList.contains('t-workspace-student'))
      document.body.classList.add(admin ? 't-workspace-admin' : 't-workspace-librarian');
    const brand = document.querySelector('.sidebar-logo');
    if (brand) {
      brand.querySelector('h1')?.remove();
      const name = document.createElement('span'); name.className = 'workspace-brand'; name.textContent = 'Tomeva';
      const role = document.createElement('span'); role.className = 'workspace-role'; role.textContent = admin ? 'Administration' : 'Circulation desk';
      const image = brand.querySelector('img'); image?.after(name, role);
    }
    document.querySelectorAll('.nav-divider').forEach((divider,index) => {
      divider.textContent = (admin ? ['Collection','Administration','Communication','System'] : ['Circulation','Catalogue','Community'])[index] || '';
      divider.setAttribute('aria-hidden','true');
    });
    const title = document.querySelector('.page-title-area');
    if (title) {
      const breadcrumb = document.createElement('span'); breadcrumb.className = 'workspace-breadcrumb';
      breadcrumb.textContent = admin ? 'Tomeva / Administration' : 'Tomeva / Circulation desk'; title.prepend(breadcrumb);
    }
    const search = document.getElementById('topbar-search');
    if (search) {
      search.placeholder = 'Find a book or reader'; search.setAttribute('aria-label','Search books and students');
      const hint = document.createElement('kbd'); hint.className = 'shortcut-hint'; hint.textContent = 'Ctrl K'; search.after(hint);
    }
    // Connect existing visible field labels to their inputs without changing field order.
    document.querySelectorAll('.form-group').forEach(group => {
      const label = group.querySelector('label'), control = group.querySelector('input[id],select[id],textarea[id]');
      if (label && control && !label.htmlFor && !label.contains(control)) label.htmlFor = control.id;
    });
    icons(document.body); navigation();
    let pending = false;
    const dirty = new Set();
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') { navigation(); continue; }
        if (record.target.nodeType === 1) dirty.add(record.target);
      }
      if (!pending && dirty.size) {
        pending = true; queueMicrotask(() => { pending = false; const changed = [...dirty]; dirty.clear(); changed.forEach(icons); });
      }
    }).observe(document.body, { subtree:true, childList:true, attributes:true, attributeFilter:['class'] });
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-workspace-page]');
    if (!button) return;
    const page = button.dataset.workspacePage;
    if (window.adminApp) window.adminApp.navigate(page);
    else if (typeof window.navigate === 'function') window.navigate(page);
    const input = document.getElementById(page === 'issue' ? 'issue-student-id' : page === 'return' ? 'return-book-id' : '');
    input?.focus();
  });
  document.addEventListener('keydown', event => {
    if (document.querySelector('.modal-overlay.show, #workstation-lock-screen:not([hidden])')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      const input = document.getElementById('topbar-search') || document.getElementById('search-input'); if (input) { event.preventDefault(); input.focus(); input.select(); }
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && !/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) {
      const page = ({ i:'issue', r:'return' })[event.key.toLowerCase()];
      if (page && typeof window.navigate === 'function') { event.preventDefault(); window.navigate(page); document.getElementById(page === 'issue' ? 'issue-student-id' : 'return-book-id')?.focus(); }
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true}); else start();
})();

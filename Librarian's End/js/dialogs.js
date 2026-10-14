/* Shared keyboard behavior for local editor and confirmation dialogs. */
(() => {
  'use strict';
  let current = null;
  let returnFocus = null;
  let lastFocus = document.activeElement;
  const selector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]';
  const controls = overlay => [...overlay.querySelectorAll(selector)].filter(el => el.getClientRects().length);
  function activeDialog() {
    return [...document.querySelectorAll('.modal-overlay.show')].filter(el => !el.hidden).pop() || null;
  }
  function update() {
    const next = activeDialog();
    if (next === current) return;
    if (!next) {
      current = null;
      if (returnFocus?.isConnected) returnFocus.focus();
      returnFocus = null;
      return;
    }
    if (!current) returnFocus = next.contains(document.activeElement) ? lastFocus : document.activeElement;
    current = next;
    const panel = next.querySelector('.modal');
    if (panel) {
      panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
      const title = panel.querySelector('h2, .modal-title');
      if (title) { title.id ||= 'dialog-title-' + (next.id || 'confirmation'); panel.setAttribute('aria-labelledby', title.id); }
    }
    if (!next.contains(document.activeElement)) controls(next)[0]?.focus();
  }
  document.addEventListener('focusin', event => {
    update();
    if (current && !current.contains(event.target)) controls(current)[0]?.focus();
    else if (!current) lastFocus = event.target;
  });
  document.addEventListener('keydown', event => {
    update();
    if (!current) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      const cancel = current.querySelector('[data-dialog-cancel], [id^="close-"], #cancel-restore-btn');
      if (cancel) cancel.click(); else current.classList.remove('show');
      update();
    } else if (event.key === 'Tab') {
      const items = controls(current), first = items[0], last = items[items.length - 1];
      if (!items.length) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }, true);
  new MutationObserver(update).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  update();
})();

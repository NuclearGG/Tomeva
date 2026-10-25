(function () {
  "use strict";
  const root = document.documentElement;
  const toggle = document.querySelector('.theme-toggle');
  root.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  function label() { toggle.querySelector('span').textContent = root.dataset.theme === 'dark' ? 'Day' : 'Night'; }
  toggle.addEventListener('click', function () { root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; label(); });
  label();
  // This is a dedicated notice page, so Escape returns to its download section.
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') window.location.assign('index.html#download');
  });
})();

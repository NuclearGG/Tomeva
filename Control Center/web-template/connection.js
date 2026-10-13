
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('fpg-retry-button')?.addEventListener('click', event => { event.stopPropagation(); location.reload(); });
  setTimeout(() => {
    if (window._tomevaAuthReady) return;
    const message = document.getElementById('fpg-loading-message');
    const retry = document.getElementById('fpg-retry-button');
    if (message) message.textContent = 'Could not reach the sign-in service. Check your connection and try again.';
    if (retry) retry.style.display = 'block';
  }, 20000);
});

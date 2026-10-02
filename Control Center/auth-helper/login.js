import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js';
import { initializeAuth, inMemoryPersistence, browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js';

const state = new URLSearchParams(location.hash.slice(1)).get('state');
history.replaceState(null, '', location.pathname);
const button = document.getElementById('sign-in');
const status = document.getElementById('status');
const config = window.TOMEVA_WEB_CONFIG;
if (!config?.firebase || !state || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
  status.textContent = 'Open this page from Admin after deploying your institution setup bundle.';
} else {
  const app = initializeApp(config.firebase);
  const auth = initializeAuth(app, { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver });
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  button.disabled = false;
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'Complete sign-in in the Google window.';
    try {
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.idToken && !credential?.accessToken) throw new Error('Google did not return a credential.');
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = 'http://127.0.0.1:51734/auth-callback';
      for (const [name, value] of Object.entries({ state, credential: credential.idToken || '', accessToken: credential.accessToken || '' })) {
        const input = document.createElement('input');
        input.type = 'hidden'; input.name = name; input.value = value; form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    } catch (error) {
      status.textContent = `Sign-in failed (${error.code || error.message}).`;
      button.disabled = false;
    }
  });
}

const crypto = require('node:crypto');
const http = require('node:http');

const PORT = 51734;

function reply(res, status, message) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(message);
}

// Firebase owns the Google provider credentials. The desktop receives only
// the short-lived result of signInWithPopup, never a provider client secret.
// No Google OAuth client ID/secret or legacy server.js is required by this flow.
class OAuthFlow {
  constructor({ openExternal, notify, getLoginUrl = () => null, port = PORT, timeoutMs = 5 * 60 * 1000 }) {
    this.openExternal = openExternal;
    this.notify = notify;
    this.getLoginUrl = getLoginUrl;
    this.loginOrigin = null;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.server = null;
    this.state = null;
    this.timeout = null;
    this.inProgress = false;
  }

  async start() {
    if (this.inProgress) return false;
    const loginUrl = this.getLoginUrl();
    if (!loginUrl) throw new Error('Import the institution setup before signing in.');
    if (new URL(loginUrl).protocol !== 'https:') throw new Error('Sign-in helper must use HTTPS.');
    this.loginOrigin = new URL(loginUrl).origin;
    this.inProgress = true;
    this.state = crypto.randomBytes(32).toString('base64url');
    try {
      const server = http.createServer((req, res) => {
        this.handleCallback(req, res, server.address()?.port).catch(() => {
          if (!res.writableEnded) reply(res, 400, 'Invalid sign-in response. Try signing in again from Tomeva.');
        });
      });
      this.server = server;
      server.requestTimeout = 15000;
      server.headersTimeout = 10000;
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.port, '127.0.0.1', resolve);
      });
      this.timeout = setTimeout(() => {
        this.notify({ error: 'sign_in_timed_out', errorDescription: 'Sign-in timed out. Please try again.' });
        this.stop();
      }, this.timeoutMs);
      // Fragment keeps the state out of hosting access logs and referrers.
      await this.openExternal(`${loginUrl}#state=${this.state}`);
      return true;
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  async handleCallback(req, res, port) {
    if (req.method !== 'POST' || req.url !== '/auth-callback') {
      reply(res, 404, 'Start sign-in from the Tomeva Admin app.');
      return;
    }
    if (req.headers.host !== `127.0.0.1:${port}` || req.headers.origin !== this.loginOrigin ||
        req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') {
      reply(res, 403, 'Untrusted sign-in response.');
      return;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 32768) {
        reply(res, 413, 'Sign-in response is too large.');
        return;
      }
      chunks.push(chunk);
    }
    const result = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    const actual = Buffer.from(result.get('state') || '');
    const expected = Buffer.from(this.state || '');
    if (!this.inProgress || !this.state || actual.length !== expected.length ||
        !crypto.timingSafeEqual(actual, expected)) {
      reply(res, 400, 'This sign-in has expired or does not match Tomeva. Start sign-in again from the app.');
      return;
    }
    const credential = result.get('credential');
    const accessToken = result.get('accessToken');
    if (!credential && !accessToken) {
      reply(res, 400, 'No Google credential received. Please try again.');
      return;
    }
    this.state = null; // Consume once before delivering the result through IPC.
    this.notify({ credential, accessToken });
    reply(res, 200, 'Google sign-in received. Return to Tomeva Admin to continue. You can close this tab.');
    this.stop();
  }

  stop() {
    clearTimeout(this.timeout);
    this.timeout = null;
    this.state = null;
    this.inProgress = false;
    if (this.server?.listening) this.server.close();
    this.server = null;
  }
}

module.exports = { OAuthFlow };

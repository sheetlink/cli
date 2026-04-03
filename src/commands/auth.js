/**
 * auth.js - `sheetlink auth`
 *
 * Two paths:
 *   API key (MAX):  `sheetlink auth --api-key sl_...`
 *                   Stores key in ~/.sheetlink/config.json
 *
 *   OAuth (PRO):    `sheetlink auth`
 *                   Opens Google OAuth in browser, exchanges for JWT,
 *                   stores JWT in config file.
 *
 * Note: PRO JWT auth is interactive only — tokens expire ~1hr.
 * For unattended automation, use MAX tier + API key.
 */

import http from 'http';
import { randomBytes } from 'crypto';
import { writeConfig, getApiUrl } from '../config.js';
import { getTierStatus, listItems } from '../api.js';

const GOOGLE_CLIENT_ID = '967710910027-qq2tuel7vsi2i06h4h096hbvok8kfmhk.apps.googleusercontent.com';
const REDIRECT_PORT = 9876;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

export async function cmdAuth(options) {
  // --- API key path ---
  if (options.apiKey) {
    if (!options.apiKey.startsWith('sl_')) {
      console.error('Invalid API key format. Keys should start with sl_');
      process.exit(1);
    }

    // Warn about shell history exposure
    console.error('');
    console.error('Security note: API keys passed via --api-key may appear in your shell history.');
    console.error('Consider setting SHEETLINK_API_KEY as an environment variable instead:');
    console.error('  export SHEETLINK_API_KEY=sl_...');
    console.error('');

    writeConfig({ api_key: options.apiKey, jwt: null });
    console.log('API key saved to ~/.sheetlink/config.json');
    console.log('');

    // Verify it works by hitting an API-key-aware endpoint
    try {
      const { items } = await listItems();
      console.log(`Authenticated. ${items.length} bank${items.length !== 1 ? 's' : ''} connected.`);
    } catch (e) {
      console.error(`Could not verify key: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  // --- OAuth / JWT path (PRO interactive) ---
  console.log('Opening Google sign-in in your browser...');
  console.log('');

  const idToken = await googleOAuthFlow();
  const jwt = await exchangeGoogleToken(idToken);

  writeConfig({ jwt, api_key: null });
  console.log('');
  console.log('Authenticated. JWT saved to ~/.sheetlink/config.json');
  console.log('Note: JWT expires in ~1 hour. Re-run `sheetlink auth` when needed.');
  console.log('For unattended automation, upgrade to MAX and use `sheetlink auth --api-key sl_...`');
}

async function googleOAuthFlow() {
  return new Promise((resolve, reject) => {
    const state = randomBytes(16).toString('hex');
    const nonce = randomBytes(16).toString('hex');

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'id_token',
      scope: 'openid email profile',
      state,
      nonce,
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

    // Start local server to catch the redirect
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);

      // Google returns id_token in the fragment (#) which is client-side only.
      // We serve a tiny page that POSTs it to our server.
      if (url.pathname === '/callback') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<body>
<script>
  const params = new URLSearchParams(location.hash.slice(1));
  fetch('/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ id_token: params.get('id_token'), state: params.get('state') })
  }).then(() => {
    document.body.innerHTML = '<p>Authenticated! You can close this tab.</p>';
  });
</script>
</body>
</html>`);
        return;
      }

      if (url.pathname === '/token' && req.method === 'POST') {
        let body = '';
        req.on('data', d => body += d);
        req.on('end', () => {
          res.writeHead(200);
          res.end('ok');
          server.close();
          try {
            const { id_token, state: returnedState } = JSON.parse(body);
            if (returnedState !== state) return reject(new Error('State mismatch — possible CSRF'));
            resolve(id_token);
          } catch (e) {
            reject(e);
          }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(REDIRECT_PORT, async () => {
      try {
        const { default: open } = await import('open');
        await open(authUrl);
      } catch {
        console.log(`Open this URL in your browser:\n${authUrl}`);
      }
    });

    server.on('error', reject);
    setTimeout(() => { server.close(); reject(new Error('OAuth timeout (2 minutes)')); }, 120_000);
  });
}

async function exchangeGoogleToken(idToken) {
  const res = await fetch(`${getApiUrl()}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: idToken }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Login failed: ${err.detail || res.statusText}`);
  }

  const data = await res.json();
  return data.token;
}

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

const GOOGLE_CLIENT_ID = '967710910027-j88nejbs5rnjb5b4801er8sffkv4crdb.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const REDIRECT_PORT = 9876;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

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

    // Authorization code flow (Desktop app client)
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'online',
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

    // Start local server to catch the authorization code redirect
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname === '/' || url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SheetLink — Authenticated</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f9fafb;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      color: #111;
    }
    .card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      padding: 48px 40px;
      text-align: center;
      max-width: 380px;
      width: 90%;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }
    .icon {
      width: 48px;
      height: 48px;
      background: #d1fae5;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
    }
    h1 { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
    p { font-size: 14px; color: #6b7280; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg width="24" height="24" fill="none" stroke="#059669" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </div>
    <h1>You're signed in</h1>
    <p>Authentication complete. You can close this tab and return to the terminal.</p>
  </div>
</body>
</html>`);
        server.close();

        if (error) return reject(new Error(`OAuth error: ${error}`));
        if (returnedState !== state) return reject(new Error('State mismatch — possible CSRF'));
        if (!code) return reject(new Error('No authorization code received'));

        // Exchange code for id_token via token endpoint
        exchangeCodeForIdToken(code).then(resolve).catch(reject);
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

async function exchangeCodeForIdToken(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Token exchange failed: ${err.error_description || err.error || res.statusText}`);
  }

  const data = await res.json();
  if (!data.id_token) throw new Error('No id_token in token response');
  return data.id_token;
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

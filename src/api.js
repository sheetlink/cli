/**
 * api.js - SheetLink API client
 *
 * Thin wrapper around fetch for the SheetLink backend.
 * All endpoints require Authorization: Bearer <token>.
 */

import { getApiUrl, getAuthHeader, getApiKey } from './config.js';

// A 401 means the credential we sent is no longer good. API-key users and browser-login users
// need different next steps, so branch on what was actually sent (not on what is configured:
// `auth --api-key` verifies a new key before saving it). Pro logins expiring is also the moment
// a scheduled run fails, so point at API keys (MAX) there.
// A sync spinner may own the current stderr line (it redraws with \r); start the message on a clean
// line: clear it in a terminal, or end it in a log file (cron).
function freshLine() {
  process.stderr.write(process.stderr.isTTY ? '\r\x1b[K' : '\n');
}

export function exitUnauthorized(sentAuth = '') {
  freshLine();
  // Also match the configured key itself: a key mangled in transit (e.g. quotes kept by
  // `docker --env-file`) loses the sl_ prefix but is still an API key, not a browser login.
  const key = getApiKey();
  if (sentAuth.startsWith('Bearer sl_') || (key && sentAuth === `Bearer ${key}`)) {
    const fromEnv = process.env.SHEETLINK_API_KEY && sentAuth === `Bearer ${process.env.SHEETLINK_API_KEY}`;
    console.error('Your API key was not accepted (revoked or mistyped).');
    console.error(fromEnv
      ? 'Create a new key at https://sheetlink.app/dashboard/api-keys and update SHEETLINK_API_KEY.'
      : 'Create a new key at https://sheetlink.app/dashboard/api-keys, then run `sheetlink auth --api-key <key>`.');
  } else {
    console.error('Your SheetLink login has expired (logins last 4 hours). Run `sheetlink auth` to sign in again.');
    console.error('To run on a schedule, use an API key (MAX): https://sheetlink.app/dashboard/api-keys');
  }
  process.exit(1);
}

// `authOverride` lets `auth --api-key` verify the new key instead of the configured credential.
async function request(method, path, body = null, authOverride = null) {
  const auth = authOverride || getAuthHeader();
  if (!auth) {
    console.error('Not authenticated. Run `sheetlink auth` to set up credentials.');
    process.exit(1);
  }

  const url = `${getApiUrl()}${path}`;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': auth,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);

  if (!res.ok) {
    let detail = res.statusText;
    let errorBody = null;
    try {
      errorBody = await res.json();
      detail = errorBody.detail || JSON.stringify(errorBody);
    } catch {}

    // A per-item connection problem (needs reconnect / no accounts). The backend surfaces
    // these as 422 with a human-readable `detail` (Plaid's display_message). Older backends
    // used a structured 401; handle both so the CLI prints a clean "reconnect" message
    // instead of a raw API error. Marked with err.code so cmdSync can format it per-item.
    const detailObj = typeof detail === 'object' ? detail : (errorBody?.detail ?? null);
    const legacyLoginReq = res.status === 401 && detailObj && detailObj.error_code === 'ITEM_LOGIN_REQUIRED';
    if (res.status === 422 || legacyLoginReq) {
      const err = new Error('ITEM_NEEDS_ATTENTION');
      err.code = 'ITEM_NEEDS_ATTENTION';
      // message = the human display_message (string) when present, else the structured one
      err.detail = legacyLoginReq
        ? 'Bank connection expired. Reconnect at https://sheetlink.app/dashboard/banks'
        : (typeof detail === 'string' ? detail : 'This bank needs to be reconnected at https://sheetlink.app/dashboard/banks');
      if (detailObj && detailObj.item_id) err.item_id = detailObj.item_id;
      throw err;
    }
    if (res.status === 401) {
      exitUnauthorized(auth);
    }
    if (res.status === 403) {
      // Some 403s carry a structured detail ({ error, feature, message }), e.g. investments upgrade_required.
      const structured = detail && typeof detail === 'object';
      freshLine();
      console.error(`Access denied: ${structured ? (detail.message || JSON.stringify(detail)) : detail}`);
      if (structured && detail.error === 'upgrade_required') console.error('Upgrade at https://sheetlink.app/pricing');
      process.exit(1);
    }
    // Attach status + structured detail so callers can distinguish e.g. 409 (not-enabled) vs
    // 425 (warming) for investments. Additive — existing callers only read e.code, unaffected.
    const err = new Error(`API error ${res.status}: ${detail}`);
    err.status = res.status;
    err.detail = detailObj || detail;
    throw err;
  }

  return res.json();
}

export async function listItems(authOverride = null) {
  return request('GET', '/api/items', null, authOverride);
}

// DATE-FILTER: `range` is an optional { start, end } (YYYY-MM-DD). When present, the backend pulls
// that window (clamped to the plan's 730-day cap) instead of the default full-window sync.
export async function syncItem(itemId, range = null) {
  const body = { item_id: itemId };
  if (range && (range.start || range.end)) {
    if (range.start) body.start_date = range.start;
    if (range.end) body.end_date = range.end;
  }
  return request('POST', '/api/sync', body);
}

// Note: an expired or invalid token gets a 401 here (request() handles it). Only a request with no
// Authorization header is answered anonymously ({ authenticated: false, tier: 'free' }).
export async function getTierStatus() {
  return request('GET', '/tier/status');
}

// Investments (MAX-only). Hit the CLI-specific /api/investments/* endpoints. Only items with
// investment tracking enabled return data; the server returns a clean error otherwise (never a
// charge). request() maps 422 -> ITEM_NEEDS_ATTENTION and 403 -> exit; the investments command
// inspects e.code / e.status to print the right per-item message (not-enabled / reconnect / warming).
export async function getInvestmentHoldings(itemId) {
  return request('POST', '/api/investments/holdings', { item_id: itemId });
}

export async function getInvestmentTransactions(itemId, range = null) {
  const body = { item_id: itemId };
  if (range && (range.start || range.end)) {
    if (range.start) body.start_date = range.start;
    if (range.end) body.end_date = range.end;
  }
  return request('POST', '/api/investments/transactions', body);
}

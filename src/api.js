/**
 * api.js - SheetLink API client
 *
 * Thin wrapper around fetch for the SheetLink backend.
 * All endpoints require Authorization: Bearer <token>.
 */

import { getApiUrl, getAuthHeader } from './config.js';

async function request(method, path, body = null) {
  const auth = getAuthHeader();
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
      console.error('Authentication failed. Run `sheetlink auth` to re-authenticate.');
      process.exit(1);
    }
    if (res.status === 403) {
      console.error(`Access denied: ${detail}`);
      process.exit(1);
    }
    throw new Error(`API error ${res.status}: ${detail}`);
  }

  return res.json();
}

export async function listItems() {
  return request('GET', '/api/items');
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

export async function getTierStatus() {
  return request('GET', '/tier/status');
}

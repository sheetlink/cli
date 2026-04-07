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

    if (res.status === 401) {
      // Structured ITEM_LOGIN_REQUIRED from backend
      const detailObj = typeof detail === 'object' ? detail : (errorBody?.detail ?? null);
      if (detailObj && detailObj.error_code === 'ITEM_LOGIN_REQUIRED') {
        const err = new Error('ITEM_LOGIN_REQUIRED');
        err.code = 'ITEM_LOGIN_REQUIRED';
        err.item_id = detailObj.item_id;
        throw err;
      }
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

export async function syncItem(itemId) {
  return request('POST', '/api/sync', { item_id: itemId });
}

export async function getTierStatus() {
  return request('GET', '/tier/status');
}

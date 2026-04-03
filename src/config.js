/**
 * config.js - Read/write ~/.sheetlink/config.json
 *
 * Config file stores:
 *   api_key        - SheetLink API key (sl_...) for MAX tier unattended auth
 *   jwt            - JWT token for PRO tier interactive auth
 *   default_output - Default output mode (json, csv, postgres://..., sqlite://...)
 *   api_url        - Backend URL (default: https://api.sheetlink.app)
 *
 * Priority for API key: SHEETLINK_API_KEY env var > config file
 * Priority for JWT: config file only (set by `sheetlink auth`)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.sheetlink');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_API_URL = 'https://api.sheetlink.app';

export function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function writeConfig(updates) {
  const current = readConfig();
  const next = { ...current, ...updates };

  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { mode: 0o700 });
  } else {
    // Enforce correct permissions even if dir already exists
    fs.chmodSync(CONFIG_DIR, 0o700);
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  // Enforce file permissions after write (some systems ignore mode on writeFileSync)
  fs.chmodSync(CONFIG_FILE, 0o600);
  return next;
}

export function getApiKey() {
  // Env var takes precedence
  if (process.env.SHEETLINK_API_KEY) return process.env.SHEETLINK_API_KEY;
  return readConfig().api_key || null;
}

export function getJwt() {
  return readConfig().jwt || null;
}

export function getApiUrl() {
  return process.env.SHEETLINK_API_URL || readConfig().api_url || DEFAULT_API_URL;
}

export function getDefaultOutput() {
  return process.env.SHEETLINK_OUTPUT || readConfig().default_output || 'json';
}

/**
 * Returns the best available auth header value, or null if not configured.
 * API key takes priority over JWT (API key = MAX unattended, JWT = PRO interactive).
 */
export function getAuthHeader() {
  const apiKey = getApiKey();
  if (apiKey) return `Bearer ${apiKey}`;

  const jwt = getJwt();
  if (jwt) return `Bearer ${jwt}`;

  return null;
}

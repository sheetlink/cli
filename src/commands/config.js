/**
 * config.js - `sheetlink config`
 *
 * Show or update CLI configuration.
 *
 * Usage:
 *   sheetlink config                       # Show current config
 *   sheetlink config --set output=json     # Set default output
 *   sheetlink config --set api_url=https://api.sheetlink.app
 */

import path from 'path';
import os from 'os';
import { readConfig, writeConfig } from '../config.js';

const CONFIG_FILE = path.join(os.homedir(), '.sheetlink', 'config.json');

const SETTABLE_KEYS = ['default_output', 'api_url'];

export function cmdConfig(options) {
  if (options.set) {
    const eqIdx = options.set.indexOf('=');
    if (eqIdx === -1) {
      console.error('Usage: sheetlink config --set key=value');
      process.exit(1);
    }
    const key = options.set.slice(0, eqIdx);
    const value = options.set.slice(eqIdx + 1);

    if (!SETTABLE_KEYS.includes(key)) {
      console.error(`Unknown config key: ${key}`);
      console.error(`Settable keys: ${SETTABLE_KEYS.join(', ')}`);
      process.exit(1);
    }

    writeConfig({ [key]: value });
    console.log(`Set ${key}=${value}`);
    return;
  }

  // Show current config
  const cfg = readConfig();

  console.log(`\nConfig file: ${CONFIG_FILE}\n`);

  if (!cfg || Object.keys(cfg).length === 0) {
    console.log('No config set. Run `sheetlink auth` to get started.');
    return;
  }

  const display = {
    ...cfg,
    api_key: cfg.api_key ? `${cfg.api_key.slice(0, 8)}...` : undefined,
    jwt: cfg.jwt ? '<set>' : undefined,
  };

  for (const [k, v] of Object.entries(display)) {
    if (v !== undefined) console.log(`  ${k}: ${v}`);
  }

  console.log('');

  // Env var overrides
  if (process.env.SHEETLINK_API_KEY) {
    console.log('  SHEETLINK_API_KEY: <set via env var> (overrides config file)');
  }
  if (process.env.SHEETLINK_OUTPUT) {
    console.log(`  SHEETLINK_OUTPUT: ${process.env.SHEETLINK_OUTPUT} (overrides config file)`);
  }
}

#!/usr/bin/env node

/**
 * SheetLink CLI
 *
 * Sync your bank transactions to any destination — JSON, CSV, Postgres, SQLite.
 *
 * PRO tier:  interactive auth (JWT), manual runs
 * MAX tier:  API key auth, unattended/cron automation
 *
 * https://sheetlink.app
 */

import { program } from 'commander';
import { createRequire } from 'module';
import { cmdAuth } from './commands/auth.js';
import { cmdSync } from './commands/sync.js';
import { cmdItems } from './commands/items.js';
import { cmdConfig } from './commands/config.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

program
  .name('sheetlink')
  .description('Sync bank transactions from SheetLink to any destination')
  .version(pkg.version);

// ── auth ────────────────────────────────────────────────────────────────────

program
  .command('auth')
  .description('Authenticate with SheetLink (OAuth for PRO, API key for MAX)')
  .option('--api-key <key>', 'Set a MAX tier API key (sl_...) for unattended automation')
  .action(cmdAuth);

// ── sync ────────────────────────────────────────────────────────────────────

program
  .command('sync')
  .description('Sync bank transactions and output to chosen destination')
  .option('--output <dest>', 'Output destination: json (default), csv, postgres://..., sqlite:///path')
  .option('--file <path>', 'File path for CSV output (default: ./sheetlink-transactions.csv)')
  .option('--item <item_id>', 'Sync a specific item only (default: all connected banks)')
  .option('--slim', 'Write 14-column schema instead of full 34-column schema')
  .addHelpText('after', `
Examples:
  sheetlink sync                                         JSON to stdout (pipeable)
  sheetlink sync | jq '.items[].transactions | length'  Count transactions
  sheetlink sync --output csv                            Snapshot CSV (overwrites each run)
  sheetlink sync --output csv --file ~/finances.csv      CSV to custom path
  sheetlink sync --output postgres://localhost/mydb      Upsert to Postgres (MAX only)
  sheetlink sync --output sqlite:///~/finance.db         Upsert to SQLite (MAX only)
  sheetlink sync --output postgres://localhost/mydb --slim  Legacy 14-column schema
  sheetlink sync --item VBX93wmRY4Iy...                  Sync one bank only
  `)
  .action(cmdSync);

// ── items ───────────────────────────────────────────────────────────────────

program
  .command('items')
  .description('List connected bank accounts')
  .action(cmdItems);

// ── config ──────────────────────────────────────────────────────────────────

program
  .command('config')
  .description('Show or update CLI configuration')
  .option('--set <key=value>', 'Set a config value (e.g. --set default_output=csv)')
  .addHelpText('after', `
Settable keys:
  default_output   Default output destination (json, csv, postgres://..., sqlite://...)
  api_url          Backend API URL (default: https://api.sheetlink.app)

Environment variable overrides:
  SHEETLINK_API_KEY   API key (overrides config file)
  SHEETLINK_OUTPUT    Default output (overrides config file)
  SHEETLINK_API_URL   Backend URL (overrides config file)
  `)
  .action(cmdConfig);

program.parse();

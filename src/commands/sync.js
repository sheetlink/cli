/**
 * sync.js - `sheetlink sync`
 *
 * Fetches transactions from SheetLink API and routes to output adapter.
 *
 * Output modes:
 *   json (default)            - JSON to stdout, pipeable
 *   csv [--file path]         - Snapshot CSV, overwrites each run (PRO+)
 *   postgres://...            - Upsert to Postgres (MAX only)
 *   sqlite:///path/to/db      - Upsert to SQLite (MAX only)
 */

import { listItems, syncItem } from '../api.js';
import { getDefaultOutput } from '../config.js';
import { writeJson } from '../adapters/json.js';
import { writeCsv } from '../adapters/csv.js';
import { writePostgres } from '../adapters/postgres.js';
import { writeSQLite } from '../adapters/sqlite.js';

export async function cmdSync(options) {
  const output = options.output || getDefaultOutput();
  const itemId = options.item || null;

  // Collect items to sync
  let itemIds;
  if (itemId) {
    itemIds = [itemId];
  } else {
    const { items } = await listItems();
    if (!items || items.length === 0) {
      console.error('No connected banks found. Connect a bank at https://sheetlink.app/dashboard');
      process.exit(1);
    }
    itemIds = items.map(i => i.item_id);
  }

  // Sync each item and collect results
  const allTransactions = [];
  const allAccounts = [];
  const results = [];

  for (const id of itemIds) {
    process.stderr.write(`Syncing ${id}...`);
    try {
      const result = await syncItem(id);
      allTransactions.push(...(result.transactions || []));
      allAccounts.push(...(result.accounts || []));
      results.push({ item_id: id, ...result });
      process.stderr.write(` ${result.transactions?.length ?? 0} transactions\n`);
    } catch (e) {
      process.stderr.write(` error: ${e.message}\n`);
    }
  }

  if (allTransactions.length === 0 && allAccounts.length === 0) {
    console.error('No data returned from sync.');
    process.exit(1);
  }

  const synced_at = new Date().toISOString();

  // Route to output adapter
  if (output === 'json') {
    writeJson({ synced_at, items: results });
    return;
  }

  if (output === 'csv') {
    writeCsv(allTransactions, options.file);
    return;
  }

  if (output.startsWith('postgres://') || output.startsWith('postgresql://')) {
    await writePostgres(allTransactions, allAccounts, output);
    return;
  }

  if (output.startsWith('sqlite://')) {
    // sqlite:///absolute/path → /absolute/path, sqlite://relative/path → relative/path
    const dbPath = output.replace(/^sqlite:\/\//, '') || './sheetlink.db';
    writeSQLite(allTransactions, allAccounts, dbPath);
    return;
  }

  console.error(`Unknown output: ${output}`);
  console.error('Valid options: json, csv, postgres://..., sqlite:///path/to/db');
  process.exit(1);
}

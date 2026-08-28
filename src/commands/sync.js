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
 *
 * Flags:
 *   --slim                    - Write legacy 14-column schema instead of full 34-column schema
 */

import { listItems, syncItem } from '../api.js';
import { getDefaultOutput } from '../config.js';
import { writeJson } from '../adapters/json.js';
import { writeCsv } from '../adapters/csv.js';
import { writePostgres } from '../adapters/postgres.js';
import { writeSQLite } from '../adapters/sqlite.js';

/**
 * Enrich transactions with account_name and account_mask from the accounts array.
 * The API returns accounts and transactions separately; transactions only carry account_id.
 */
function enrichTransactions(transactions, accounts) {
  const accountMap = {};
  for (const acc of accounts) {
    accountMap[acc.account_id] = acc;
  }
  return transactions.map(tx => {
    const acc = accountMap[tx.account_id];
    return {
      ...tx,
      account_name: acc?.name ?? tx.account_name ?? null,
      account_mask: acc?.mask ?? tx.account_mask ?? null,
      persistent_account_id: acc?.persistent_account_id ?? tx.persistent_account_id ?? null,
    };
  });
}

// DATE-FILTER: validate + build the optional custom range from --from/--to. Returns null (default
// full-window sync) when neither is given. One-sided fills the other server-side (from -> today,
// to -> plan cap). Exits with a clear message on bad input.
function buildRange(options) {
  const from = options.from || null;
  const to = options.to || null;
  if (!from && !to) return null;
  const isISO = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  for (const [flag, val] of [['--from', from], ['--to', to]]) {
    if (val && !isISO(val)) {
      console.error(`Invalid ${flag} date "${val}". Use YYYY-MM-DD (e.g. 2026-01-31).`);
      process.exit(1);
    }
  }
  if (from && to && from > to) {
    console.error(`--from (${from}) must be on or before --to (${to}).`);
    process.exit(1);
  }
  return { start: from, end: to };
}

export async function cmdSync(options) {
  const output = options.output || getDefaultOutput();
  const itemId = options.item || null;
  const slim = !!options.slim;
  const range = buildRange(options);  // DATE-FILTER: null = default full-window sync

  // Collect items to sync
  let itemIds;
  const institutionNames = {};
  if (itemId) {
    itemIds = [itemId];
  } else {
    const { items } = await listItems();
    if (!items || items.length === 0) {
      console.error('No connected banks found. Connect a bank at https://sheetlink.app/dashboard');
      process.exit(1);
    }
    for (const item of items) {
      if (item.institution_name) institutionNames[item.item_id] = item.institution_name;
    }
    itemIds = items.map(i => i.item_id);
  }

  // Sync each item and collect results
  const allTransactions = [];
  const allAccounts = [];
  const results = [];
  const needsAttention = [];  // HEALTH-6: banks that need reconnecting (for the end summary)
  let rangeClamped = false;    // DATE-FILTER: did the plan floor the requested --from?

  const spinnerFrames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

  for (const id of itemIds) {
    let i = 0;
    const spinner = setInterval(() => {
      process.stderr.write(`\r${spinnerFrames[i++ % spinnerFrames.length]} Syncing ${id}...`);
    }, 80);
    try {
      const result = await syncItem(id, range);
      if (result.clamped) rangeClamped = true;  // DATE-FILTER
      const enriched = enrichTransactions(result.transactions || [], result.accounts || []);
      allTransactions.push(...enriched);
      allAccounts.push(...(result.accounts || []));
      results.push({ item_id: id, ...result, transactions: enriched });
      clearInterval(spinner);
      process.stderr.write(`\r✓ Synced ${id} — ${enriched.length} transactions\n`);
    } catch (e) {
      clearInterval(spinner);
      const name = institutionNames[id] || id;
      // HEALTH-6 (CLI): a per-item connection problem prints a clear, actionable line with
      // the backend's display_message, not a raw API error. Covers login_required /
      // no_accounts / error (all surfaced as ITEM_NEEDS_ATTENTION by api.js).
      if (e.code === 'ITEM_NEEDS_ATTENTION' || e.code === 'ITEM_LOGIN_REQUIRED') {
        const msg = e.detail || 'Reconnect at https://sheetlink.app/dashboard/banks';
        process.stderr.write(`\r⚠ ${name} — ${msg}\n`);
        needsAttention.push(name);
      } else {
        process.stderr.write(`\r✗ ${name} — ${e.message}\n`);
      }
    }
  }

  // DATE-FILTER: tell the user if their --from was floored to the plan's 730-day window.
  if (rangeClamped) {
    process.stderr.write(`ℹ --from was floored to your plan's 730-day limit.\n`);
  }

  // HEALTH-6: summarize any banks that need reconnecting (shown even when no data synced).
  if (needsAttention.length > 0) {
    const list = needsAttention.join(', ');
    process.stderr.write(
      `\n⚠ ${needsAttention.length} bank${needsAttention.length > 1 ? 's need' : ' needs'} attention: ${list}\n` +
      `  Reconnect at https://sheetlink.app/dashboard/banks to resume syncing.\n`
    );
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
    writeCsv(allTransactions, options.file, { slim });
    return;
  }

  if (output.startsWith('postgres://') || output.startsWith('postgresql://')) {
    await writePostgres(allTransactions, allAccounts, output, { slim });
    return;
  }

  if (output.startsWith('sqlite://')) {
    const dbPath = output.replace(/^sqlite:\/\//, '') || './sheetlink.db';
    writeSQLite(allTransactions, allAccounts, dbPath, { slim });
    return;
  }

  console.error(`Unknown output: ${output}`);
  console.error('Valid options: json, csv, postgres://..., sqlite:///path/to/db');
  process.exit(1);
}

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
 *   beancount | hledger       - Append new transactions to a plain-text accounting file
 *
 * Flags:
 *   --slim                    - Write legacy 14-column schema instead of full 34-column schema
 *   --full                    - Database output: pull the whole window instead of since the last stored date
 */

import { listItems, syncItem, getTierStatus, exitUnauthorized } from '../api.js';
import { getDefaultOutput, getApiKey, getAuthHeader } from '../config.js';
import { writeJson } from '../adapters/json.js';
import { writeCsv } from '../adapters/csv.js';
import { writePostgres, latestDatesPostgres } from '../adapters/postgres.js';
import { writeSQLite, latestDatesSQLite } from '../adapters/sqlite.js';
import { writeLedger } from '../adapters/ledger.js';
import fs from 'node:fs';
import { expandHome } from '../paths.js';

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

// TIER: Postgres/SQLite output is a MAX feature. API keys are already MAX-only server-side, so only
// a browser login (JWT) needs checking, and it happens before any bank is synced.
async function requireMaxForDatabaseOutput(output) {
  if (!/^(postgres|postgresql|sqlite):\/\//.test(output) || getApiKey()) return;
  let status;
  try {
    status = await getTierStatus();  // an expired login gets a 401, which request() handles and exits
  } catch (e) {
    // The plan check is a nudge, not security: if it can't run (5xx/network), don't block the sync.
    process.stderr.write(`Could not check your plan (${e.message}). Continuing.\n`);
    return;
  }
  if (!status.authenticated) exitUnauthorized(getAuthHeader());  // defensive: no auth reached the server
  const tier = String(status.tier || 'free').toUpperCase();
  if (tier !== 'MAX') {
    console.error(`Writing to Postgres or SQLite requires the MAX plan (your plan: ${tier}).`);
    // FREE can't use the CLI at all, so only PRO gets the json/csv alternative.
    console.error(tier === 'PRO'
      ? 'Use --output json or --output csv, or upgrade at https://sheetlink.app/pricing'
      : 'Upgrade at https://sheetlink.app/pricing');
    process.exit(1);
  }
}

// SINCE-LAST-SYNC (0.6.2): a Postgres or SQLite destination already holds the history, so a run with no
// --from/--to pulls from the destination's latest stored date minus OVERLAP_DAYS for each bank instead of the
// whole 730-day window (one Plaid page instead of dozens). The overlap catches pending transactions that
// settle and late-posting ones. A bank gets the full window when any of its syncing accounts has nothing
// stored yet (a new bank, or an account newly added to one), and --full forces it for every bank.
const OVERLAP_DAYS = 30;

function databaseKind(output) {
  if (/^postgres(ql)?:\/\//.test(output)) return 'postgres';
  if (output.startsWith('sqlite://')) return 'sqlite';
  return null;
}

function sqlitePath(output) {
  return expandHome(output.replace(/^sqlite:\/\//, '')) || './sheetlink.db';
}

async function incrementalRanges(output, items) {
  const kind = databaseKind(output);
  let latest;
  try {
    latest = kind === 'postgres' ? await latestDatesPostgres(output) : await latestDatesSQLite(sqlitePath(output));
  } catch (e) {
    process.stderr.write(`ℹ Couldn't read the latest stored dates (${e.message}); pulling the full history.\n`);
    return {};
  }
  const ranges = {};
  for (const item of items) {
    const excluded = new Set(item.account_filter?.excluded || []);
    const ids = (item.accounts || []).map(a => a.account_id).filter(id => id && !excluded.has(id));
    if (!ids.length || ids.some(id => !latest[id])) continue;  // something not stored yet: full window
    const oldest = ids.map(id => latest[id]).sort()[0];
    const start = new Date(`${oldest}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - OVERLAP_DAYS);
    ranges[item.item_id] = { start: start.toISOString().slice(0, 10), end: null };
  }
  return ranges;
}

function readAccountMap(path) {
  if (!path) return null;
  try {
    const map = JSON.parse(fs.readFileSync(expandHome(path), 'utf8'));
    if (!map || typeof map !== 'object') throw new Error('expected a JSON object');
    return map;
  } catch (e) {
    console.error(`Couldn't read --account-map ${path}: ${e.message}`);
    console.error('Expected JSON like {"accounts": {"<plaid account_id>": "Assets:Bank:Checking"}, "categories": {"FOOD_AND_DRINK": "Expenses:Meals"}}');
    process.exit(1);
  }
}

export async function cmdSync(options) {
  const output = options.output || getDefaultOutput();
  const itemId = options.item || null;
  const slim = !!options.slim;
  const range = buildRange(options);  // DATE-FILTER: null = default full-window sync
  const ledgerFormat = output === 'beancount' || output === 'hledger' ? output : null;
  const accountMap = ledgerFormat ? readAccountMap(options.accountMap) : null;

  await requireMaxForDatabaseOutput(output);

  // Collect items to sync. The item list also carries each bank's accounts, which the since-last-sync
  // window needs, so a database run lists items even when --item names one.
  const incremental = !!databaseKind(output) && !range && !options.full;
  let itemIds;
  const institutionNames = {};
  let listed = null;
  if (!itemId || incremental) {
    const { items } = await listItems();
    if (!itemId && (!items || items.length === 0)) {
      console.error('No connected banks found. Connect a bank at https://sheetlink.app/dashboard');
      process.exit(1);
    }
    listed = items || [];
    for (const item of listed) {
      if (item.institution_name) institutionNames[item.item_id] = item.institution_name;
    }
  }
  itemIds = itemId ? [itemId] : listed.map(i => i.item_id);
  const ranges = incremental ? await incrementalRanges(output, listed.filter(i => itemIds.includes(i.item_id))) : {};
  if (Object.keys(ranges).length) {
    process.stderr.write(`ℹ Pulling each bank from its last stored date minus ${OVERLAP_DAYS} days (--full for the whole history).\n`);
  }

  // Sync each item and collect results
  const allTransactions = [];
  const allAccounts = [];
  const results = [];
  const needsAttention = [];  // HEALTH-6: banks that need reconnecting (for the end summary)
  const alreadySyncing = [];  // CLI-409: banks another run is syncing right now
  let rangeClamped = false;    // DATE-FILTER: did the plan floor the requested --from?

  const spinnerFrames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

  for (const id of itemIds) {
    let i = 0;
    const spinner = setInterval(() => {
      process.stderr.write(`\r${spinnerFrames[i++ % spinnerFrames.length]} Syncing ${id}...`);
    }, 80);
    try {
      const result = await syncItem(id, range || ranges[id] || null);
      if (result.clamped) rangeClamped = true;  // DATE-FILTER
      const enriched = enrichTransactions(result.transactions || [], result.accounts || []);
      allTransactions.push(...enriched);
      allAccounts.push(...(result.accounts || []));
      results.push({ item_id: id, institution_name: institutionNames[id] || null, ...result, transactions: enriched });
      clearInterval(spinner);
      process.stderr.write(`\r✓ Synced ${id}: ${enriched.length} transactions\n`);
    } catch (e) {
      clearInterval(spinner);
      const name = institutionNames[id] || id;
      // HEALTH-6 (CLI): a per-item connection problem prints a clear, actionable line with
      // the backend's display_message, not a raw API error. Covers login_required /
      // no_accounts / error (all surfaced as ITEM_NEEDS_ATTENTION by api.js).
      if (e.code === 'ITEM_NEEDS_ATTENTION' || e.code === 'ITEM_LOGIN_REQUIRED') {
        const msg = e.detail || 'Reconnect at https://sheetlink.app/dashboard/banks';
        process.stderr.write(`\r⚠ ${name}: ${msg}\n`);
        needsAttention.push(name);
      } else if (e.status === 409) {
        // CLI-409: the server is already syncing this bank (an overlapping scheduled run, or another
        // device). Skip it this time; the next run picks it up.
        process.stderr.write(`\r· ${name}: already syncing in another run (skipped)\n`);
        alreadySyncing.push(name);
      } else {
        process.stderr.write(`\r✗ ${name}: ${e.message}\n`);
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
    if (alreadySyncing.length === itemIds.length) {
      process.stderr.write('Every bank was already syncing in another run. Nothing to do this time.\n');
      return;
    }
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
    writeCsv(allTransactions, expandHome(options.file), { slim });
    return;
  }

  if (output.startsWith('postgres://') || output.startsWith('postgresql://')) {
    await writePostgres(allTransactions, allAccounts, output, { slim });
    return;
  }

  if (output.startsWith('sqlite://')) {
    await writeSQLite(allTransactions, allAccounts, sqlitePath(output), { slim });
    return;
  }

  if (ledgerFormat) {
    const file = expandHome(options.file) || (ledgerFormat === 'beancount' ? './sheetlink.beancount' : './sheetlink.journal');
    writeLedger(ledgerFormat, results, file, {
      accountMap, includePending: !!options.includePending, balances: !!options.balances, syncedAt: synced_at,
    });
    return;
  }

  console.error(`Unknown output: ${output}`);
  console.error('Valid options: json, csv, postgres://..., sqlite:///path/to/db, beancount, hledger');
  process.exit(1);
}

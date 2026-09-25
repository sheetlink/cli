/**
 * investments.js - `sheetlink investments`
 *
 * Fetches investment holdings + activity from SheetLink and routes to an output adapter.
 * MAX-only, and only for banks with investment tracking enabled (enable it in the extension,
 * Excel add-in, or dashboard). Banks without it are skipped with a clear note.
 *
 * Output modes (same as `sync`):
 *   json (default)         - JSON to stdout, pipeable
 *   csv [--file path]      - Two snapshot CSVs: <file> (holdings) + <file>-activity.csv
 *   postgres://...         - Upsert to sheetlink_investment_holdings + _activity
 *   sqlite:///path/to/db   - Upsert to the same two tables
 */

import { listItems, getInvestmentHoldings, getInvestmentTransactions } from '../api.js';
import { getDefaultOutput } from '../config.js';
import { writeJson } from '../adapters/json.js';
import { writeInvestmentsCsv } from '../adapters/csv.js';
import { writeInvestmentsPostgres } from '../adapters/postgres.js';
import { writeInvestmentsSQLite } from '../adapters/sqlite.js';

// Reuse the sync command's date-range validation shape (holdings ignore range; activity uses it).
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

// Turn an investments API error into a short per-item note. Non-fatal: we skip that bank and move on.
// Codes come from the shared backend service (investments_service.py).
function describeInvestErr(name, e) {
  switch (e && e.status) {
    case 409: return `${name} — investment tracking is off (enable it, then retry).`;
    case 425: return `${name} — still preparing data, try again shortly.`;
    case 422: return `${name} — reconnect needed to enable investment tracking.`;
    case 503: return `${name} — temporarily unavailable, try again shortly.`;
    default:  return `${name} — ${e && e.message ? e.message : 'could not fetch investments'}.`;
  }
}

export async function cmdInvestments(options) {
  const output = options.output || getDefaultOutput();
  const itemId = options.item || null;
  const range = buildRange(options);

  // Resolve which items to pull.
  let items;
  if (itemId) {
    items = [{ item_id: itemId, institution_name: itemId }];
  } else {
    const res = await listItems();
    items = res.items || [];
    if (items.length === 0) {
      console.error('No connected banks found. Connect a brokerage at https://sheetlink.app/dashboard');
      process.exit(1);
    }
  }

  const allHoldings = [];
  const allActivity = [];
  const results = [];
  const skipped = [];
  const spinnerFrames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

  for (const item of items) {
    const id = item.item_id;
    const name = item.institution_name || id;
    let i = 0;
    const spinner = setInterval(() => {
      process.stderr.write(`\r${spinnerFrames[i++ % spinnerFrames.length]} Fetching investments for ${name}...`);
    }, 80);

    let holdings = [];
    let activity = [];
    let anyData = false;
    let hadError = null;

    // Holdings + activity are independent — a failure on one shouldn't drop the other.
    try {
      const r = await getInvestmentHoldings(id);
      holdings = r.holdings || [];
      anyData = true;
    } catch (e) {
      // 409 (not-enabled) is the common, expected case for non-brokerage banks: skip silently-ish.
      if (e && (e.status === 409)) { hadError = e; }
      else { hadError = e; }
    }
    try {
      const r = await getInvestmentTransactions(id, range);
      activity = r.investment_transactions || [];
      anyData = true;
    } catch (e) {
      if (!hadError) hadError = e;  // keep the first error for the note
    }

    clearInterval(spinner);

    if (!anyData && hadError) {
      // Both calls failed. If it's "not enabled", that's a skip (expected for banks w/o investments).
      if (hadError.status === 409) {
        process.stderr.write(`\r· ${name} — no investment tracking (skipped)\n`);
      } else {
        process.stderr.write(`\r⚠ ${describeInvestErr(name, hadError)}\n`);
      }
      skipped.push(name);
      continue;
    }

    allHoldings.push(...holdings);
    allActivity.push(...activity);
    results.push({ item_id: id, institution_name: item.institution_name, holdings, investment_transactions: activity });
    process.stderr.write(`\r✓ ${name} — ${holdings.length} holdings, ${activity.length} activity\n`);
  }

  if (allHoldings.length === 0 && allActivity.length === 0) {
    console.error('\nNo investment data returned. Enable investment tracking on a brokerage in the '
      + 'SheetLink extension, Excel add-in, or dashboard, then retry.');
    process.exit(1);
  }

  const synced_at = new Date().toISOString();

  if (output === 'json') {
    writeJson({ synced_at, items: results });
    return;
  }
  if (output === 'csv') {
    writeInvestmentsCsv(allHoldings, allActivity, options.file);
    return;
  }
  if (output.startsWith('postgres://') || output.startsWith('postgresql://')) {
    await writeInvestmentsPostgres(allHoldings, allActivity, output);
    return;
  }
  if (output.startsWith('sqlite://')) {
    const dbPath = output.replace(/^sqlite:\/\//, '') || './sheetlink.db';
    writeInvestmentsSQLite(allHoldings, allActivity, dbPath);
    return;
  }

  console.error(`Unknown output: ${output}`);
  console.error('Valid options: json, csv, postgres://..., sqlite:///path/to/db');
  process.exit(1);
}

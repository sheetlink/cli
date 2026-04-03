/**
 * csv.js - CSV snapshot adapter
 *
 * Writes a flat snapshot of transactions to a CSV file.
 * Each run OVERWRITES the file — no append, no dedup.
 * Users who want history should use Postgres or SQLite.
 */

import fs from 'fs';

const HEADERS = [
  'date',
  'name',
  'amount',
  'category',
  'account_id',
  'account_name',
  'account_mask',
  'institution_name',
  'pending',
  'payment_channel',
  'merchant_name',
  'primary_category',
  'detailed_category',
  'transaction_id',
];

function escape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatRow(txn) {
  return HEADERS.map(h => escape(txn[h])).join(',');
}

export function writeCsv(transactions, filePath = './sheetlink-transactions.csv') {
  const lines = [HEADERS.join(','), ...transactions.map(formatRow)];
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${transactions.length} transactions to ${filePath}`);
}

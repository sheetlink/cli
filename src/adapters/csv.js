/**
 * csv.js - CSV snapshot adapter
 *
 * Writes a flat snapshot of transactions to a CSV file.
 * Each run OVERWRITES the file — no append, no dedup.
 * Users who want history should use Postgres or SQLite.
 *
 * Full schema matches the Google Sheets extension and Excel add-in (35 transaction columns).
 * Use --slim to write the legacy 14-column subset instead.
 */

import fs from 'fs';

const HEADERS_FULL = [
  'transaction_id',
  'account_id',
  'persistent_account_id',
  'account_name',
  'account_mask',
  'date',
  'authorized_date',
  'datetime',
  'authorized_datetime',
  'description_raw',
  'merchant_name',
  'merchant_entity_id',
  'amount',
  'iso_currency_code',
  'unofficial_currency_code',
  'pending',
  'pending_transaction_id',
  'check_number',
  'category_primary',
  'category_detailed',
  'payment_channel',
  'transaction_type',
  'transaction_code',
  'location_address',
  'location_city',
  'location_region',
  'location_postal_code',
  'location_country',
  'location_lat',
  'location_lon',
  'website',
  'logo_url',
  'source_institution',
  'category',
  'synced_at',
];

const HEADERS_SLIM = [
  'date',
  'name',
  'amount',
  'category',
  'account_id',
  'account_name',
  'account_mask',
  'source_institution',
  'pending',
  'payment_channel',
  'merchant_name',
  'category_primary',
  'category_detailed',
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

function flattenTransaction(tx) {
  const loc = tx.location || {};
  const pfc = tx.personal_finance_category || {};
  const category = Array.isArray(tx.plaid_category) ? tx.plaid_category.join(', ') : (tx.category || null);
  return {
    transaction_id: tx.transaction_id,
    account_id: tx.account_id,
    persistent_account_id: tx.persistent_account_id || null,
    account_name: tx.account_name,
    account_mask: tx.account_mask,
    date: tx.date,
    authorized_date: tx.authorized_date || null,
    datetime: tx.datetime || null,
    authorized_datetime: tx.authorized_datetime || null,
    description_raw: tx.description_raw || tx.name,
    merchant_name: tx.merchant_name || null,
    merchant_entity_id: tx.merchant_entity_id || null,
    amount: tx.amount,
    iso_currency_code: tx.iso_currency_code || null,
    unofficial_currency_code: tx.unofficial_currency_code || null,
    pending: tx.pending,
    pending_transaction_id: tx.pending_transaction_id || null,
    check_number: tx.check_number || null,
    category_primary: pfc.primary || tx.category_primary || null,
    category_detailed: pfc.detailed || tx.category_detailed || null,
    payment_channel: tx.payment_channel || null,
    transaction_type: tx.transaction_type || null,
    transaction_code: tx.transaction_code || null,
    location_address: loc.address || null,
    location_city: loc.city || null,
    location_region: loc.region || null,
    location_postal_code: loc.postal_code || null,
    location_country: loc.country || null,
    location_lat: loc.lat ?? null,
    location_lon: loc.lon ?? null,
    website: tx.website || null,
    logo_url: tx.logo_url || null,
    source_institution: tx.source_institution || tx.institution_name || null,
    category,
    synced_at: new Date().toISOString(),
  };
}

export function writeCsv(transactions, filePath = './sheetlink-transactions.csv', { slim = false } = {}) {
  const headers = slim ? HEADERS_SLIM : HEADERS_FULL;
  const rows = transactions.map(tx => {
    const flat = slim
      ? {
          ...tx,
          name: tx.description_raw || tx.name,
          source_institution: tx.source_institution || tx.institution_name || null,
          category: Array.isArray(tx.plaid_category) ? tx.plaid_category.join(', ') : (tx.category || null),
          category_primary: (tx.personal_finance_category?.primary) || tx.category_primary || null,
          category_detailed: (tx.personal_finance_category?.detailed) || tx.category_detailed || null,
        }
      : flattenTransaction(tx);
    return headers.map(h => escape(flat[h])).join(',');
  });
  fs.writeFileSync(filePath, [headers.join(','), ...rows].join('\n') + '\n', 'utf8');
  console.log(`Wrote ${transactions.length} transactions to ${filePath}`);
}

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

// ── Investments CSV ──────────────────────────────────────────────────────────
// Schemas match the Chrome extension + Excel add-in EXACTLY (31-col holdings, 17-col activity).
// Two snapshot files: <file> for holdings, <file>-activity.csv for activity (each overwrites).

const INVESTMENT_HOLDINGS_HEADERS = [
  'account_id', 'security_id', 'security_name', 'ticker_symbol', 'security_type',
  'security_subtype', 'cusip', 'isin', 'sedol', 'quantity', 'cost_basis',
  'institution_price', 'institution_value', 'price_as_of', 'price_datetime',
  'vested_quantity', 'vested_value', 'close_price', 'close_price_as_of',
  'is_cash_equivalent', 'market_identifier_code', 'sector', 'industry',
  'security_update_datetime', 'option_contract_type', 'option_expiration_date',
  'option_strike_price', 'option_underlying_ticker', 'iso_currency_code',
  'source_institution', 'synced_at',
];

const INVESTMENT_ACTIVITY_HEADERS = [
  'investment_transaction_id', 'account_id', 'security_id', 'date', 'name', 'type',
  'subtype', 'quantity', 'price', 'amount', 'fees', 'ticker_symbol', 'security_name',
  'iso_currency_code', 'cancel_transaction_id', 'source_institution', 'synced_at',
];

function holdingRow(h, now) {
  return {
    account_id: h.account_id, security_id: h.security_id, security_name: h.security_name,
    ticker_symbol: h.ticker_symbol, security_type: h.security_type, security_subtype: h.security_subtype,
    cusip: h.cusip, isin: h.isin, sedol: h.sedol, quantity: h.quantity, cost_basis: h.cost_basis,
    institution_price: h.institution_price, institution_value: h.institution_value,
    price_as_of: h.price_as_of, price_datetime: h.price_datetime, vested_quantity: h.vested_quantity,
    vested_value: h.vested_value, close_price: h.close_price, close_price_as_of: h.close_price_as_of,
    is_cash_equivalent: h.is_cash_equivalent, market_identifier_code: h.market_identifier_code,
    sector: h.sector, industry: h.industry, security_update_datetime: h.security_update_datetime,
    option_contract_type: h.option_contract_type, option_expiration_date: h.option_expiration_date,
    option_strike_price: h.option_strike_price, option_underlying_ticker: h.option_underlying_ticker,
    iso_currency_code: h.iso_currency_code, source_institution: h.source_institution, synced_at: now,
  };
}

function activityRow(t, now) {
  return {
    investment_transaction_id: t.investment_transaction_id, account_id: t.account_id,
    security_id: t.security_id, date: t.date, name: t.name, type: t.type, subtype: t.subtype,
    quantity: t.quantity, price: t.price, amount: t.amount, fees: t.fees,
    ticker_symbol: t.ticker_symbol, security_name: t.security_name, iso_currency_code: t.iso_currency_code,
    cancel_transaction_id: t.cancel_transaction_id, source_institution: t.source_institution, synced_at: now,
  };
}

export function writeInvestmentsCsv(holdings, activity, filePath = './sheetlink-investments.csv') {
  const now = new Date().toISOString();
  // Holdings -> <file>; activity -> <file>-activity.csv (insert before extension if present).
  const activityPath = filePath.replace(/(\.csv)?$/i, (m) => `-activity${m || '.csv'}`);

  const hRows = holdings.map(h => {
    const flat = holdingRow(h, now);
    return INVESTMENT_HOLDINGS_HEADERS.map(k => escape(flat[k])).join(',');
  });
  fs.writeFileSync(filePath, [INVESTMENT_HOLDINGS_HEADERS.join(','), ...hRows].join('\n') + '\n', 'utf8');
  console.log(`Wrote ${holdings.length} holdings to ${filePath}`);

  const aRows = activity.map(t => {
    const flat = activityRow(t, now);
    return INVESTMENT_ACTIVITY_HEADERS.map(k => escape(flat[k])).join(',');
  });
  fs.writeFileSync(activityPath, [INVESTMENT_ACTIVITY_HEADERS.join(','), ...aRows].join('\n') + '\n', 'utf8');
  console.log(`Wrote ${activity.length} investment activity rows to ${activityPath}`);
}

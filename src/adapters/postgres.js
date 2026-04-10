/**
 * postgres.js - Postgres upsert adapter (MAX tier only)
 *
 * Creates sheetlink_transactions and sheetlink_accounts tables if they don't exist.
 * Upserts on primary key — safe to run repeatedly with no duplicates.
 *
 * Full schema matches the Google Sheets extension and Excel add-in (35 transaction columns).
 * Use --slim to write the legacy 14-column subset instead.
 */

// Full schema — matches TRANSACTIONS_HEADERS_FULL in extension + Excel
const CREATE_TRANSACTIONS_FULL = `
CREATE TABLE IF NOT EXISTS sheetlink_transactions (
  transaction_id           TEXT PRIMARY KEY,
  account_id               TEXT,
  persistent_account_id    TEXT,
  account_name             TEXT,
  account_mask             TEXT,
  date                     DATE NOT NULL,
  authorized_date          DATE,
  datetime                 TEXT,
  authorized_datetime      TEXT,
  description_raw          TEXT,
  merchant_name            TEXT,
  merchant_entity_id       TEXT,
  amount                   DECIMAL(10,2),
  iso_currency_code        TEXT,
  unofficial_currency_code TEXT,
  pending                  BOOLEAN,
  pending_transaction_id   TEXT,
  check_number             TEXT,
  category_primary         TEXT,
  category_detailed        TEXT,
  payment_channel          TEXT,
  transaction_type         TEXT,
  transaction_code         TEXT,
  location_address         TEXT,
  location_city            TEXT,
  location_region          TEXT,
  location_postal_code     TEXT,
  location_country         TEXT,
  location_lat             DECIMAL(10,7),
  location_lon             DECIMAL(10,7),
  website                  TEXT,
  logo_url                 TEXT,
  source_institution       TEXT,
  category                 TEXT,
  synced_at                TIMESTAMP DEFAULT NOW()
)`;

// Slim schema — legacy 14-column subset for --slim flag
const CREATE_TRANSACTIONS_SLIM = `
CREATE TABLE IF NOT EXISTS sheetlink_transactions (
  transaction_id    TEXT PRIMARY KEY,
  date              DATE NOT NULL,
  name              TEXT,
  amount            DECIMAL(10,2),
  category          TEXT,
  account_id        TEXT,
  account_name      TEXT,
  account_mask      TEXT,
  source_institution TEXT,
  pending           BOOLEAN,
  payment_channel   TEXT,
  merchant_name     TEXT,
  category_primary  TEXT,
  category_detailed TEXT,
  synced_at         TIMESTAMP DEFAULT NOW()
)`;

const CREATE_ACCOUNTS = `
CREATE TABLE IF NOT EXISTS sheetlink_accounts (
  account_id            TEXT PRIMARY KEY,
  persistent_account_id TEXT,
  name                  TEXT,
  official_name         TEXT,
  mask                  TEXT,
  type                  TEXT,
  subtype               TEXT,
  current_balance       DECIMAL(10,2),
  available_balance     DECIMAL(10,2),
  iso_currency_code     TEXT,
  institution           TEXT,
  last_synced_at        TIMESTAMP DEFAULT NOW()
)`;

const UPSERT_TRANSACTION_FULL = `
INSERT INTO sheetlink_transactions
  (transaction_id, account_id, persistent_account_id, account_name, account_mask,
   date, authorized_date, datetime, authorized_datetime,
   description_raw, merchant_name, merchant_entity_id,
   amount, iso_currency_code, unofficial_currency_code,
   pending, pending_transaction_id, check_number,
   category_primary, category_detailed, payment_channel,
   transaction_type, transaction_code,
   location_address, location_city, location_region, location_postal_code, location_country,
   location_lat, location_lon,
   website, logo_url, source_institution, category, synced_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,NOW())
ON CONFLICT (transaction_id) DO UPDATE SET
  date = EXCLUDED.date,
  authorized_date = EXCLUDED.authorized_date,
  description_raw = EXCLUDED.description_raw,
  amount = EXCLUDED.amount,
  pending = EXCLUDED.pending,
  pending_transaction_id = EXCLUDED.pending_transaction_id,
  category_primary = EXCLUDED.category_primary,
  category_detailed = EXCLUDED.category_detailed,
  category = EXCLUDED.category,
  synced_at = NOW()`;

const UPSERT_TRANSACTION_SLIM = `
INSERT INTO sheetlink_transactions
  (transaction_id, date, name, amount, category, account_id, account_name, account_mask,
   source_institution, pending, payment_channel, merchant_name, category_primary, category_detailed, synced_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
ON CONFLICT (transaction_id) DO UPDATE SET
  date = EXCLUDED.date,
  name = EXCLUDED.name,
  amount = EXCLUDED.amount,
  category = EXCLUDED.category,
  pending = EXCLUDED.pending,
  synced_at = NOW()`;

const UPSERT_ACCOUNT = `
INSERT INTO sheetlink_accounts
  (account_id, persistent_account_id, name, official_name, mask, type, subtype,
   current_balance, available_balance, iso_currency_code, institution, last_synced_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
ON CONFLICT (account_id) DO UPDATE SET
  name = EXCLUDED.name,
  current_balance = EXCLUDED.current_balance,
  available_balance = EXCLUDED.available_balance,
  last_synced_at = NOW()`;

export async function writePostgres(transactions, accounts, connectionString, { slim = false } = {}) {
  const { default: pg } = await import('pg').then(m => ({ default: m.default || m }));
  const { Client } = pg;

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(slim ? CREATE_TRANSACTIONS_SLIM : CREATE_TRANSACTIONS_FULL);
    await client.query(CREATE_ACCOUNTS);

    for (const tx of transactions) {
      const loc = tx.location || {};
      const pfc = tx.personal_finance_category || {};
      const category = Array.isArray(tx.plaid_category) ? tx.plaid_category.join(', ') : (tx.category || null);
      const source_institution = tx.source_institution || tx.institution_name || null;

      if (slim) {
        await client.query(UPSERT_TRANSACTION_SLIM, [
          tx.transaction_id, tx.date, tx.description_raw || tx.name, tx.amount,
          category, tx.account_id, tx.account_name, tx.account_mask,
          source_institution,
          tx.pending, tx.payment_channel, tx.merchant_name,
          pfc.primary || tx.category_primary || null,
          pfc.detailed || tx.category_detailed || null,
        ]);
      } else {
        await client.query(UPSERT_TRANSACTION_FULL, [
          tx.transaction_id,
          tx.account_id,
          tx.persistent_account_id || null,
          tx.account_name,
          tx.account_mask,
          tx.date,
          tx.authorized_date || null,
          tx.datetime || null,
          tx.authorized_datetime || null,
          tx.description_raw || tx.name,
          tx.merchant_name || null,
          tx.merchant_entity_id || null,
          tx.amount,
          tx.iso_currency_code || null,
          tx.unofficial_currency_code || null,
          tx.pending,
          tx.pending_transaction_id || null,
          tx.check_number || null,
          pfc.primary || tx.category_primary || null,
          pfc.detailed || tx.category_detailed || null,
          tx.payment_channel || null,
          tx.transaction_type || null,
          tx.transaction_code || null,
          loc.address || null,
          loc.city || null,
          loc.region || null,
          loc.postal_code || null,
          loc.country || null,
          loc.lat ?? null,
          loc.lon ?? null,
          tx.website || null,
          tx.logo_url || null,
          source_institution,
          category,
        ]);
      }
    }

    for (const acc of accounts) {
      await client.query(UPSERT_ACCOUNT, [
        acc.account_id,
        acc.persistent_account_id || null,
        acc.name,
        acc.official_name || null,
        acc.mask,
        acc.type,
        acc.subtype,
        acc.balances?.current ?? acc.current_balance ?? null,
        acc.balances?.available ?? acc.available_balance ?? null,
        acc.iso_currency_code || null,
        acc.institution || acc.institution_name || null,
      ]);
    }

    console.log(`Synced ${transactions.length} transactions and ${accounts.length} accounts to Postgres`);
  } finally {
    await client.end();
  }
}

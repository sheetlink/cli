/**
 * sqlite.js - SQLite upsert adapter (MAX tier only)
 *
 * Same schema as Postgres. Upserts on primary key — safe to run repeatedly.
 *
 * Full schema matches the Google Sheets extension and Excel add-in (35 transaction columns).
 * Use --slim to write the legacy 14-column subset instead.
 */

const CREATE_TRANSACTIONS_FULL = `
CREATE TABLE IF NOT EXISTS sheetlink_transactions (
  transaction_id           TEXT PRIMARY KEY,
  account_id               TEXT,
  persistent_account_id    TEXT,
  account_name             TEXT,
  account_mask             TEXT,
  date                     TEXT NOT NULL,
  authorized_date          TEXT,
  datetime                 TEXT,
  authorized_datetime      TEXT,
  description_raw          TEXT,
  merchant_name            TEXT,
  merchant_entity_id       TEXT,
  amount                   REAL,
  iso_currency_code        TEXT,
  unofficial_currency_code TEXT,
  pending                  INTEGER,
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
  location_lat             REAL,
  location_lon             REAL,
  website                  TEXT,
  logo_url                 TEXT,
  source_institution       TEXT,
  category                 TEXT,
  synced_at                TEXT DEFAULT (datetime('now'))
)`;

const CREATE_TRANSACTIONS_SLIM = `
CREATE TABLE IF NOT EXISTS sheetlink_transactions (
  transaction_id    TEXT PRIMARY KEY,
  date              TEXT NOT NULL,
  name              TEXT,
  amount            REAL,
  category          TEXT,
  account_id        TEXT,
  account_name      TEXT,
  account_mask      TEXT,
  source_institution TEXT,
  pending           INTEGER,
  payment_channel   TEXT,
  merchant_name     TEXT,
  category_primary  TEXT,
  category_detailed TEXT,
  synced_at         TEXT DEFAULT (datetime('now'))
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
  current_balance       REAL,
  available_balance     REAL,
  iso_currency_code     TEXT,
  institution           TEXT,
  last_synced_at        TEXT DEFAULT (datetime('now'))
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
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
ON CONFLICT(transaction_id) DO UPDATE SET
  date=excluded.date, authorized_date=excluded.authorized_date,
  description_raw=excluded.description_raw, amount=excluded.amount, pending=excluded.pending,
  pending_transaction_id=excluded.pending_transaction_id,
  category_primary=excluded.category_primary, category_detailed=excluded.category_detailed,
  category=excluded.category, synced_at=datetime('now')`;

const UPSERT_TRANSACTION_SLIM = `
INSERT INTO sheetlink_transactions
  (transaction_id, date, name, amount, category, account_id, account_name, account_mask,
   source_institution, pending, payment_channel, merchant_name, category_primary, category_detailed, synced_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
ON CONFLICT(transaction_id) DO UPDATE SET
  date=excluded.date, name=excluded.name, amount=excluded.amount,
  category=excluded.category, pending=excluded.pending, synced_at=datetime('now')`;

const UPSERT_ACCOUNT = `
INSERT INTO sheetlink_accounts
  (account_id, persistent_account_id, name, official_name, mask, type, subtype,
   current_balance, available_balance, iso_currency_code, institution, last_synced_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
ON CONFLICT(account_id) DO UPDATE SET
  name=excluded.name, current_balance=excluded.current_balance,
  available_balance=excluded.available_balance, last_synced_at=datetime('now')`;

export async function writeSQLite(transactions, accounts, dbPath, { slim = false } = {}) {
  const Database = (await import('better-sqlite3')).default;

  const db = new Database(dbPath);
  db.exec(slim ? CREATE_TRANSACTIONS_SLIM : CREATE_TRANSACTIONS_FULL);
  db.exec(CREATE_ACCOUNTS);

  const insertTx = db.prepare(slim ? UPSERT_TRANSACTION_SLIM : UPSERT_TRANSACTION_FULL);
  const insertAcc = db.prepare(UPSERT_ACCOUNT);

  const txBatch = db.transaction((txns) => {
    for (const tx of txns) {
      const loc = tx.location || {};
      const pfc = tx.personal_finance_category || {};
      const category = Array.isArray(tx.plaid_category) ? tx.plaid_category.join(', ') : (tx.category || null);
      const source_institution = tx.source_institution || tx.institution_name || null;

      if (slim) {
        insertTx.run(
          tx.transaction_id, tx.date, tx.description_raw || tx.name, tx.amount,
          category, tx.account_id, tx.account_name, tx.account_mask,
          source_institution,
          tx.pending ? 1 : 0, tx.payment_channel, tx.merchant_name,
          pfc.primary || tx.category_primary || null,
          pfc.detailed || tx.category_detailed || null,
        );
      } else {
        insertTx.run(
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
          tx.pending ? 1 : 0,
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
        );
      }
    }
  });

  const accBatch = db.transaction((accs) => {
    for (const acc of accs) {
      insertAcc.run(
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
      );
    }
  });

  txBatch(transactions);
  accBatch(accounts);
  db.close();

  console.log(`Synced ${transactions.length} transactions and ${accounts.length} accounts to ${dbPath}`);
}

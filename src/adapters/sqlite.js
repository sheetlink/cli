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

// ── Investments (MAX) — holdings + activity ──────────────────────────────────
// Schemas match the extension/Excel. Holdings PK (account_id, security_id); activity PK
// investment_transaction_id. Same DB file/tables as the Postgres adapter for parity.

const CREATE_INV_HOLDINGS = `
CREATE TABLE IF NOT EXISTS sheetlink_investment_holdings (
  account_id               TEXT,
  security_id              TEXT,
  security_name            TEXT,
  ticker_symbol            TEXT,
  security_type            TEXT,
  security_subtype         TEXT,
  cusip                    TEXT,
  isin                     TEXT,
  sedol                    TEXT,
  quantity                 REAL,
  cost_basis               REAL,
  institution_price        REAL,
  institution_value        REAL,
  price_as_of              TEXT,
  price_datetime           TEXT,
  vested_quantity          REAL,
  vested_value             REAL,
  close_price              REAL,
  close_price_as_of        TEXT,
  is_cash_equivalent       INTEGER,
  market_identifier_code   TEXT,
  sector                   TEXT,
  industry                 TEXT,
  security_update_datetime TEXT,
  option_contract_type     TEXT,
  option_expiration_date   TEXT,
  option_strike_price      REAL,
  option_underlying_ticker TEXT,
  iso_currency_code        TEXT,
  source_institution       TEXT,
  synced_at                TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, security_id)
)`;

const CREATE_INV_ACTIVITY = `
CREATE TABLE IF NOT EXISTS sheetlink_investment_activity (
  investment_transaction_id TEXT PRIMARY KEY,
  account_id                TEXT,
  security_id               TEXT,
  date                      TEXT,
  name                      TEXT,
  type                      TEXT,
  subtype                   TEXT,
  quantity                  REAL,
  price                     REAL,
  amount                    REAL,
  fees                      REAL,
  ticker_symbol             TEXT,
  security_name             TEXT,
  iso_currency_code         TEXT,
  cancel_transaction_id     TEXT,
  source_institution        TEXT,
  synced_at                 TEXT DEFAULT (datetime('now'))
)`;

const UPSERT_INV_HOLDING = `
INSERT INTO sheetlink_investment_holdings
  (account_id, security_id, security_name, ticker_symbol, security_type, security_subtype,
   cusip, isin, sedol, quantity, cost_basis, institution_price, institution_value,
   price_as_of, price_datetime, vested_quantity, vested_value, close_price, close_price_as_of,
   is_cash_equivalent, market_identifier_code, sector, industry, security_update_datetime,
   option_contract_type, option_expiration_date, option_strike_price, option_underlying_ticker,
   iso_currency_code, source_institution)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(account_id, security_id) DO UPDATE SET
  quantity=excluded.quantity, cost_basis=excluded.cost_basis,
  institution_price=excluded.institution_price, institution_value=excluded.institution_value,
  price_as_of=excluded.price_as_of, close_price=excluded.close_price,
  synced_at=datetime('now')`;

const UPSERT_INV_ACTIVITY = `
INSERT INTO sheetlink_investment_activity
  (investment_transaction_id, account_id, security_id, date, name, type, subtype,
   quantity, price, amount, fees, ticker_symbol, security_name, iso_currency_code,
   cancel_transaction_id, source_institution)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(investment_transaction_id) DO UPDATE SET
  amount=excluded.amount, quantity=excluded.quantity, price=excluded.price,
  cancel_transaction_id=excluded.cancel_transaction_id, synced_at=datetime('now')`;

// SQLite bind params can't be booleans — coerce is_cash_equivalent to 0/1/null.
function boolToInt(v) { return v === true ? 1 : (v === false ? 0 : null); }

export async function writeInvestmentsSQLite(holdings, activity, dbPath) {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);
  db.exec(CREATE_INV_HOLDINGS);
  db.exec(CREATE_INV_ACTIVITY);

  const insertH = db.prepare(UPSERT_INV_HOLDING);
  const insertA = db.prepare(UPSERT_INV_ACTIVITY);

  const hBatch = db.transaction((rows) => {
    for (const h of rows) {
      insertH.run(
        h.account_id, h.security_id, h.security_name || null, h.ticker_symbol || null,
        h.security_type || null, h.security_subtype || null, h.cusip || null, h.isin || null, h.sedol || null,
        h.quantity ?? null, h.cost_basis ?? null, h.institution_price ?? null, h.institution_value ?? null,
        h.price_as_of || null, h.price_datetime || null, h.vested_quantity ?? null, h.vested_value ?? null,
        h.close_price ?? null, h.close_price_as_of || null, boolToInt(h.is_cash_equivalent),
        h.market_identifier_code || null, h.sector || null, h.industry || null, h.security_update_datetime || null,
        h.option_contract_type || null, h.option_expiration_date || null, h.option_strike_price ?? null,
        h.option_underlying_ticker || null, h.iso_currency_code || null, h.source_institution || null,
      );
    }
  });

  const aBatch = db.transaction((rows) => {
    for (const t of rows) {
      insertA.run(
        t.investment_transaction_id, t.account_id, t.security_id || null, t.date || null, t.name || null,
        t.type || null, t.subtype || null, t.quantity ?? null, t.price ?? null, t.amount ?? null,
        t.fees ?? null, t.ticker_symbol || null, t.security_name || null, t.iso_currency_code || null,
        t.cancel_transaction_id || null, t.source_institution || null,
      );
    }
  });

  hBatch(holdings);
  aBatch(activity);
  db.close();

  console.log(`Synced ${holdings.length} holdings and ${activity.length} investment activity rows to ${dbPath}`);
}

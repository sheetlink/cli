/**
 * sqlite.js - SQLite upsert adapter (MAX tier only)
 *
 * Same schema as Postgres. Upserts on primary key — safe to run repeatedly.
 */

const CREATE_TRANSACTIONS = `
CREATE TABLE IF NOT EXISTS sheetlink_transactions (
  transaction_id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  name TEXT,
  amount REAL,
  category TEXT,
  account_id TEXT,
  account_name TEXT,
  account_mask TEXT,
  institution_name TEXT,
  pending INTEGER,
  payment_channel TEXT,
  merchant_name TEXT,
  primary_category TEXT,
  detailed_category TEXT,
  synced_at TEXT DEFAULT (datetime('now'))
)`;

const CREATE_ACCOUNTS = `
CREATE TABLE IF NOT EXISTS sheetlink_accounts (
  account_id TEXT PRIMARY KEY,
  name TEXT,
  mask TEXT,
  type TEXT,
  subtype TEXT,
  balance_current REAL,
  balance_available REAL,
  institution_name TEXT,
  last_synced_at TEXT DEFAULT (datetime('now'))
)`;

const UPSERT_TRANSACTION = `
INSERT INTO sheetlink_transactions
  (transaction_id, date, name, amount, category, account_id, account_name, account_mask,
   institution_name, pending, payment_channel, merchant_name, primary_category, detailed_category, synced_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
ON CONFLICT(transaction_id) DO UPDATE SET
  date=excluded.date, name=excluded.name, amount=excluded.amount,
  category=excluded.category, pending=excluded.pending, synced_at=datetime('now')`;

const UPSERT_ACCOUNT = `
INSERT INTO sheetlink_accounts
  (account_id, name, mask, type, subtype, balance_current, balance_available, institution_name, last_synced_at)
VALUES (?,?,?,?,?,?,?,?,datetime('now'))
ON CONFLICT(account_id) DO UPDATE SET
  name=excluded.name, balance_current=excluded.balance_current,
  balance_available=excluded.balance_available, last_synced_at=datetime('now')`;

export async function writeSQLite(transactions, accounts, dbPath) {
  // Dynamic import so users without better-sqlite3 don't hit an error on other commands
  const Database = (await import('better-sqlite3')).default;

  const db = new Database(dbPath);
  db.exec(CREATE_TRANSACTIONS);
  db.exec(CREATE_ACCOUNTS);

  const insertTx = db.prepare(UPSERT_TRANSACTION);
  const insertAcc = db.prepare(UPSERT_ACCOUNT);

  const txBatch = db.transaction((txns) => {
    for (const tx of txns) {
      insertTx.run(
        tx.transaction_id, tx.date, tx.name, tx.amount, tx.category,
        tx.account_id, tx.account_name, tx.account_mask,
        tx.institution_name || tx.source_institution,
        tx.pending ? 1 : 0, tx.payment_channel, tx.merchant_name,
        tx.primary_category, tx.detailed_category,
      );
    }
  });

  const accBatch = db.transaction((accs) => {
    for (const acc of accs) {
      insertAcc.run(
        acc.account_id, acc.name, acc.mask, acc.type, acc.subtype,
        acc.balances?.current ?? null,
        acc.balances?.available ?? null,
        acc.institution || acc.institution_name || null,
      );
    }
  });

  txBatch(transactions);
  accBatch(accounts);
  db.close();

  console.error(`Synced ${transactions.length} transactions and ${accounts.length} accounts to ${dbPath}`);
}

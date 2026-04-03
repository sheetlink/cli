/**
 * postgres.js - Postgres upsert adapter (MAX tier only)
 *
 * Creates sheetlink_transactions and sheetlink_accounts tables if they don't exist.
 * Upserts on primary key — safe to run repeatedly with no duplicates.
 */

const CREATE_TRANSACTIONS = `
CREATE TABLE IF NOT EXISTS sheetlink_transactions (
  transaction_id TEXT PRIMARY KEY,
  date DATE NOT NULL,
  name TEXT,
  amount DECIMAL(10,2),
  category TEXT,
  account_id TEXT,
  account_name TEXT,
  account_mask TEXT,
  institution_name TEXT,
  pending BOOLEAN,
  payment_channel TEXT,
  merchant_name TEXT,
  primary_category TEXT,
  detailed_category TEXT,
  synced_at TIMESTAMP DEFAULT NOW()
)`;

const CREATE_ACCOUNTS = `
CREATE TABLE IF NOT EXISTS sheetlink_accounts (
  account_id TEXT PRIMARY KEY,
  name TEXT,
  mask TEXT,
  type TEXT,
  subtype TEXT,
  balance_current DECIMAL(10,2),
  balance_available DECIMAL(10,2),
  institution_name TEXT,
  last_synced_at TIMESTAMP DEFAULT NOW()
)`;

const UPSERT_TRANSACTION = `
INSERT INTO sheetlink_transactions
  (transaction_id, date, name, amount, category, account_id, account_name, account_mask,
   institution_name, pending, payment_channel, merchant_name, primary_category, detailed_category, synced_at)
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
  (account_id, name, mask, type, subtype, balance_current, balance_available, institution_name, last_synced_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
ON CONFLICT (account_id) DO UPDATE SET
  name = EXCLUDED.name,
  balance_current = EXCLUDED.balance_current,
  balance_available = EXCLUDED.balance_available,
  last_synced_at = NOW()`;

export async function writePostgres(transactions, accounts, connectionString) {
  // Dynamic import so users without pg installed don't hit an error on other commands
  const { default: pg } = await import('pg').then(m => ({ default: m.default || m }));
  const { Client } = pg;

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(CREATE_TRANSACTIONS);
    await client.query(CREATE_ACCOUNTS);

    for (const tx of transactions) {
      await client.query(UPSERT_TRANSACTION, [
        tx.transaction_id, tx.date, tx.name, tx.amount, tx.category,
        tx.account_id, tx.account_name, tx.account_mask,
        tx.institution_name || tx.source_institution,
        tx.pending, tx.payment_channel, tx.merchant_name,
        tx.primary_category, tx.detailed_category,
      ]);
    }

    for (const acc of accounts) {
      await client.query(UPSERT_ACCOUNT, [
        acc.account_id, acc.name, acc.mask, acc.type, acc.subtype,
        acc.balances?.current ?? null,
        acc.balances?.available ?? null,
        acc.institution || acc.institution_name || null,
      ]);
    }

    console.error(`Synced ${transactions.length} transactions and ${accounts.length} accounts to Postgres`);
  } finally {
    await client.end();
  }
}

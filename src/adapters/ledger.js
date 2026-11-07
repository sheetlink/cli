/**
 * ledger.js - Beancount and hledger output (0.6.2)
 *
 * Plain-text accounting files written by the CLI itself: no Python, no beancount dependency.
 * Each run appends only the transactions the file doesn't already hold (matched by plaid_id), so a
 * scheduled run never double-posts, and entries you edit by hand are left alone.
 *
 * Settled transactions only, unless --include-pending (written with the "!" flag). A pending
 * transaction gets a new id when it settles, so a pending entry has to be deleted by hand later.
 *
 * Plaid's sign: a positive amount is money out. The bank or card posting is -amount (a card charge
 * grows the liability) and the counter posting is +amount. Same output as the books' importer
 * (sheetlink-ledger importers/bank_to_beancount.py), so the books can switch to this file unchanged.
 */

import fs from 'node:fs';

const INCOME_CATEGORIES = new Set(['INCOME', 'TRANSFER_IN', 'LOAN_DISBURSEMENTS']);

// One account-name component: starts with a capital letter or digit; ASCII letters, digits and hyphens
// only (Beancount's rule; hledger accepts it too).
export function component(text, fallback = 'Unknown') {
  const ascii = String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const words = ascii.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const joined = words.map(w => w[0].toUpperCase() + w.slice(1)).join('');
  return joined || fallback;
}

// FOOD_AND_DRINK -> FoodAndDrink
function categoryComponent(primary) {
  return component(String(primary).toLowerCase().replace(/_/g, ' '));
}

export function bankAccountName(acc, institution) {
  const type = acc?.type;
  const root = type === 'credit' ? 'Liabilities:Card'
    : type === 'loan' ? 'Liabilities:Loan'
    : type === 'investment' ? 'Assets:Investment'
    : 'Assets:Bank';
  const mask = acc?.mask ? `-${String(acc.mask).replace(/[^A-Za-z0-9]/g, '')}` : '';
  return `${root}:${component(institution)}:${component(acc?.name, 'Account')}${mask}`;
}

// Income categories go to Income; every other category goes to its Expenses account in both directions,
// so a refund reduces the expense it reverses. No category: by direction.
export function counterAccountName(tx, categoryMap = {}) {
  const primary = tx.personal_finance_category?.primary || null;
  if (primary && categoryMap[primary]) return categoryMap[primary];
  if (primary) return `${INCOME_CATEGORIES.has(primary) ? 'Income' : 'Expenses'}:${categoryComponent(primary)}`;
  return tx.amount > 0 ? 'Expenses:Uncategorized' : 'Income:Uncategorized';
}

function money(n) {
  const s = (Math.round(Number(n) * 100) / 100).toFixed(2);
  return s === '-0.00' ? '0.00' : s;
}

function currency(tx) {
  const c = String(tx.iso_currency_code || tx.unofficial_currency_code || 'USD').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c || 'USD';
}

function dayAfter(isoTimestamp) {
  const d = new Date(isoTimestamp);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Strings: Beancount quotes them; hledger has no quoting, so ";" (a comment) and "|" (payee | note) go.
function clean(text, max, format) {
  let s = String(text ?? '').replace(/[\r\n\t]+/g, ' ').replace(/"/g, "'").replace(/\\/g, '/').trim();
  if (format === 'hledger') s = s.replace(/;/g, ',').replace(/\|/g, '/');
  return s.slice(0, max);
}

function readExisting(filePath) {
  const text = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const ids = new Set();
  for (const m of text.matchAll(/plaid_id:\s*"?([A-Za-z0-9_-]+)"?/g)) ids.add(m[1]);
  const opened = new Set();
  for (const m of text.matchAll(/^\d{4}-\d{2}-\d{2}\s+open\s+(\S+)/gm)) opened.add(m[1]);
  for (const m of text.matchAll(/^account\s+(\S+)/gm)) opened.add(m[1]);
  return { text, ids, opened };
}

function renderEntry(format, e) {
  const flag = e.pending ? '!' : '*';
  if (format === 'hledger') {
    const lines = [`${e.date} ${flag} ${e.payee} | ${e.desc}`, `    ; plaid_id: ${e.id}`];
    if (e.category) lines.push(`    ; category: ${e.category}`);
    lines.push(`    ${e.bank}  ${money(-e.amount)} ${e.cur}`, `    ${e.counter}  ${money(e.amount)} ${e.cur}`);
    return lines.join('\n');
  }
  const lines = [`${e.date} ${flag} "${e.payee}" "${e.desc}"`, `  plaid_id: "${e.id}"`];
  if (e.category) lines.push(`  category: "${e.category}"`);
  lines.push(`  ${e.bank}  ${money(-e.amount)} ${e.cur}`, `  ${e.counter}  ${money(e.amount)} ${e.cur}`);
  return lines.join('\n');
}

function renderBalance(format, date, account, amount, cur) {
  if (format === 'hledger') {
    return `${date} * SheetLink balance\n    ; sheetlink_balance: ${date} ${account}\n    ${account}  0 ${cur} = ${money(amount)} ${cur}`;
  }
  return `${date} balance ${account}  ${money(amount)} ${cur}`;
}

function hasBalance(format, text, date, account) {
  if (format === 'hledger') return text.includes(`sheetlink_balance: ${date} ${account}\n`) || text.endsWith(`sheetlink_balance: ${date} ${account}`);
  return new RegExp(`^${date} balance ${account.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`, 'm').test(text);
}

/**
 * Build the text to append. Pure (no file I/O) so it can be tested against golden files.
 * items: [{ item_id, institution_name, accounts, transactions }]
 * existing: { text, ids, opened } from the current file (empty for a new file)
 * Returns { text, added, alreadyThere, unmapped: [{account_id, name, mask, institution, count}] }
 */
export function buildLedger(format, items, existing, { accountMap = null, includePending = false, balances = false, syncedAt } = {}) {
  const mapAccounts = accountMap?.accounts && Object.keys(accountMap.accounts).length ? accountMap.accounts : null;
  const categoryMap = accountMap?.categories || {};
  const accounts = {};
  const institutionOf = {};
  for (const item of items) {
    for (const acc of item.accounts || []) {
      accounts[acc.account_id] = acc;
      institutionOf[acc.account_id] = item.institution_name || acc.institution || null;
    }
  }
  const ledgerAccount = (accountId, tx) => {
    if (mapAccounts) return mapAccounts[accountId] || null;  // with a map, unmapped accounts stay out of the books
    const acc = accounts[accountId] || { name: tx?.account_name, mask: tx?.account_mask };
    return bankAccountName(acc, institutionOf[accountId] || tx?.source_institution);
  };

  const entries = [];
  const unmapped = {};
  let alreadyThere = 0;
  const seen = new Set();
  for (const item of items) {
    for (const tx of item.transactions || []) {
      if (tx.pending && !includePending) continue;
      if (seen.has(tx.transaction_id)) continue;
      seen.add(tx.transaction_id);
      const bank = ledgerAccount(tx.account_id, tx);
      if (!bank) {
        const u = unmapped[tx.account_id] ||= {
          account_id: tx.account_id, name: tx.account_name, mask: tx.account_mask,
          institution: institutionOf[tx.account_id] || tx.source_institution, count: 0,
        };
        u.count++;
        continue;
      }
      if (existing.ids.has(tx.transaction_id)) { alreadyThere++; continue; }
      entries.push({
        id: tx.transaction_id,
        date: String(tx.date).slice(0, 10),
        pending: !!tx.pending,
        payee: clean(tx.merchant_name || tx.description_raw, 60, format),
        desc: clean(tx.description_raw, 80, format),
        category: tx.personal_finance_category?.primary || null,
        amount: Number(tx.amount),
        cur: currency(tx),
        bank,
        counter: counterAccountName(tx, categoryMap),
      });
    }
  }
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const balanceLines = [];
  if (balances && syncedAt) {
    const date = dayAfter(syncedAt);
    for (const [accountId, acc] of Object.entries(accounts)) {
      if (acc.current_balance == null) continue;
      const name = ledgerAccount(accountId, null);
      if (!name || hasBalance(format, existing.text, date, name)) continue;
      // Plaid reports what's owed on a card or loan as a positive balance; in the books it's a liability.
      const amount = name.startsWith('Liabilities:') ? -acc.current_balance : acc.current_balance;
      balanceLines.push({ date, account: name, text: renderBalance(format, date, name, amount, currency(acc)) });
    }
  }

  // Open (Beancount) or declare (hledger) every account this run uses that the file doesn't already.
  const firstUse = {};
  const use = (account, date) => { if (!firstUse[account] || date < firstUse[account]) firstUse[account] = date; };
  for (const e of entries) { use(e.bank, e.date); use(e.counter, e.date); }
  for (const b of balanceLines) use(b.account, b.date);
  const opens = Object.entries(firstUse)
    .filter(([account]) => !existing.opened.has(account))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([account, date]) => (format === 'hledger' ? `account ${account}` : `${date} open ${account}`));

  const blocks = [];
  if (!existing.text) {
    blocks.push(`; Written by the sheetlink CLI (sheetlink sync --output ${format}). Each run appends new transactions;\n; entries already here are matched by plaid_id and left as they are.`);
  }
  if (opens.length) blocks.push(opens.join('\n'));
  for (const e of entries) blocks.push(renderEntry(format, e));
  for (const b of balanceLines) blocks.push(b.text);
  const text = blocks.length ? blocks.join('\n\n') + '\n' : '';
  return { text, added: entries.length, alreadyThere, unmapped: Object.values(unmapped) };
}

export function writeLedger(format, items, filePath, options = {}) {
  const existing = readExisting(filePath);
  const out = buildLedger(format, items, existing, options);
  if (out.text) {
    const sep = existing.text && !existing.text.endsWith('\n\n') ? (existing.text.endsWith('\n') ? '\n' : '\n\n') : '';
    fs.appendFileSync(filePath, sep + out.text);
  }
  const n = out.added;
  process.stderr.write(`✓ ${filePath}: ${n} new transaction${n === 1 ? '' : 's'} appended` +
    (out.alreadyThere ? ` (${out.alreadyThere} already there)` : '') + '\n');
  if (out.unmapped.length) {
    process.stderr.write(`ℹ Skipped ${out.unmapped.length} account${out.unmapped.length === 1 ? '' : 's'} not in your --account-map:\n`);
    for (const u of out.unmapped) {
      process.stderr.write(`  ${u.account_id}  ${u.institution || ''} ${u.name || ''}${u.mask ? ` ••••${u.mask}` : ''} (${u.count} transactions)\n`);
    }
  }
  return out;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildLedger, writeLedger, component, bankAccountName, counterAccountName } from '../src/adapters/ledger.js';
import { ITEMS, SYNCED_AT } from './fixtures.js';

const golden = (name) => fs.readFileSync(new URL(`./golden/${name}`, import.meta.url), 'utf8');
const empty = { text: '', ids: new Set(), opened: new Set() };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sheetlink-ledger-'));
const quiet = (fn) => { const w = process.stderr.write; process.stderr.write = () => true; try { return fn(); } finally { process.stderr.write = w; } };

test('account names are valid ledger components', () => {
  assert.equal(component('Sapphire Preferred®'), 'SapphirePreferred');
  assert.equal(component('crédit agricole'), 'CreditAgricole');
  assert.equal(component(''), 'Unknown');
  assert.equal(bankAccountName({ name: 'Total Checking', mask: '1111', type: 'depository' }, 'Chase'), 'Assets:Bank:Chase:TotalChecking-1111');
  assert.equal(bankAccountName({ name: 'Card', mask: '4242', type: 'credit' }, 'Chase'), 'Liabilities:Card:Chase:Card-4242');
});

test('counter accounts: income categories to Income, refunds back to the expense, no category by direction', () => {
  assert.equal(counterAccountName({ amount: -3000, personal_finance_category: { primary: 'INCOME' } }), 'Income:Income');
  assert.equal(counterAccountName({ amount: -20, personal_finance_category: { primary: 'GENERAL_MERCHANDISE' } }), 'Expenses:GeneralMerchandise');
  assert.equal(counterAccountName({ amount: 5, personal_finance_category: null }), 'Expenses:Uncategorized');
  assert.equal(counterAccountName({ amount: -5 }), 'Income:Uncategorized');
  assert.equal(counterAccountName({ amount: 5, personal_finance_category: { primary: 'FOOD_AND_DRINK' } }, { FOOD_AND_DRINK: 'Expenses:Meals' }), 'Expenses:Meals');
});

test('beancount output matches the golden file', () => {
  const out = buildLedger('beancount', ITEMS, empty, { balances: true, syncedAt: SYNCED_AT });
  assert.equal(out.text, golden('new.beancount'));
  assert.equal(out.added, 4);  // the pending charge is left out
});

test('hledger output matches the golden file', () => {
  const out = buildLedger('hledger', ITEMS, empty, { balances: true, syncedAt: SYNCED_AT, includePending: true });
  assert.equal(out.text, golden('new.journal'));
  assert.equal(out.added, 5);
});

test('an account map keeps unmapped accounts out and renames mapped ones', () => {
  const map = { accounts: { 'acc-chk': 'Assets:Bank:Business:Checking' }, categories: { INCOME: 'Income:Sales' } };
  const out = buildLedger('beancount', ITEMS, empty, { accountMap: map });
  assert.equal(out.added, 1);
  assert.match(out.text, /Assets:Bank:Business:Checking {2}3000\.00 USD\n {2}Income:Sales {2}-3000\.00 USD/);
  assert.deepEqual(out.unmapped.map(u => [u.account_id, u.count]).sort(), [['acc-card', 2], ['acc-sav', 1]]);
});

test('a second run appends nothing, and a new transaction appends only itself and its new accounts', () => {
  const dir = tmp();
  const file = path.join(dir, 'bank.beancount');
  quiet(() => writeLedger('beancount', ITEMS, file, { balances: true, syncedAt: SYNCED_AT }));
  const first = fs.readFileSync(file, 'utf8');
  const again = quiet(() => writeLedger('beancount', ITEMS, file, { balances: true, syncedAt: SYNCED_AT }));
  assert.equal(again.added, 0);
  assert.equal(again.alreadyThere, 4);
  assert.equal(fs.readFileSync(file, 'utf8'), first);

  const more = structuredClone(ITEMS);
  more[1].transactions.push({ transaction_id: 'tx-fee', account_id: 'acc-sav', date: '2026-10-08', amount: 3, description_raw: 'Fee', merchant_name: null, pending: false, personal_finance_category: { primary: 'BANK_FEES' } });
  const third = quiet(() => writeLedger('beancount', more, file, {}));
  assert.equal(third.added, 1);
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(text.match(/open Expenses:BankFees/g).length, 1);
  assert.equal(text.match(/open Assets:Bank:AllyBank:OnlineSavings-9876/g).length, 1);
  assert.ok(text.startsWith(first));
});

test('bean-check accepts the file (when beancount is installed)', (t) => {
  const bin = [process.env.BEAN_CHECK, 'bean-check'].filter(Boolean).find(b => {
    try { execFileSync(b, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
  });
  if (!bin) return t.skip('bean-check not installed');
  const file = path.join(tmp(), 'bank.beancount');
  // A 2,500.50 balance needs the opening balance the 730-day window doesn't reach; check the entries only.
  quiet(() => writeLedger('beancount', ITEMS, file, { includePending: true }));
  execFileSync(bin, [file], { stdio: 'pipe' });
});

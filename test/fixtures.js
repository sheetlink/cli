// Shared test data: two banks, a checking account, a card and a savings account, with a refund, a
// pending charge, income and a transaction with no category.
export const ITEMS = [
  {
    item_id: 'item-chase',
    institution_name: 'Chase',
    accounts: [
      { account_id: 'acc-chk', name: 'Total Checking', mask: '1111', type: 'depository', subtype: 'checking', current_balance: 2500.5, iso_currency_code: 'USD' },
      { account_id: 'acc-card', name: 'Sapphire Preferred®', mask: '4242', type: 'credit', subtype: 'credit card', current_balance: 310.25, iso_currency_code: 'USD' },
    ],
    transactions: [
      { transaction_id: 'tx-payroll', account_id: 'acc-chk', date: '2026-10-01', amount: -3000, merchant_name: null, description_raw: 'ACME PAYROLL', pending: false, iso_currency_code: 'USD', personal_finance_category: { primary: 'INCOME' } },
      { transaction_id: 'tx-coffee', account_id: 'acc-card', date: '2026-10-03', amount: 5.75, merchant_name: 'Blue Bottle "Coffee"', description_raw: 'BLUE BOTTLE #12; SF | CA', pending: false, iso_currency_code: 'USD', personal_finance_category: { primary: 'FOOD_AND_DRINK' } },
      { transaction_id: 'tx-refund', account_id: 'acc-card', date: '2026-10-05', amount: -20, merchant_name: 'Target', description_raw: 'TARGET REFUND', pending: false, iso_currency_code: 'USD', personal_finance_category: { primary: 'GENERAL_MERCHANDISE' } },
      { transaction_id: 'tx-pending', account_id: 'acc-card', date: '2026-10-06', amount: 42, merchant_name: 'Shell', description_raw: 'SHELL OIL', pending: true, iso_currency_code: 'USD', personal_finance_category: { primary: 'TRANSPORTATION' } },
    ],
  },
  {
    item_id: 'item-ally',
    institution_name: 'Ally Bank',
    accounts: [
      { account_id: 'acc-sav', name: 'Online Savings', mask: '9876', type: 'depository', subtype: 'savings', current_balance: 10000, iso_currency_code: 'USD' },
    ],
    transactions: [
      { transaction_id: 'tx-interest', account_id: 'acc-sav', date: '2026-10-02', amount: -12.34, merchant_name: null, description_raw: 'Interest Paid', pending: false, iso_currency_code: 'USD', personal_finance_category: null },
    ],
  },
];

export const SYNCED_AT = '2026-10-07T15:00:00.000Z';

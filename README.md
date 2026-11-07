# sheetlink

CLI for SheetLink: sync your bank transactions to JSON, CSV, Postgres, SQLite, Beancount or hledger.

```
npm install -g sheetlink
```

Requires a [SheetLink](https://sheetlink.app) account on the **PRO** or **MAX** tier.

---

## Commands

### `sheetlink auth`
Authenticate with SheetLink.

```bash
sheetlink auth                        # OAuth login (PRO): opens browser, login lasts 4 hours
sheetlink auth --api-key sl_...       # API key (MAX, for automation)
```

> **Security note:** Avoid passing `--api-key` directly in commands: it may appear in your shell history. Use the `SHEETLINK_API_KEY` environment variable instead.

### `sheetlink sync`
Sync transactions from all connected banks.

```bash
sheetlink sync                                        # JSON to stdout (default)
sheetlink sync | jq '.items[].transactions | length'  # Pipe to jq
sheetlink sync --output csv                           # CSV snapshot (overwrites each run)
sheetlink sync --output csv --file ~/finances.csv     # CSV to custom path
sheetlink sync --output postgres://localhost/mydb     # Upsert to Postgres (MAX)
sheetlink sync --output sqlite:///~/finance.db        # Upsert to SQLite (MAX)
sheetlink sync --output beancount                     # Append to ./sheetlink.beancount
sheetlink sync --output hledger                       # Append to ./sheetlink.journal
sheetlink sync --item <item_id>                       # One bank only
sheetlink sync --from 2026-01-01 --to 2026-03-31      # A custom date range
```

> **Note:** CSV output overwrites the file on every run. For an append/dedup history, use Postgres, SQLite, Beancount or hledger.

**Postgres and SQLite pull only what's new.** The first run pulls the full history (up to 730 days). After that, each bank is pulled from its latest stored date minus 30 days, which catches pending transactions that settle. A bank gets the full history again when one of its accounts has nothing stored yet, for example an account you just added to the connection. Use `--full` to re-pull everything, or `--from`/`--to` for a set range. JSON and CSV always return the full history.

### Beancount and hledger

```bash
sheetlink sync --output beancount --file books/bank.beancount
sheetlink sync --output hledger --file books/bank.journal
sheetlink sync --output beancount --account-map map.json --balances
```

Each run appends only transactions the file doesn't already have, matched by Plaid's transaction id (`plaid_id`). Entries you've edited stay as they are. Every account a run uses gets an `open` (Beancount) or `account` (hledger) line the first time.

- **Settled transactions only.** `--include-pending` also writes pending ones, flagged `!`. A pending transaction gets a new id when it settles, so you'd delete the pending entry yourself.
- **Signs:** money out credits the bank or card account and debits the counter account. A card charge grows the card's liability.
- **Default accounts:** `Assets:Bank:<Bank>:<Account>-<last 4>` (cards: `Liabilities:Card:...`, loans: `Liabilities:Loan:...`). The counter account comes from Plaid's category: `Expenses:FoodAndDrink`, and `Income:Income` for income and transfers in. A refund goes back to the expense it reverses. With no category: `Expenses:Uncategorized` or `Income:Uncategorized`.
- **`--account-map map.json`** names the accounts yourself. When the map lists accounts, only those accounts are written, and the rest are listed on stderr. This keeps personal accounts out of business books.
  ```json
  {
    "accounts": { "<plaid account_id>": "Assets:Bank:Business:Checking" },
    "categories": { "FOOD_AND_DRINK": "Expenses:Meals" }
  }
  ```
  `sheetlink items` shows the account ids.
- **`--balances`** adds a balance assertion for each account at Plaid's current balance, dated the day after the sync. It only holds when the file has the account's full history or an opening balance.

### `sheetlink investments`
Sync investment holdings and activity from brokerages with investment tracking enabled. MAX tier. Enable a brokerage by choosing "Investment account" when you connect it in the extension, Excel add-in, or dashboard.

```bash
sheetlink investments                                    # Holdings + activity as JSON
sheetlink investments --output csv --file ~/inv.csv      # Writes ~/inv.csv + ~/inv-activity.csv
sheetlink investments --output postgres://localhost/mydb # Upsert holdings + activity tables
sheetlink investments --output sqlite:///~/finance.db    # Upsert to SQLite
sheetlink investments --item <item_id>                   # One brokerage only
sheetlink investments --from 2026-01-01 --to 2026-03-31  # Activity in a custom date range
```

Holdings upsert by account + security; activity dedups by transaction id. Only brokerages with investment tracking enabled return data.

### `sheetlink items`
List connected bank accounts.

```bash
sheetlink items
```

### `sheetlink config`
View or update CLI configuration.

```bash
sheetlink config                          # Show current config
sheetlink config --set default_output=csv # Set default output
```

**Settable keys:**
- `default_output`: `json`, `csv`, `postgres://...`, `sqlite://...`
- `api_url`: Backend URL (default: `https://api.sheetlink.app`)

**Environment variable overrides:**
- `SHEETLINK_API_KEY`: API key (MAX tier)
- `SHEETLINK_OUTPUT`: Default output destination
- `SHEETLINK_API_URL`: Backend URL

---

## Tiers

| Feature | PRO | MAX |
|---|---|---|
| JSON / CSV output | ✅ | ✅ |
| Beancount / hledger output | ✅ | ✅ |
| Postgres output | ✗ | ✅ |
| SQLite output | ✗ | ✅ |
| API key auth (unattended/cron) | ✗ | ✅ |

PRO logins last 4 hours, so scheduled runs (cron, CI) need a MAX API key.

[View pricing →](https://sheetlink.app/pricing)

---

## Requirements

- Node.js 22 or later
- SQLite output uses an optional module (`better-sqlite3`). If it can't be installed on your computer, everything else still works, and `--output sqlite` tells you why.
- A SheetLink account with at least one connected bank ([sheetlink.app/dashboard](https://sheetlink.app/dashboard))

---

## License

MIT © [SheetLink](https://sheetlink.app)

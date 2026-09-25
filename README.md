# sheetlink

CLI for SheetLink — sync your bank transactions to any destination.

```
npm install -g sheetlink
```

Requires a [SheetLink](https://sheetlink.app) account on the **PRO** or **MAX** tier.

---

## Commands

### `sheetlink auth`
Authenticate with SheetLink.

```bash
sheetlink auth                        # OAuth login (PRO) — opens browser, JWT valid for ~1 hour
sheetlink auth --api-key sl_...       # API key (MAX — for automation)
```

> **Security note:** Avoid passing `--api-key` directly in commands — it may appear in your shell history. Use the `SHEETLINK_API_KEY` environment variable instead.

### `sheetlink sync`
Sync transactions from all connected banks.

```bash
sheetlink sync                                        # JSON to stdout (default)
sheetlink sync | jq '.items[].transactions | length'  # Pipe to jq
sheetlink sync --output csv                           # CSV snapshot (overwrites each run)
sheetlink sync --output csv --file ~/finances.csv     # CSV to custom path
sheetlink sync --output postgres://localhost/mydb     # Upsert to Postgres (MAX)
sheetlink sync --output sqlite:///~/finance.db        # Upsert to SQLite (MAX)
sheetlink sync --item <item_id>                       # One bank only
```

> **Note:** CSV output overwrites the file on every run. For an append/dedup history, use Postgres or SQLite.

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
- `default_output` — `json`, `csv`, `postgres://...`, `sqlite://...`
- `api_url` — Backend URL (default: `https://api.sheetlink.app`)

**Environment variable overrides:**
- `SHEETLINK_API_KEY` — API key (MAX tier)
- `SHEETLINK_OUTPUT` — Default output destination
- `SHEETLINK_API_URL` — Backend URL

---

## Tiers

| Feature | PRO | MAX |
|---|---|---|
| JSON / CSV output | ✅ | ✅ |
| Postgres output | — | ✅ |
| SQLite output | — | ✅ |
| API key auth (unattended/cron) | — | ✅ |

[View pricing →](https://sheetlink.app/pricing)

---

## Requirements

- Node.js 18+
- A SheetLink account with at least one connected bank ([sheetlink.app/dashboard](https://sheetlink.app/dashboard))

---

## License

MIT © [SheetLink](https://sheetlink.app)

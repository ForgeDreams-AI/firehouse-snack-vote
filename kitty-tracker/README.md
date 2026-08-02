# Kitty Tracker

Tracks weekly dues for a fire academy class. Venmo payments record themselves
from Gmail; cash and corrections happen on a dashboard. Google Sheet is the
database, Apps Script is the whole backend — nothing to host, nothing to pay for.

---

## Handing it to the next class

1. Open `Config.gs` and edit the **SETTINGS** block at the top — collector name,
   their Venmo handle and email, season start date, weeks, weekly dues.
   *That block is the only thing you should ever need to change.*
2. Run **`setUpKitty()`** once. It builds the tabs and installs every trigger.
3. Link the sign-up Google Form to this spreadsheet, then run
   **`syncFormResponses()`** to fill the Roster.
4. Deploy the web app (Deploy → New deployment → Web app) and share the URL.

That's it. It runs itself from there.

---

## How money gets credited

- **Credit follows the sender.** Whoever the receipt says paid gets the credit,
  read from the "*X paid you*" subject line — the only field Venmo writes
  reliably. The typed note is stored for reference but never decides credit.
- **The collector is never auto-credited.** Their name and @handle are on every
  receipt, so any match on them is ignored.
- **Only whole-week amounts auto-credit** ($20, $40, $60 …). Odd amounts wait in
  the dashboard's review queue.
- **Duplicates are impossible.** Every payment is fingerprinted by
  date + payer + amount, so the poller and a statement import can't both record
  the same payment.
- **Paying for someone else** shows up in the dashboard's *Possible Splits*
  panel — tap **Split** to divide it across the people named.

## Day to day

Nothing. The poller runs every 15 minutes; reminders send themselves. Use the
dashboard to log cash, clear the review queue, split payments and add receipts.

## If the numbers look wrong

Everything you can run by hand lives in **`Admin.gs`**:

| Function | What it does |
|---|---|
| `importVenmoStatement()` | **The fix-everything button.** Paste a downloaded Venmo statement into a tab named `StatementImport`, run this, and all Venmo is rebuilt from the bank's own record. Cash is never touched. |
| `recheckCredits()` | Re-applies the crediting rules to existing rows (use after changing the collector or fixing a roster name). |
| `removeDuplicatePayments()` | Clears duplicates left by an old bad import. |
| `previewVenmoParsing()` | Shows what the parser reads from recent receipts, without writing anything. |
| `installTriggers()` / `removeTriggers()` | Turn the automation on or off. |

Every one backs the Ledger up to a timestamped tab first and is safe to re-run.

---

## Files

| File | Contains |
|---|---|
| `Config.gs` | All settings. The only file you edit for a new class. |
| `Venmo.gs` | Reads receipts from Gmail and credits them. All crediting rules. |
| `SheetService.gs` | Tab schema and every read/write to the sheet. |
| `WebApp.gs` + `dashboard.html` | The dashboard. |
| `Reminders.gs` | Weekly reminder emails. |
| `Expenses.gs` + `ReceiptReport.gs` | Receipt scanning and spend reports. |
| `FormIntake.gs` | Sign-up Form → Roster. |
| `Admin.gs` | Setup, triggers and every by-hand repair tool. |

Tabs: **Roster** · **Ledger** · **Expenses** (plus `Ledger_bak_*` safety copies).

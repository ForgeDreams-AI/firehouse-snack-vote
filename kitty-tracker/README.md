# PHX FD Academy Kitty Tracker

A separate **Google Apps Script web app** (not part of the snack-vote site) that
tracks weekly dues for 55 recruits: logs cash/Venmo payments, parses Venmo
"paid you" emails automatically, sends dues reminders, and (Feature 3) logs
Costco receipts and emails an itemized spend report.

> This folder is a **backup + paste source** for the Apps Script project. The
> live app runs inside Google Apps Script (bound to the *KittyPayments* sheet),
> not from this repo. Edit there by copy-pasting these files in.

## Files (paste each into the matching Apps Script file)

| File | Role |
|------|------|
| `Config.gs` | Constants: season dates, dues, tabs, columns, reminder schedule. |
| `SheetService.gs` | All sheet reads/writes; schema bootstrap + v1→v2 migration. |
| `GmailParser.gs` | Time-driven Venmo email parser + backfill. |
| `Reminders.gs` | Dues-reminder send engine + email templates. |
| `WebApp.gs` | `doGet` + every `google.script.run` dashboard endpoint. |
| `Triggers.gs` | `installTriggers()` — run once to schedule everything. |
| `FormIntake.gs` | Pull recruit sign-ups from a linked Google Form into Roster. |
| `Expenses.gs` | Receipt upload → free Drive OCR → parse → reconcile → write. |
| `ReceiptReport.gs` | Build + send the itemized spend report email. |
| `dashboard.html` | The operator dashboard UI (this is the file that was crashing). |

## The crash that was fixed (dashboard.html)

The dashboard's payment modal called JavaScript functions that **did not exist**,
so opening **+ Log Payment** and tapping a method or **Log payment** threw a
`ReferenceError` and the page died. Fixed in this version:

| Was broken | Fix |
|------------|-----|
| `onModalRecruit()`, `setMethod()`, `amtTouched()`, `logPay()` referenced but never defined | Implemented all four; modal now logs cash/Venmo with the multi-week picker, custom amount, and "paid by" |
| Week-picker never rendered | `renderWeeks()` builds week buttons; already-covered weeks are greyed |
| `drillDown('+r.rid+')` → `drillDown(R001)` (rid not quoted) | rid is now quoted; drill-down loads full history via `getRecruitPaymentsWeb` |
| `r.weeksConvered` typo → blank Weeks column | uses `r.weeksCovered` |
| `r.statusLabel` (server sends `status`) → wrong badge | uses `r.status` + colored badge |
| Review queue had no actions | Added **Assign**, **Split** (with live balance check), and **Dismiss** |
| No pause control | Added a **Pause/Resume reminders** button |

The backend `.gs` files were **not the problem** and are unchanged from what's
deployed — they're saved here verbatim for backup.

### To deploy the fix
1. Apps Script editor → open the `dashboard.html` file.
2. Select all, delete, paste the contents of this folder's `dashboard.html`.
3. Save. **Deploy → Manage deployments → Edit → New version → Deploy** (keep the
   same `/exec` URL).

## Setup notes (for reference)
- Run `setupKitty()` once to create/upgrade tabs (Roster, Ledger, Expenses) and
  back-fill from Venmo emails.
- Run `installTriggers()` once to schedule the Venmo poller + reminders.
- For receipts (Feature 3): Editor → **Services** → add **Drive API** (v2).
- Sheet tabs: **Roster** (RecruitID, FullName, Email, VenmoHandle, Status, Notes),
  **Ledger** (10 cols, v2), **Expenses** (11 cols).

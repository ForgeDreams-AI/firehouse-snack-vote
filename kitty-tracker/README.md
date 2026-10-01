# Kitty Tracker

Tracks weekly dues for a fire academy class. Venmo payments record themselves
from Gmail; cash and corrections happen on a dashboard. Google Sheet is the
database, Apps Script is the whole backend — nothing to host, nothing to pay for.

---

## Handing it to the next manager — no code, ever

Everything happens from the **🔥 Kitty** menu in the Google Sheet.

**New manager:**
1. Open the kitty sheet and do **File ▸ Make a copy**. The copy brings all the code with it.
2. In your copy: **🔥 Kitty ▸ Start a new academy…** and type `NEW ACADEMY`.
   A full copy of the old academy is saved to Drive, then every recruit,
   payment, receipt and sign-up is cleared.
3. The Settings screen opens. Fill in the academy name, your name, your Venmo
   handle and the week 1 start date, then **Save & turn on**. Google asks you to
   allow access once.
4. Share the sign-up form link shown on the dashboard. Sign-ups go straight onto the Roster.

That's it. Venmo receipts are read from **your** Gmail, so recruits must pay
the Venmo account that emails you. Reminders go out on their own, the season
stops itself after the last week, and **🔥 Kitty ▸ Open dashboard** is the
whole app.

**Old manager:** in your own sheet, pick **🔥 Kitty ▸ Turn off automation**.

*Optional, for phone access:* Extensions ▸ Apps Script ▸ Deploy ▸ New
deployment ▸ Web app ▸ Deploy, then bookmark the link.

Until Settings are saved, the tracker stays switched off: nothing is credited
and no emails go out. All settings live on the **Settings** tab.

---

## How the money model works

Two tables, one job each — this separation is what makes it hard to get wrong:

| Tab | Holds |
|---|---|
| **Payments** | What actually arrived. One row per real transaction, keyed by Venmo's own ID. Never edited — this is the bank's record. |
| **Ledger** | Who got the credit. A payment covering three people makes three rows. Editable; all human judgment lives here. |

The dashboard shows a **reconciliation bar**: green when the Ledger's Venmo rows
sum to the Payments tab, red the moment they drift. Run `checkTheBooks()` any
time for the same check. If it's green, the money is right and any remaining
problem is just attribution.

## Pay codes — how payers make sure it's credited right

Every recruit's pay code is their RecruitID (`R012`). A Venmo note of
**`Kitty R012`** credits R012 automatically — even when it's sent from a
parent's or partner's account. **`Kitty R012 R015`** splits the payment
equally between them.

Nobody has to remember this: every reminder email has a **Pay on Venmo**
button that opens the app with the amount and note already filled in. On the
dashboard, tap a recruit for their code, a **Copy pay link** button and a
ready-to-text message. **Who Owes → Copy list** includes everyone's code and the
how-to-pay instructions for the group chat.

## Payment methods

**⚙ Payment methods** on the dashboard lets the kitty manager add Zelle, Cash
App, Apple Pay, etc. (name, where to send it, instructions). They show up in
**Log Payment**, in the money totals, and in the reminder emails. They're
stored on the **PaymentMethods** tab. Venmo and Cash are built in; Venmo is
the only one recorded automatically.

## How money gets credited

- **A pay code wins.** `Kitty R012` in the note credits R012, whoever sent it.
- **Otherwise credit follows the sender.** Whoever the receipt says paid gets
  the credit, read from the "*X paid you*" subject line. Names typed in an
  email note don't decide credit — they show up under Possible Splits.
- **Your decisions stick.** Anything you assign, split, dismiss or log by hand
  is marked `Payment Good! (by hand)` / `Dismissed`. The poller,
  `recheckCredits()` and `importVenmoStatement()` never move those rows.
  Dismissed payments stay in the sheet (crediting nobody) so they can't come
  back.
- **The collector is never auto-credited.** Their name and @handle are on every
  receipt, so any match on them is ignored.
- **Only whole-week amounts auto-credit** ($20, $40, $60 …). Odd amounts wait in
  the dashboard's review queue.
- **Duplicates are impossible.** Every payment is fingerprinted by
  date + payer + amount, so the poller and a statement import can't both record
  the same payment. Fingerprints are counted, so two genuine $20s from one
  person on one day are both kept.
- **Paying for someone else is automatic.** A statement note that names other
  recruits ("Kyle Davis, Ivan Hernandez", "for rico", "me and Carson") splits
  the payment across them. Nicknames live in the **Aliases** tab — add a row
  instead of fixing payments by hand. Anything that doesn't divide evenly goes
  to review rather than being guessed at.

## Day to day

Nothing. The poller runs every 15 minutes; reminders send themselves. Use the
dashboard to log cash, clear the review queue, split payments and add receipts.

## If the numbers look wrong

Everything you can run by hand lives in **`Admin.gs`**:

| Function | What it does |
|---|---|
| `importVenmoStatement()` | **The fix-everything button.** Paste a downloaded Venmo statement into a tab named `StatementImport`, run this, and all Venmo is rebuilt from the bank's own record. Cash is never touched. |
| `recheckCredits()` | Re-applies the crediting rules (pay codes, names, Aliases, sender) to automatic rows. Never touches rows you decided by hand. |
| `removeDuplicatePayments()` | Clears duplicates left by an old bad import. |
| `previewVenmoParsing()` | Shows what the parser reads from recent receipts, without writing anything. |
| `installTriggers()` / `removeTriggers()` | Turn the automation on or off. |

Every one backs the Ledger up to a timestamped tab first and is safe to re-run.

---

## Files

| File | Contains |
|---|---|
| `Config.gs` | Reads the Settings tab. Nothing to edit. |
| `Venmo.gs` | Reads receipts from Gmail and credits them. All crediting rules. |
| `SheetService.gs` | Tab schema and every read/write to the sheet. |
| `WebApp.gs` + `dashboard.html` | The dashboard. |
| `Reminders.gs` | Weekly reminder emails. |
| `Expenses.gs` + `ReceiptReport.gs` | Receipt scanning and spend reports. |
| `FormIntake.gs` | Sign-up Form → Roster. |
| `Admin.gs` | The 🔥 Kitty menu, settings, new academy, triggers and repair tools. |

Tabs: **Settings** · **Roster** · **Ledger** · **Payments** · **Aliases** · **PaymentMethods** · **Expenses** (plus `Ledger_bak_*` safety copies).

# Snack-Vote Apps Script (voting sheet backend)

`Code.gs` is the Google Apps Script bound to the **voting** spreadsheet (Items,
Votes, WriteIns, Votes Archive, Purchases). It's what the voting website POSTs to.

> Backup + paste source. The live script runs inside Apps Script on the voting
> sheet — edit there by pasting this file in.

## What it does
- **Votes** → one row per pick in **Votes**, capped at 3 per section (using Items categories).
- **Write-ins** → **WriteIns** tab; every Monday ~3am they're promoted onto the ballot
  (Items, category "Crew Write-Ins") and the votes are archived + cleared.
- **Receipts** (added) → on a `type:"receipt"` POST, every line item is logged to the
  **Purchases** tab, and each bought item is added to the ballot (Items) with its price
  — powering the 🛒 "bought last week" badge. Existing items just get their price refreshed
  (no duplicates).

## What changed from the previous version
Only **additions** — nothing existing was removed:
- New constants: `PURCHASES_TAB`, `ITEMS_HEADERS`, `PURCHASES_HEADERS`.
- `doPost` now routes `type:"receipt"` to the new `handleReceipt_()`.
- New `handleReceipt_()`, `upsertItem_()`, `getPurchasesSheet_()`, `getOrCreateItemsSheet_()`.
- The runaway indentation from the old paste is cleaned up (cosmetic).

## To deploy
1. Apps Script editor (voting sheet) → replace `Code.gs` with this file → save.
2. **Deploy → Manage deployments → Edit → New version → Deploy** (keep the same `/exec` URL).
3. First run will prompt to re-authorize (it now touches the Items + Purchases tabs).

## Sheet tabs
`Items` (Category, Item, Tag, Price, Servings, Active) · `Votes` (Timestamp, Name, Item) ·
`WriteIns` (Timestamp, Name, Suggestion, Status) · `Votes Archive` (Week Of, Timestamp, Name, Item) ·
`Purchases` (Date, Item, Category, Qty, Price, Total, Store, Photo, Timestamp).
Publish each to the web as CSV for the site to read; paste the Purchases CSV URL into
`PURCHASES_CSV_URL` in `index.html`.

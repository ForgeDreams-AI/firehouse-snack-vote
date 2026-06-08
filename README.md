# Firehouse Snack Vote

A single-file web app (`index.html`) for the crew to vote on snacks, see live
results, plan a weekly budget, and **scan grocery receipts**. It uses a free
Google Sheet as the database and a Google Apps Script as the write endpoint.
No server to run, no account for voters.

---

## What's in the box

| Tab in the app | What it does |
|----------------|--------------|
| **Vote**       | The ballot. Pick up to 3 per section. Badges: 🟢 pocket-proof, 🫠 melts, 🛒 bought last week. |
| **Results**    | Live tally + write-in buzz. |
| **Budget**     | Top-3-per-section shopping planner against a weekly budget. |
| **Receipts**   | **Snap a receipt → on-device OCR → review → save.** Logs what was bought, adds those items to the ballot with their prices, and tags them 🛒 for next week's vote. |

---

## The Receipts feature (what you asked for)

1. Open the **Receipts** tab and tap **Add a receipt photo** (camera or library).
   Long receipt? **Add several photos top-to-bottom** (or select multiple at once) —
   each one becomes a numbered page in the strip.
2. Each photo is read **on your phone** with [Tesseract.js](https://tesseract.js.org/)
   (loaded once from a CDN — no API key, nothing uploaded to read it). When photos
   **overlap**, the app detects the repeated run of rows (the tail of one page that
   matches the head of the next) and **drops the duplicates automatically**, so an
   item that shows up in two photos is only counted once. The status line tells you
   how many overlapping rows it removed; anything it misses you can delete in the
   review table.
3. A **review table** appears: item, qty, price each, and category. The scan is
   never perfect, so fix anything that looks off and delete junk rows. You can
   also **add lines by hand** or skip OCR entirely.
4. A **report** of what was bought (grouped by section, with totals) builds live.
   Copy it with **Copy report**.
5. Tap **Save receipt**. That sends the line items to your Apps Script, which:
   - appends every line to the **Purchases** tab (the shopping log), and
   - **adds/updates each item on the ballot** (Items tab) with its price.
6. Anything bought during the **previous calendar week** (Mon–Sun) shows a
   🛒 badge on the Vote and Results tabs, so the crew can see "we already got
   this last week."

> "Bought last week" = the calendar week *before* the current one. So a receipt
> saved this week starts showing 🛒 once next week begins.

---

## One-time setup

### 1. The Google Sheet — tabs & columns

Create one Google Sheet with these tabs (header row exactly as shown; column
order doesn't matter, the app maps by header name):

**Items** (the ballot)
```
Category | Item | Tag | Price | Servings | Active
```
- `Tag`: `Fire Ground` (🟢 pocket-proof), `Heat` (🫠 melts), `Both`, or blank.
- `Price`: dollars per pack (used by Budget and shown on receipts).
- `Servings`: units per pack (Budget only; optional).
- `Active`: `y` to show on the ballot. Receipt-added items default to `y`.

**Votes**
```
Timestamp | Name | Item
```
(One row per picked item. The script writes these.)

**WriteIns**
```
Name | Suggestion | Status
```

**Purchases**  ← new, for receipts
```
Date | Item | Category | Qty | Price | Total | Store | Photo | Timestamp
```
(The script writes these on Save receipt. `Date` drives the 🛒 badge.)

### 2. Publish each tab as CSV

For **Items, Votes, WriteIns, and Purchases**:
`File → Share → Publish to web → choose the tab → Comma-separated values (.csv) → Publish`,
then copy each URL into the matching slot in the `CONFIG` block at the top of
`index.html`:

```js
const CONFIG = {
  SCRIPT_URL:       "https://script.google.com/macros/s/…/exec",
  ITEMS_CSV_URL:    "…Items tab CSV…",
  VOTES_CSV_URL:    "…Votes tab CSV…",
  WRITEINS_CSV_URL: "…WriteIns tab CSV…",
  PURCHASES_CSV_URL:"…Purchases tab CSV…"   // ← paste yours here
};
```

> The 🛒 badge stays off until `PURCHASES_CSV_URL` is set — everything else
> works without it.

### 3. The Apps Script (handles votes **and** receipts)

In the Sheet: `Extensions → Apps Script`, replace `Code.gs` with the script
below, then `Deploy → New deployment → Web app`, set **Execute as: Me** and
**Who has access: Anyone**, and copy the `/exec` URL into `SCRIPT_URL`.

If you already have a vote-handling script, this is a drop-in replacement — it
keeps the vote behavior and adds receipts.

```javascript
// ---- Firehouse Snack Vote: votes + receipts endpoint ----
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data && data.type === 'receipt') return handleReceipt(data);
    return handleVote(data);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet(name) {
  var s = ss().getSheetByName(name);
  if (!s) s = ss().insertSheet(name);
  return s;
}

// --- Votes (one row per picked item) + write-in suggestions ---
function handleVote(data) {
  var ts = data.timestamp || new Date().toISOString();
  var name = (data.name || '').toString().trim();
  var votes = sheet('Votes');
  if (votes.getLastRow() === 0) votes.appendRow(['Timestamp', 'Name', 'Item']);
  (data.items || []).forEach(function (item) {
    votes.appendRow([ts, name, String(item)]);
  });
  var sug = (data.suggestion || '').toString().trim();
  if (sug) {
    var wi = sheet('WriteIns');
    if (wi.getLastRow() === 0) wi.appendRow(['Name', 'Suggestion', 'Status']);
    wi.appendRow([name, sug, '']);
  }
  return ok();
}

// --- Receipts: log purchases + upsert items onto the ballot ---
function handleReceipt(data) {
  var ts = data.timestamp || new Date().toISOString();
  var date = (data.date || '').toString().trim();
  var store = (data.store || '').toString().trim();
  var photo = (data.photo || '').toString().trim();
  var lines = data.lines || [];

  var p = sheet('Purchases');
  if (p.getLastRow() === 0)
    p.appendRow(['Date', 'Item', 'Category', 'Qty', 'Price', 'Total', 'Store', 'Photo', 'Timestamp']);

  lines.forEach(function (l) {
    var item = (l.item || '').toString().trim();
    if (!item) return;
    var qty = Number(l.qty) || 0;
    var price = (l.price === '' || l.price == null) ? '' : Number(l.price);
    var total = (price === '') ? '' : qty * price;
    p.appendRow([date, item, (l.category || '').toString().trim(), qty, price, total, store, photo, ts]);
    upsertItem(item, (l.category || '').toString().trim(), price);
  });
  return ok();
}

// Add the item to the Items tab, or update its price if it already exists.
function upsertItem(item, category, price) {
  var items = sheet('Items');
  if (items.getLastRow() === 0)
    items.appendRow(['Category', 'Item', 'Tag', 'Price', 'Servings', 'Active']);

  var values = items.getDataRange().getValues();
  var header = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var cItem = header.indexOf('item');
  var cCat = header.indexOf('category');
  var cPrice = header.indexOf('price');
  var cActive = header.indexOf('active');
  if (cItem < 0 || cCat < 0) return; // sheet not set up as expected

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][cItem]).trim().toLowerCase() === item.toLowerCase()) {
      if (cPrice >= 0 && price !== '' && price != null)
        items.getRange(r + 1, cPrice + 1).setValue(price);
      if (cActive >= 0 && !String(values[r][cActive]).trim())
        items.getRange(r + 1, cActive + 1).setValue('y');
      return; // already on ballot
    }
  }
  // new item — append a row matching the header width
  var row = new Array(values[0].length).fill('');
  row[cItem] = item;
  row[cCat] = category || 'Snacks';
  if (cPrice >= 0 && price !== '' && price != null) row[cPrice] = price;
  if (cActive >= 0) row[cActive] = 'y';
  items.appendRow(row);
}

function ok() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

After deploying, the app posts with `Content-Type: text/plain` and `no-cors`
(so the browser never blocks it). The app can't read the response, so it
optimistically refreshes from the published CSVs a few seconds later.

---

## Hosting

`index.html` is fully self-contained — host it anywhere static (GitHub Pages,
Netlify, a shared drive, even opening the file locally). The OCR library and
fonts load from public CDNs on demand.

## Privacy note on receipts

Receipt photos are read **in the browser** and are **not uploaded** (even when a
long receipt takes several photos). Only the final line items you confirm (item,
qty, price, category, date, optional store name and the photos' file names) are
sent to your Sheet.

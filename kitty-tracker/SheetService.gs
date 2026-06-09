/*  SheetService.gs — all reads/writes go through here.   (v2)
 *  Everything (paid status, weeks covered) is DERIVED from the Ledger at read
 *  time; we never store mutable per-week checkboxes. WeekApplied is recorded
 *  for the operator's audit trail only — coverage math always uses the
 *  cumulative dollar sum, exactly as in v1. */

function ss_()        { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name) { return ss_().getSheetByName(name); }

/* ── Schema bootstrap + v1→v2 migration ──────────────────────────────────── *
 * Idempotent. Safe to call on every read/trigger: it returns fast once the
 * sheet is already on the v2 layout. Creates missing tabs, and upgrades a v1
 * (8-column) Ledger to the v2 (10-column) layout WITHOUT losing data. */
function ensureSchema_(){
  const ss = ss_();

  // Roster
  let ros = ss.getSheetByName(ROSTER_TAB);
  if (!ros){ ros = ss.insertSheet(ROSTER_TAB); ros.getRange(1, 1, 1, ROSTER_HEADERS.length).setValues([ROSTER_HEADERS]); }

  // Ledger (create fresh, or migrate existing)
  let led = ss.getSheetByName(LEDGER_TAB);
  if (!led){
    led = ss.insertSheet(LEDGER_TAB);
    led.getRange(1, 1, 1, LEDGER_HEADERS.length).setValues([LEDGER_HEADERS]);
  } else {
    migrateLedger_(led);
  }

  // Expenses (new in v2)
  let exp = ss.getSheetByName(EXPENSES_TAB);
  if (!exp){ exp = ss.insertSheet(EXPENSES_TAB); exp.getRange(1, 1, 1, EXPENSES_HEADERS.length).setValues([EXPENSES_HEADERS]); }
}

/* Upgrade an existing Ledger to the v2 column layout.
 *   v1: TS RID Name Method Amount Week | Source | Review           (8 cols)
 *   v2: TS RID Name Method Amount Week | Payer Source Split Review  (10 cols)
 * We insert PayerName before old Source (col 7), then SplitGroupID before the
 * review flag — existing Source/Review cell data rides along to its new column. */
function migrateLedger_(sh){
  const width = sh.getLastColumn();

  // Truly empty existing tab (no header) → just lay down v2 headers.
  if (sh.getLastRow() < 1 || width < 1){
    sh.getRange(1, 1, 1, LEDGER_HEADERS.length).setValues([LEDGER_HEADERS]);
    return;
  }

  const hdr = sh.getRange(1, 1, 1, Math.max(width, LEDGER_HEADERS.length)).getValues()[0];
  const h   = i => String(hdr[i] == null ? '' : hdr[i]).trim().toLowerCase();

  // Already v2 (PayerName@G, Source@H, SplitGroupID@I) → re-assert exact header text, done.
  if (h(LED.PAYER - 1) === 'payername' && h(LED.SOURCE - 1) === 'source' && h(LED.SPLIT - 1) === 'splitgroupid'){
    sh.getRange(1, 1, 1, LEDGER_HEADERS.length).setValues([LEDGER_HEADERS]);
    return;
  }

  // Exact v1 shape: 8 columns, col 7 header = "Source".
  if (width <= 8 && h(6) === 'source'){
    sh.insertColumnBefore(7); sh.getRange(1, 7).setValue('PayerName');     // self-describe immediately so a
    sh.insertColumnBefore(9); sh.getRange(1, 9).setValue('SplitGroupID');  // partial run is still recoverable
    sh.getRange(1, 1, 1, LEDGER_HEADERS.length).setValues([LEDGER_HEADERS]);
    Logger.log('Ledger migrated v1 (8-col) → v2 (10-col). Existing Source/Review data preserved.');
    return;
  }

  // Recovery: first insert landed (PayerName@G) but the run died before the second.
  if (width === 9 && h(6) === 'payername'){
    sh.insertColumnBefore(9); sh.getRange(1, 9).setValue('SplitGroupID');
    sh.getRange(1, 1, 1, LEDGER_HEADERS.length).setValues([LEDGER_HEADERS]);
    Logger.log('Ledger half-migration recovered (added SplitGroupID).');
    return;
  }

  // Anything else: DON'T shuffle data. Only assert header text if already 10-wide.
  if (width >= LEDGER_HEADERS.length){
    sh.getRange(1, 1, 1, LEDGER_HEADERS.length).setValues([LEDGER_HEADERS]);
  } else {
    Logger.log('Ledger layout unrecognized (width ' + width + ') — left untouched. Migrate by hand or restore from a copy.');
  }
}

// One-tap setup: migrate the schema, THEN re-read the Venmo inbox to back-fill
// PayerName onto existing rows and ingest any previously-missed receipts.
// Safe to re-run anytime — both halves are idempotent.
function setupKitty(){
  ensureSchema_();
  const back = backfillFromEmails();   // defined in GmailParser.gs
  return 'Schema ready: Roster, Ledger (v2), Expenses.\n' + back;
}

// Schema/migration only — fast, no Gmail scan. This is what runs on dashboard
// loads and triggers. Use setupKitty() when you also want the email rerun.
function setupSchemaOnly(){ ensureSchema_(); return 'Schema ready (no email rerun).'; }

/* ── Time / week math ────────────────────────────────────────────────────── */
function getCurrentWeek(date){
  const t = (date || new Date()).getTime();
  const w = Math.floor((t - SEASON_START_MS) / WEEK_MS) + 1;
  return Math.max(1, Math.min(SEASON_WEEKS, w));
}
// Season is closed once week 15's reminder window has fully passed (start + 15 weeks).
function seasonClosed(date){
  const t = (date || new Date()).getTime();
  return t >= SEASON_START_MS + SEASON_WEEKS * WEEK_MS;
}
function nowStamp_(){ return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss'); }
function round2_(n){ return Math.round((Number(n) || 0) * 100) / 100; }

/* ── Roster ──────────────────────────────────────────────────────────────── */
function getRoster_(){
  const sh = sheet_(ROSTER_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, ROSTER_HEADERS.length).getValues();
  const out = [];
  vals.forEach((r, i) => {
    const rid = String(r[ROS.RID - 1]).trim();
    if (!rid) return;
    out.push({
      row: i + 2,
      rid: rid,
      name: String(r[ROS.NAME - 1]).trim(),
      email: String(r[ROS.EMAIL - 1]).trim(),
      venmo: String(r[ROS.VENMO - 1]).trim().replace(/^@/, '').toLowerCase(),
      status: String(r[ROS.STATUS - 1]).trim() || 'Active',
      notes: String(r[ROS.NOTES - 1]).trim()
    });
  });
  return out;
}
// "Active" = anyone not Withdrawn (matches who the reminder engine emails, so
// nobody gets dunned without also receiving the spend report).
function activeRoster_(){ return getRoster_().filter(r => r.status.toLowerCase() !== 'withdrawn'); }
function recruitById_(rid){ return getRoster_().filter(r => r.rid === rid)[0] || null; }

/* ── Ledger ──────────────────────────────────────────────────────────────── */
function getLedger_(){
  const sh = sheet_(LEDGER_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, LEDGER_HEADERS.length).getValues();
  return vals.map((r, i) => ({
    row: i + 2,
    ts: r[LED.TS - 1],
    rid: String(r[LED.RID - 1]).trim(),
    name: String(r[LED.NAME - 1]).trim(),
    method: String(r[LED.METHOD - 1]).trim(),
    amount: Number(r[LED.AMOUNT - 1]) || 0,
    week: r[LED.WEEK - 1],
    payer: String(r[LED.PAYER - 1]).trim(),
    source: String(r[LED.SOURCE - 1]).trim(),
    splitGroup: String(r[LED.SPLIT - 1]).trim(),
    review: isReview_(r[LED.REVIEW - 1])
  }));
}
// True when a ReviewFlag cell means "needs review" — understands the new
// "Payment Bad!" wording AND legacy boolean true / "true".
function isReview_(v){
  if (v === true) return true;
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'true' || s === REVIEW_BAD.toLowerCase();
}
// Sum of amounts per RecruitID (review rows are NOT counted toward a recruit).
function cumulativeMap_(){
  const m = {};
  getLedger_().forEach(e => {
    if (e.review || !e.rid) return;
    m[e.rid] = (m[e.rid] || 0) + e.amount;
  });
  return m;
}
function processedSourceSet_(){
  const s = {};
  getLedger_().forEach(e => { if (e.source) s[e.source] = true; });
  return s;
}

/* Append one payment row.
 * opts = { payer, splitGroup, weekApplied }  (all optional)
 *   payer       → PayerName col; defaults to the credited recruit's name.
 *   splitGroup  → shared SplitGroupID when one inbound payment is split.
 *   weekApplied → explicit WeekApplied text (e.g. "2,3,4" from the week-picker
 *                 or split UI). When omitted, computed from cumulative-after. */
function appendPayment_(rid, name, method, amount, source, review, opts){
  opts = opts || {};
  const after        = (cumulativeMap_()[rid] || 0) + (review ? 0 : amount);
  const cur          = getCurrentWeek();
  const weeksCovered = Math.floor(after / WEEKLY_DUES);

  let weekApplied;
  if (review)                                                weekApplied = '';
  else if (opts.weekApplied != null && String(opts.weekApplied).length)
                                                            weekApplied = String(opts.weekApplied);
  else                                                       weekApplied = (weeksCovered > cur ? 'Prepay' : cur);

  const payer = (opts.payer != null && String(opts.payer).trim()) ? String(opts.payer).trim() : name;
  const split = opts.splitGroup ? String(opts.splitGroup) : '';

  sheet_(LEDGER_TAB).appendRow([
    nowStamp_(), rid, name, method, amount, weekApplied,
    payer, source, split, review ? REVIEW_BAD : REVIEW_GOOD
  ]);
}

/* ── Expenses (Feature 3) ────────────────────────────────────────────────── */
function getExpenses_(){
  const sh = sheet_(EXPENSES_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, EXPENSES_HEADERS.length).getValues();
  return vals.map((r, i) => ({
    row: i + 2,
    ts: r[EXP.TS - 1],
    pid: String(r[EXP.PID - 1]).trim(),
    vendor: String(r[EXP.VENDOR - 1]).trim(),
    item: String(r[EXP.ITEM - 1]).trim(),
    qty: Number(r[EXP.QTY - 1]) || 0,
    unit: Number(r[EXP.UNIT - 1]) || 0,
    line: Number(r[EXP.LINE - 1]) || 0,
    tax: Number(r[EXP.TAX - 1]) || 0,        // populated only on a group's first row
    total: Number(r[EXP.TOTAL - 1]) || 0,    // populated only on a group's first row
    url: String(r[EXP.URL - 1]).trim(),
    notes: String(r[EXP.NOTES - 1]).trim()
  }));
}
function purchaseExists_(pid){ return getExpenses_().some(e => e.pid === pid); }

/* Write all line items for one receipt. Tax + PurchaseTotal land on the FIRST
 * row of the group only, so summing those columns never double-counts. */
function appendExpenseRows_(pid, vendor, items, tax, total, url, notes){
  const sh = sheet_(EXPENSES_TAB);
  const ts = nowStamp_();
  const rows = items.map((it, idx) => ([
    ts, pid, vendor || 'Costco', it.name, it.qty, it.unit, it.line,
    idx === 0 ? tax   : '',          // tax  → first row only
    idx === 0 ? total : '',          // printed grand total → first row only
    url || '',
    idx === 0 ? (notes || '') : ''
  ]));
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, EXPENSES_HEADERS.length).setValues(rows);
}

/* Running kitty balance pieces. */
function collectedToDate_(){ let s = 0; getLedger_().forEach(e => { if (!e.review) s += e.amount; }); return round2_(s); }
function spentToDate_(){     let s = 0; getExpenses_().forEach(e => { s += e.total; });               return round2_(s); }

/* ── Derived per-recruit view (the heart of the dashboard) ───────────────── */
function recruitStatus_(){
  const cum = cumulativeMap_();
  const cur = getCurrentWeek();
  return activeRoster_().map(r => {
    const paid = cum[r.rid] || 0;
    const weeksCovered = Math.floor(paid / WEEKLY_DUES);
    return {
      rid: r.rid, name: r.name, email: r.email,
      paid: paid,
      weeksCovered: Math.min(weeksCovered, SEASON_WEEKS),
      paidThisWeek: paid >= cur * WEEKLY_DUES,           // covers prepay automatically
      owed: Math.max(0, cur * WEEKLY_DUES - paid)
    };
  });
}
function unpaidRecruits_(){ return recruitStatus_().filter(r => !r.paidThisWeek); }

/* ── Pause toggle ────────────────────────────────────────────────────────── */
function isPaused_(){ return PropertiesService.getScriptProperties().getProperty(PROP_PAUSED) === 'true'; }
function setPaused_(v){ PropertiesService.getScriptProperties().setProperty(PROP_PAUSED, v ? 'true' : 'false'); }

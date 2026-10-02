/*  ════════════════════════════════════════════════════════════════════════
 *  KITTY TRACKER — CONFIG
 *  ════════════════════════════════════════════════════════════════════════
 *  NOTHING IN THIS FILE NEEDS EDITING. Every academy-specific setting
 *  (academy name, kitty manager, Venmo, season start, weeks, dues) lives on
 *  the sheet's "Settings" tab and is filled in from the dashboard:
 *
 *      Kitty menu (in the Google Sheet) ▸ Settings
 *
 *  Until the settings are saved, the tracker stays switched off: no Venmo is
 *  credited and no reminder emails go out.
 *  ════════════════════════════════════════════════════════════════════════ */

/* The Settings tab: one row per setting. [key, label, default, help] */
const SETTINGS_TAB = 'Settings';
const SETTING_DEFS = [
  ['academyName',   'Academy name',            'PHX FD',  'Shown on the dashboard and in every email, e.g. "PHX FD".'],
  ['managerName',   'Kitty manager name',      '',        'The person collecting the money. Never credited as a payer.'],
  ['managerVenmo',  'Kitty manager Venmo',     '',        'The @handle everyone pays, e.g. @TonyJo77.'],
  ['managerEmail',  'Kitty manager email',     '',        'Gets a copy of spend reports. Blank = the Google account running the kitty.'],
  ['seasonStart',   'Week 1 starts',           '',        'The date week 1 begins (yyyy-mm-dd).'],
  ['seasonWeeks',   'Number of weeks',         15,        'How many weeks of dues.'],
  ['weeklyDues',    'Weekly dues ($)',         20,        'Dollars per recruit per week.'],
  ['votingSiteUrl', 'Home page site', 'https://forgedreams-ai.github.io/firehouse-snack-vote/', 'The public site with the "I\'m new here" sign-up and the snack vote. Leave blank to hide.']
];

/* Read the Settings tab (falls back to defaults for anything blank/missing).
 * Runs at the start of every execution, so a saved change applies on the
 * very next run — no redeploy needed. */
function readSettings_(){
  const out = {};
  SETTING_DEFS.forEach(d => { out[d[0]] = d[2]; });
  out.timezone = 'America/Phoenix';
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return out;
    out.timezone = ss.getSpreadsheetTimeZone() || out.timezone;
    const sh = ss.getSheetByName(SETTINGS_TAB);
    if (!sh || sh.getLastRow() < 2) return out;
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
      const key = String(r[0]).trim();
      const def = SETTING_DEFS.filter(d => d[0] === key)[0];
      if (!def) return;
      let v = r[1];
      if (v instanceof Date) v = Utilities.formatDate(v, out.timezone, 'yyyy-MM-dd');
      if (typeof def[2] === 'number'){ const n = Number(v); if (n > 0) out[key] = n; }
      else if (key === 'votingSiteUrl') out[key] = String(v == null ? '' : v).trim();   // blank = hidden
      else if (String(v == null ? '' : v).trim()) out[key] = String(v).trim();
    });
  } catch (e){ /* not bound to a sheet (tests, library use) — defaults */ }
  return out;
}
const SETTINGS = readSettings_();

/* Ready to run? Needs a manager, their Venmo and a valid start date. */
function isSetUp_(){
  return !!(SETTINGS.managerName && SETTINGS.managerVenmo &&
            /^\d{4}-\d{2}-\d{2}$/.test(String(SETTINGS.seasonStart)));
}

const ACADEMY_NAME     = SETTINGS.academyName;
const KITTY_TITLE      = ACADEMY_NAME + ' Kitty';
const COLLECTOR_NAME   = SETTINGS.managerName;
const COLLECTOR_VENMO  = SETTINGS.managerVenmo ? '@' + String(SETTINGS.managerVenmo).replace(/^@/, '') : '';
const COLLECTOR_EMAIL  = SETTINGS.managerEmail;
const SEASON_START     = SETTINGS.seasonStart;
const SEASON_WEEKS     = SETTINGS.seasonWeeks;
const WEEKLY_DUES      = SETTINGS.weeklyDues;
const TIMEZONE         = SETTINGS.timezone;
const VOTING_SITE_URL  = SETTINGS.votingSiteUrl;

/** Reminder emails: [weekday, hour, minute], 24h local time. Trim to soften. */
const REMINDER_SLOTS = [
  ['WEDNESDAY', 4, 30],
  ['THURSDAY',  4, 30], ['THURSDAY', 12, 0], ['THURSDAY', 15, 0],
  ['FRIDAY',    4, 30], ['FRIDAY',   12, 0], ['FRIDAY',   15, 0],
  ['FRIDAY',   17,  0], ['FRIDAY',   19, 0]
];


/* Derived season math. */
const TOTAL_PER_RECRUIT = WEEKLY_DUES * SEASON_WEEKS;
const WEEK_MS           = 7 * 24 * 60 * 60 * 1000;
// Season start at local midnight in TIMEZONE (offset read from the sheet's
// timezone, so no hard-coded -07:00 to get wrong next time).
function tzOffsetString_(){
  const s = Utilities.formatDate(new Date(), TIMEZONE, 'Z');       // e.g. "-0700"
  return s.slice(0, 3) + ':' + s.slice(3);                        // "-07:00"
}
// Not set up yet -> treat today as week 1 so the dashboard still renders.
const SEASON_START_MS = isSetUp_() ? Date.parse(SEASON_START + 'T00:00:00' + tzOffsetString_()) : Date.now();

/* Tabs. */
const ROSTER_TAB   = 'Roster';
const LEDGER_TAB   = 'Ledger';
const EXPENSES_TAB = 'Expenses';

/* Column positions (1-based) and headers. */
const ROS = { RID: 1, NAME: 2, EMAIL: 3, VENMO: 4, STATUS: 5, NOTES: 6, PHONE: 7, PAYSBY: 8 };
const ROSTER_HEADERS = ['RecruitID', 'FullName', 'Email', 'VenmoHandle', 'Status', 'Notes', 'Phone', 'PaysBy'];

const LED = { TS: 1, RID: 2, NAME: 3, METHOD: 4, AMOUNT: 5, WEEK: 6,
              PAYER: 7, SOURCE: 8, SPLIT: 9, REVIEW: 10, MEMO: 11 };
const LEDGER_HEADERS = ['Timestamp', 'RecruitID', 'FullName', 'Method', 'Amount', 'WeekApplied',
                        'PayerName', 'Source', 'SplitGroupID', 'Payment Status', 'Memo'];

const EXP = { TS: 1, PID: 2, VENDOR: 3, ITEM: 4, QTY: 5, UNIT: 6, LINE: 7, TAX: 8, TOTAL: 9, URL: 10, NOTES: 11 };
const EXPENSES_HEADERS = ['Timestamp', 'PurchaseID', 'Vendor', 'ItemName', 'Qty', 'UnitPrice',
                          'LineTotal', 'Tax', 'PurchaseTotal', 'ReceiptFileURL', 'Notes'];

/* Payments tab — the money that actually arrived, one row per real transaction.
 * NEVER edited by hand: it's the bank's record. The Ledger holds who each
 * payment was credited to, and must sum back to this. That's the reconciliation
 * check that catches every drift. */
const PAYMENTS_TAB = 'Payments';
const PAY = { ID: 1, DATE: 2, METHOD: 3, PAYER: 4, AMOUNT: 5, NOTE: 6, ALLOC: 7 };
const PAYMENTS_HEADERS = ['PaymentID', 'Date', 'Method', 'Payer', 'Amount', 'Note', 'Allocated'];

/* Aliases tab — nicknames people use in Venmo notes. "for rico" -> Ricardo
 * Garcia. Edit this instead of hand-fixing rows. */
const ALIASES_TAB = 'Aliases';
const ALIASES_HEADERS = ['Nickname', 'RosterFullName'];
// Each academy fills this tab in itself; it starts empty.
const DEFAULT_ALIASES = [];

/* Ledger "Payment Status" wording. Reads also understand legacy true/false.
 *   REVIEW_HAND      — a person decided this (assign, split, hand entry). The
 *                      automation never moves these rows again.
 *   REVIEW_DISMISSED — "not dues". The row stays (so the poller can't re-add the
 *                      payment) but credits nobody. */
const REVIEW_GOOD      = 'Payment Good!';
const REVIEW_BAD       = 'Payment Bad!';
const REVIEW_HAND      = 'Payment Good! (by hand)';
const REVIEW_DISMISSED = 'Dismissed';

/* Pay codes. Every recruit's code is their RecruitID (R012). A Venmo note of
 * "Kitty R012" credits R012 no matter whose account it came from; "Kitty R012
 * R015" splits it between them. Reminder emails carry a pay link with the
 * note pre-filled, so nobody has to remember the format. */
const PAY_NOTE_PREFIX = 'Kitty';

/* PaymentMethods tab — the ways recruits can pay. The kitty manager edits this
 * from the dashboard (⚙ Payment methods). Venmo and Cash are always present;
 * Venmo is the only one recorded automatically, the rest are logged by hand. */
const METHODS_TAB = 'PaymentMethods';
const METHODS_HEADERS = ['Method', 'SendTo', 'Instructions'];
const BUILTIN_METHODS = ['Venmo', 'Cash'];
const DEFAULT_METHODS = [
  ['Venmo', COLLECTOR_VENMO, 'Use the pay link in your reminder. Keep the note as-is.'],
  ['Cash',  '',              'Hand it to the kitty manager.']
];

/* Gmail / parsing. */
const VENMO_SENDER      = 'venmo@venmo.com';
const PROCESSED_LABEL   = 'KittyProcessed';   // informational only — never used to filter
const VENMO_LOOKBACK_D  = 45;                 // how far back the poller re-reads (dedupe makes this safe)
const GMAIL_POLL_MINUTES = 15;

/* Receipts. */
const RECEIPT_FOLDER_NAME = KITTY_TITLE + ' Receipts';
const REPORT_LOG_PREFIX   = 'RPT_';

/* Script properties. */
const PROP_PAUSED = 'KITTY_PAUSED';

/* Back-compat aliases (older code referenced these names). */
const VENMO_HANDLE = COLLECTOR_VENMO;

/*  ════════════════════════════════════════════════════════════════════════
 *  KITTY TRACKER — CONFIG
 *  ════════════════════════════════════════════════════════════════════════
 *  HANDING THIS OFF TO THE NEXT CLASS? Edit ONLY the SETTINGS block below,
 *  then run  setUpKitty()  once from the editor. Nothing else needs touching.
 *  ════════════════════════════════════════════════════════════════════════ */

// ─── SETTINGS — CHANGE THESE ───────────────────────────────────────────────

/** Who collects the money: their name EXACTLY as it appears on the Roster tab,
 *  and the Venmo handle recruits pay. The collector is never auto-credited —
 *  their name and handle are on every receipt, so any match on them is noise. */
const COLLECTOR_NAME   = 'Anthony Hidalgo';
const COLLECTOR_VENMO  = '@TonyJo77';
const COLLECTOR_EMAIL  = 'ant2242955@maricopa.edu';   // sends the reminder emails

/** The season. Start date is the Wednesday week 1 begins. */
const SEASON_START     = '2026-06-03';   // yyyy-mm-dd, local time
const SEASON_WEEKS     = 15;
const WEEKLY_DUES      = 20.00;
const TIMEZONE         = 'America/Phoenix';

/** Optional extras. Leave blank to disable. */
const VOTING_SITE_URL  = 'https://forgedreams-ai.github.io/firehouse-snack-vote/';

/** Reminder emails: [weekday, hour, minute], 24h local time. Trim to soften. */
const REMINDER_SLOTS = [
  ['WEDNESDAY', 4, 30],
  ['THURSDAY',  4, 30], ['THURSDAY', 12, 0], ['THURSDAY', 15, 0],
  ['FRIDAY',    4, 30], ['FRIDAY',   12, 0], ['FRIDAY',   15, 0],
  ['FRIDAY',   17,  0], ['FRIDAY',   19, 0]
];

// ─── END SETTINGS — you shouldn't need to edit below this line ─────────────


/* Derived season math. */
const TOTAL_PER_RECRUIT = WEEKLY_DUES * SEASON_WEEKS;
const WEEK_MS           = 7 * 24 * 60 * 60 * 1000;
// Season start at local midnight in TIMEZONE (offset read from the sheet's
// timezone, so no hard-coded -07:00 to get wrong next time).
function tzOffsetString_(){
  const s = Utilities.formatDate(new Date(), TIMEZONE, 'Z');       // e.g. "-0700"
  return s.slice(0, 3) + ':' + s.slice(3);                        // "-07:00"
}
const SEASON_START_MS = Date.parse(SEASON_START + 'T00:00:00' + tzOffsetString_());

/* Tabs. */
const ROSTER_TAB   = 'Roster';
const LEDGER_TAB   = 'Ledger';
const EXPENSES_TAB = 'Expenses';

/* Column positions (1-based) and headers. */
const ROS = { RID: 1, NAME: 2, EMAIL: 3, VENMO: 4, STATUS: 5, NOTES: 6 };
const ROSTER_HEADERS = ['RecruitID', 'FullName', 'Email', 'VenmoHandle', 'Status', 'Notes'];

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
// Seeded on first setup; edit the tab afterwards, not this list.
const DEFAULT_ALIASES = [
  ['rico',  'Ricardo Garcia'],
  ['will',  'William Kent Wickware II'],
  ['dev',   'Devyn O’Brien'],
  ['cj',    'Caswell Curry'],
  ['jake',  'Jacob Fretto']
];

/* Ledger "Payment Status" wording. Reads also understand legacy true/false. */
const REVIEW_GOOD = 'Payment Good!';
const REVIEW_BAD  = 'Payment Bad!';

/* Gmail / parsing. */
const VENMO_SENDER      = 'venmo@venmo.com';
const PROCESSED_LABEL   = 'KittyProcessed';   // informational only — never used to filter
const VENMO_LOOKBACK_D  = 45;                 // how far back the poller re-reads (dedupe makes this safe)
const GMAIL_POLL_MINUTES = 15;

/* Receipts. */
const RECEIPT_FOLDER_NAME = 'PHX FD Kitty Receipts';
const REPORT_LOG_PREFIX   = 'RPT_';

/* Script properties. */
const PROP_PAUSED = 'KITTY_PAUSED';

/* Back-compat aliases (older code referenced these names). */
const SENDER_GMAIL = COLLECTOR_EMAIL;
const VENMO_HANDLE = COLLECTOR_VENMO;
const RECRUIT_COUNT = 55;

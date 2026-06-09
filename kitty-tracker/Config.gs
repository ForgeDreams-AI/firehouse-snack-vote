/*  Phoenix FD Academy Kitty Tracker — Config.gs   (v2)
 *  ────────────────────────────────────────────────────────────────────────
 *  SWAP THESE, then you never touch them again:
 */
const SENDER_GMAIL    = 'ant2242955@maricopa.edu';                          // academy send-from Gmail (also the Venmo-to handle owner)
const VENMO_HANDLE    = '@TonyJo77';                                        // Venmo @handle recruits send dues to (shown in reminder emails)
const VOTING_SITE_URL = 'https://forgedreams-ai.github.io/firehouse-snack-vote/';  // snack-vote link dropped into the email footer

/* ── Locked spec — UNCHANGED from v1 (do not change) ─────────────────────── */
const RECRUIT_COUNT     = 55;
const WEEKLY_DUES       = 20.00;
const SEASON_WEEKS      = 15;
const TOTAL_PER_RECRUIT = WEEKLY_DUES * SEASON_WEEKS;   // 300.00
const TIMEZONE          = 'America/Phoenix';            // MST, UTC-7, no DST

/* Season starts Wed Jun 3 2026, local Phoenix midnight. Phoenix is UTC-7 all
 * year, so the fixed -07:00 offset is always correct. Week N runs from
 * (start + 7*(N-1) days) for 7 days; week 1 = Jun 3–9, week 15 = Sep 9–15. */
const SEASON_START_MS = new Date('2026-06-03T00:00:00-07:00').getTime();
const WEEK_MS         = 7 * 24 * 60 * 60 * 1000;

/* ── Tabs & columns ──────────────────────────────────────────────────────── */
const ROSTER_TAB   = 'Roster';
const LEDGER_TAB   = 'Ledger';
const EXPENSES_TAB = 'Expenses';                        // NEW in v2 (Feature 3)

// 1-based column numbers, for readable code.
const ROS = { RID: 1, NAME: 2, EMAIL: 3, VENMO: 4, STATUS: 5, NOTES: 6 };

/* v2 Ledger layout (10 cols). PayerName (G) and SplitGroupID (I) are new; this
 * pushes Source from G→H and the review flag from H→J versus v1. The automatic
 * migration in ensureSchema_() upgrades any existing v1 (8-col) Ledger in place. */
const LED = { TS: 1, RID: 2, NAME: 3, METHOD: 4, AMOUNT: 5, WEEK: 6, PAYER: 7, SOURCE: 8, SPLIT: 9, REVIEW: 10 };

const ROSTER_HEADERS = ['RecruitID', 'FullName', 'Email', 'VenmoHandle', 'Status', 'Notes'];
// Column J keeps the v1 "Payment Status" wording; it IS the ReviewFlag column.
const LEDGER_HEADERS = ['Timestamp', 'RecruitID', 'FullName', 'Method', 'Amount', 'WeekApplied',
                        'PayerName', 'Source', 'SplitGroupID', 'Payment Status'];

/* Expenses tab (Feature 3). Append-only, one row per line item.
 * Tax (H) + PurchaseTotal (I) are written ONCE per receipt, on the group's
 * FIRST row only (rest blank). That keeps "spent to date" a clean column sum
 * with no double-counting, while every item still lives on its own row. */
const EXP = { TS: 1, PID: 2, VENDOR: 3, ITEM: 4, QTY: 5, UNIT: 6, LINE: 7, TAX: 8, TOTAL: 9, URL: 10, NOTES: 11 };
const EXPENSES_HEADERS = ['Timestamp', 'PurchaseID', 'Vendor', 'ItemName', 'Qty', 'UnitPrice',
                          'LineTotal', 'Tax', 'PurchaseTotal', 'ReceiptFileURL', 'Notes'];

// ReviewFlag wording (column J). The read logic also understands legacy true/false.
const REVIEW_GOOD = 'Payment Good!';   // matched cleanly — counts toward the recruit
const REVIEW_BAD  = 'Payment Bad!';    // couldn't match — shows in the dashboard review queue

/* ── Gmail / parsing ─────────────────────────────────────────────────────── */
const VENMO_SENDER    = 'venmo@venmo.com';
const PROCESSED_LABEL = 'KittyProcessed';   // applied to Venmo emails we've recorded
const MAX_PREPAY      = TOTAL_PER_RECRUIT;  // payments over this -> review queue

/* ── Receipts / reporting (Feature 3) ────────────────────────────────────── */
const RECEIPT_FOLDER_NAME = 'PHX FD Kitty Receipts';   // Drive folder for uploaded receipt files
const REPORT_LOG_PREFIX   = 'RPT_';                     // script-property guard, one per PurchaseID (never double-report)

/* ── Script property keys ────────────────────────────────────────────────── */
const PROP_PAUSED = 'KITTY_PAUSED';         // 'true' / 'false'

/* ── Reminder schedule (America/Phoenix). [weekday, hour, minute] ──────────── *
 * Apps Script fires time triggers within ~15 min of the target, so 4:30 means
 * "sometime ~4:30–4:45". installTriggers() builds one trigger per entry; all
 * call sendRemindersNow(). Trim this list to soften the cadence. */
const REMINDER_SLOTS = [
  ['WEDNESDAY', 4, 30],
  ['THURSDAY',  4, 30], ['THURSDAY', 12, 0], ['THURSDAY', 15, 0],
  ['FRIDAY',    4, 30], ['FRIDAY',   12, 0], ['FRIDAY',   15, 0], ['FRIDAY', 17, 0], ['FRIDAY', 19, 0]
];
const GMAIL_POLL_MINUTES = 15;  // Venmo parser cadence.

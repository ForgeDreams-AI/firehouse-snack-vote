/*  Maintenance.gs — occasional admin tasks, kept in ONE place.
 *  ────────────────────────────────────────────────────────────────────────
 *  Day to day you don't need any of this: the 15-minute Venmo poller
 *  (parseVenmoInbox) and the dashboard do everything. These are the rare
 *  "something drifted, reset it" tools.
 *
 *  HOW CREDITING WORKS (so nothing here surprises you):
 *    • A Venmo receipt is credited to the person who SENT it (read from the
 *      "X paid you" subject) — never guessed from the note. That's what keeps
 *      dues off the wrong person.
 *    • "Paying for someone else" (one person covering others) shows up in the
 *      dashboard's Possible Splits panel — you split it there with one tap.
 *    • Every Venmo row is keyed by its Venmo transaction ID in the Source
 *      column, so re-imports never double-count.
 *
 *  REBUILDING THE LEDGER FROM A STATEMENT (the nuclear option):
 *    If the ledger ever gets tangled, the clean fix is to rebuild it from the
 *    Venmo statement CSV (the bank's own record):
 *      1. Download the statement from Venmo (Statement → export CSV).
 *      2. Generate a corrected Ledger from it offline, credited by sender +
 *         your Possible-Splits decisions, cash preserved.
 *      3. Ledger tab → File → Import → Replace current sheet.
 *      4. Run markVenmoProcessedThrough('yyyy/mm/dd') with the day AFTER the
 *         statement's last payment, so the poller won't re-add what you pasted.
 *    (Kept deliberately manual — a wipe-and-reload of live money should be a
 *    conscious act, not a one-click button.)                                   */

/* Label every Venmo "paid you" receipt received BEFORE `beforeYmd` as processed,
 * so the poller skips them and only ingests newer payments. Use this right after
 * pasting a rebuilt Ledger. `beforeYmd` is a Gmail date string, e.g. '2026/07/16'.
 * Defaults to today if omitted. */
function markVenmoProcessedThrough(beforeYmd){
  const cutoff = beforeYmd || Utilities.formatDate(new Date(), TIMEZONE, 'yyyy/MM/dd');
  const label  = getOrCreateLabel_(PROCESSED_LABEL);
  const threads = GmailApp.search(
    'from:' + VENMO_SENDER + ' (subject:("paid you") OR "paid you") before:' + cutoff, 0, 500);
  threads.forEach(t => t.addLabel(label));
  return 'Labeled ' + threads.length + ' Venmo thread(s) processed (before ' + cutoff +
         '). The poller will now only pick up payments dated ' + cutoff + ' onward.';
}

/* Re-scan recent Venmo receipts and fill in any that never made it into the
 * Ledger (e.g. the poller was off). Idempotent: a receipt already in the Ledger
 * (by transaction-ID Source OR a processed Gmail label) is skipped, so this can
 * never double-count. Credits the sender, exactly like the live poller. */
function catchUpVenmo(days){
  ensureSchema_();
  const win       = (days && days > 0) ? Math.floor(days) : 90;
  const label     = getOrCreateLabel_(PROCESSED_LABEL);
  const processed = processedSourceSet_();
  const roster    = activeRoster_();
  // Search by date, NOT by label — Gmail threads repeat receipts from the same
  // sender, so a label filter hides later payments in an already-seen thread.
  const threads   = GmailApp.search(
    'from:' + VENMO_SENDER + ' (subject:("paid you") OR "paid you") newer_than:' + win + 'd', 0, 300);

  let added = 0;
  threads.forEach(thread => {
    let touched = false;
    thread.getMessages().forEach(msg => {
      const id = msg.getId();
      if (processed[id]) { touched = true; return; }
      if (msg.getFrom().toLowerCase().indexOf('venmo') === -1) return;
      const parsed = extractVenmo_(msg.getSubject(), msg.getPlainBody());
      if (!parsed) return;
      const match     = matchRecruit_(parsed, roster);
      const confident = match && isWholeWeeks_(parsed.amount);
      appendPayment_(confident ? match.rid : '', confident ? match.name : '',
                     'Venmo', parsed.amount, id, !confident,
                     { payer: parsed.payer || 'Unknown', memo: parsed.memo });
      processed[id] = true; added++; touched = true;
    });
    if (touched) thread.addLabel(label);
  });
  return 'Caught up ' + added + ' previously-missed Venmo payment' + (added === 1 ? '' : 's') + '.';
}

/* REPAIR: re-credit Venmo rows wrongly credited to the collector.
 * Cause (fixed in matchRecruit_): Venmo receipts often contain the recipient's
 * own @handle, and handle-matching ran before sender-matching — so payments
 * landed on the collector. This walks the Ledger, finds every GOOD Venmo row
 * credited to COLLECTOR_NAME whose PayerName is somebody else, and re-points it
 * at the real sender (or flags it for review if the sender isn't on the roster).
 * Cash rows and rows where the collector genuinely paid are untouched.
 * Backs the Ledger up first. Safe to re-run. */
function fixCollectorCredits(){
  ensureSchema_();
  const ss = ss_(), led = sheet_(LEDGER_TAB);
  led.copyTo(ss).setName('Ledger_bak_' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd-HHmmss'));

  const norm = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const roster = activeRoster_();
  const collector = roster.filter(r => norm(r.name) === norm(COLLECTOR_NAME))[0];
  if (!collector) return 'Collector "' + COLLECTOR_NAME + '" not on the roster — nothing done.';

  const last = led.getLastRow();
  if (last < 2) return 'Ledger is empty.';
  const rng = led.getRange(2, 1, last - 1, LEDGER_HEADERS.length);
  const vals = rng.getValues();

  let fixed = 0, toReview = 0, moved = 0;
  vals.forEach(row => {
    if (String(row[LED.RID - 1]).trim() !== collector.rid) return;      // not credited to him
    if (String(row[LED.METHOD - 1]).trim() !== 'Venmo') return;          // leave his cash alone
    if (isReview_(row[LED.REVIEW - 1])) return;                          // already in review
    const payer = String(row[LED.PAYER - 1]).trim();
    if (!payer || norm(payer) === norm(COLLECTOR_NAME)) return;          // he really paid

    // Credit the actual sender (handle deliberately ignored — see matchRecruit_).
    const m = matchRecruit_({ payer: payer, amount: Number(row[LED.AMOUNT - 1]) || 0, handle: '', memo: '' }, roster);
    if (m){
      row[LED.RID - 1]  = m.rid;
      row[LED.NAME - 1] = m.name;
      fixed++;
    } else {
      row[LED.RID - 1]    = '';
      row[LED.NAME - 1]   = '';
      row[LED.WEEK - 1]   = '';
      row[LED.REVIEW - 1] = REVIEW_BAD;                                  // e.g. non-roster senders
      toReview++;
    }
    moved += Number(row[LED.AMOUNT - 1]) || 0;
  });

  rng.setValues(vals);
  return 'Repaired ' + (fixed + toReview) + ' row(s) worth $' + moved.toFixed(2) + ' off ' +
         COLLECTOR_NAME + ': ' + fixed + ' re-credited to the real sender, ' + toReview +
         ' sent to review. Backup tab created.';
}

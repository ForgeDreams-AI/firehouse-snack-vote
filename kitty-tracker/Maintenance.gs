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
function catchUpVenmo(){
  ensureSchema_();
  const label     = getOrCreateLabel_(PROCESSED_LABEL);
  const processed = processedSourceSet_();
  const roster    = activeRoster_();
  const threads   = GmailApp.search(
    'from:' + VENMO_SENDER + ' (subject:("paid you") OR "paid you") -label:' + PROCESSED_LABEL, 0, 100);

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

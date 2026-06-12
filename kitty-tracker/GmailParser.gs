/*  GmailParser.gs — time-driven Venmo receipt parser (every 15 min).   (v2)
 *  Idempotent: each Gmail message is recorded at most once (by message-ID in
 *  Ledger.Source AND a Gmail label so we don't even re-read it).
 *  v2: the Venmo SENDER always lands in PayerName (col G). FullName (col C) holds
 *  the credited recruit, left blank until matched/assigned. */

function parseVenmoInbox(){
  ensureSchema_();
  const label = getOrCreateLabel_(PROCESSED_LABEL);
  // Venmo "X paid you" receipts not yet processed.
  const query = 'from:' + VENMO_SENDER + ' (subject:("paid you") OR "paid you") -label:' + PROCESSED_LABEL;
  const threads = GmailApp.search(query, 0, 50);
  if (!threads.length) return;

  const roster = activeRoster_();
  const processed = processedSourceSet_();

  threads.forEach(thread => {
    let touched = false;
    thread.getMessages().forEach(msg => {
      const id = msg.getId();
      if (processed[id]) { touched = true; return; }          // already in Ledger
      if (msg.getFrom().toLowerCase().indexOf('venmo') === -1) return;

      const parsed = extractVenmo_(msg.getSubject(), msg.getPlainBody());
      if (!parsed) return;                                     // not a payment-received email

      const match = matchRecruit_(parsed, roster);
      const amountOk = isWholeWeeks_(parsed.amount);
      const confident = match && amountOk;

      appendPayment_(
        confident ? match.rid  : '',                           // RecruitID (credited)
        confident ? match.name : '',                           // FullName  (blank until matched/assigned)
        'Venmo',
        parsed.amount,
        id,                                                    // Source = message-ID (idempotency key)
        !confident,                                            // ReviewFlag
        { payer: parsed.payer || 'Unknown', memo: parsed.memo } // PayerName + Venmo note
      );
      processed[id] = true;
      touched = true;
    });
    if (touched) thread.addLabel(label);                       // stop re-reading this thread
  });
}

/* Pull payer name + amount out of a Venmo receipt.
 * Handles the common shapes: subject "Jane Doe paid you $20.00" and
 * body "Jane Doe paid you $20.00". Returns null if no amount found. */
function extractVenmo_(subject, body){
  subject = subject || '';
  body = body || '';
  const hay = subject + '\n' + body;

  const amtM = hay.match(/\$\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/);
  if (!amtM) return null;
  const amount = parseFloat(amtM[1].replace(/,/g, ''));
  if (!isFinite(amount)) return null;

  let payer = '';
  let m = subject.match(/^(.*?)\s+paid you/i) || hay.match(/(.*?)\s+paid you/i);
  if (m) payer = m[1].trim();
  if (!payer) { m = hay.match(/from\s+(.+)/i); if (m) payer = m[1].split('\n')[0].trim(); }

  // Venmo @handle if present in the body.
  let handle = '';
  const hM = hay.match(/@([A-Za-z0-9_-]{3,})/);
  if (hM) handle = hM[1].toLowerCase();

  // Venmo note (the message the payer typed). Venmo's plain-text emails lay it
  // out roughly as:
  //     <Sender> paid you
  //     $X.XX
  //     [image: venmo logo]          ← HTML→text alt-text junk
  //     <the note>                   ← this is what we want
  //     See transaction
  // so we scan a window after "paid you", skipping blanks, Venmo's section
  // headers, lines that are just a dollar amount, image alt text, and button text.
  const JUNK_PATTERNS = [
    /^(transfer|payment id|transaction|amount|date|note from|view|help|venmo|see transaction|money credited|view in app|reply|forward|©|unsubscribe|open in app|hi |hello |dear )/i,
    /^\$?\s*[\d,]+(\.\d{1,2})?\s*(usd)?\s*$/i,                  // bare amount line
    /^\[?\s*image\b/i,                                            // "image …", "[image: …]"
    /\b(logo|icon|avatar|button|profile photo|profile picture)\s*\]?\s*$/i,  // ends with logo/icon/etc
    /^\[\s*[a-z\s:]+\s*\]\s*$/i,                                  // pure bracketed alt text "[anything]"
  ];
  const isJunk = s => JUNK_PATTERNS.some(re => re.test(s));
  let memo = '';
  const lines = body.split(/\r?\n/).map(l => l.trim());
  for (let i = 0; i < lines.length - 1; i++){
    if (/paid you/i.test(lines[i])){
      for (let j = i + 1; j < Math.min(lines.length, i + 20); j++){
        let cand = lines[j];
        if (!cand) continue;
        if (isJunk(cand)) continue;
        cand = cand.replace(/^["“”'`]+|["“”'`]+$/g, '').trim();
        if (cand.length < 2 || cand.length > 280) continue;
        if (isJunk(cand)) continue;                               // re-check post-strip
        memo = cand; break;
      }
      if (memo) break;
    }
  }
  if (!memo){
    const noteM = body.match(/note\s*[:\-]\s*(.{1,280})/i);
    if (noteM) memo = noteM[1].split(/\r?\n/)[0].replace(/^["“”'`]+|["“”'`]+$/g, '').trim();
  }

  return { payer: payer, amount: amount, handle: handle, memo: memo };
}

// True when a stored memo cell looks like junk that should be replaced if the
// re-scan produces a real one (e.g. just "$40.00" or "image venmo logo" left
// over from an earlier buggy parse).
function looksBogusMemo_(s){
  s = String(s || '').trim();
  if (!s) return false;                                          // empty is fine
  if (/^\$?\s*[\d,]+(\.\d{1,2})?\s*(usd)?\s*$/i.test(s)) return true;     // pure amount
  if (/^\[?\s*image\b/i.test(s)) return true;                              // image alt
  if (/\b(logo|icon|avatar|button)\s*\]?\s*$/i.test(s)) return true;       // ends in logo etc
  if (/^\[\s*[a-z\s:]+\s*\]\s*$/i.test(s)) return true;                    // pure bracketed
  return false;
}

/* Debug helper: print what extractVenmo_ pulls from the latest 30 Venmo
 * "paid you" emails. Doesn't write to the sheet — just logs to Executions so
 * you can verify the memo extractor is grabbing the right line before running
 * backfillFromEmails(). Run from the editor: function dropdown → previewVenmoMemos. */
function previewVenmoMemos(){
  const query = 'from:' + VENMO_SENDER + ' (subject:("paid you") OR "paid you")';
  const threads = GmailApp.search(query, 0, 30);
  const out = [];
  threads.forEach(thread => {
    thread.getMessages().forEach(msg => {
      if (msg.getFrom().toLowerCase().indexOf('venmo') === -1) return;
      const parsed = extractVenmo_(msg.getSubject(), msg.getPlainBody());
      if (!parsed) return;
      out.push('$' + parsed.amount.toFixed(2) +
               '  from ' + (parsed.payer || '?') +
               '  memo: ' + (parsed.memo || '(none)'));
    });
  });
  const txt = out.length ? out.join('\n') : 'No Venmo emails found.';
  Logger.log(txt);
  return txt;
}

/* True when an amount is a clean whole-week prepay we can auto-credit: a positive
 * whole-number multiple of one week's dues ($20, $40, $60 …) that doesn't exceed
 * the full season total. Anything else — odd amounts ($30, $50, $70) or more than
 * the season total — returns false so the payment lands in the review queue. */
function isWholeWeeks_(amount){
  if (!(amount > 0) || amount > TOTAL_PER_RECRUIT) return false;
  const weeks = amount / WEEKLY_DUES;
  return Math.abs(weeks - Math.round(weeks)) < 0.005;   // clean multiple of WEEKLY_DUES
}

/* Match a parsed payment to a recruit.
 * The Venmo NOTE wins: when someone pays for someone else, the recipient's name
 * is in the note, not the sender. So we read the note first —
 *   • note clearly names exactly ONE recruit → credit that recruit
 *   • note names TWO+ recruits → no auto-match (let the review/split flow handle it)
 *   • note names no one clearly → fall through to sender matching below.
 * Sender matching (the "paying for self" path): handle, then exact normalized
 * name, then last-name + first-initial. Anything looser -> no match (review). */
function matchRecruit_(parsed, roster){
  // 0) Note wins. memoMentionsRecruits_ already enforces strict rules (full name,
  //    or a roster-unique first/last token ≥4 chars), so a single hit is safe to
  //    credit; multiple hits mean it's a split → send to review.
  if (parsed.memo){
    const mentioned = memoMentionsRecruits_(parsed.memo, roster);
    if (mentioned.length === 1) return recruitById_(mentioned[0].rid) || mentioned[0];
    if (mentioned.length > 1) return null;                       // names 2+ recruits → review/split
  }

  if (parsed.handle){
    const byH = roster.filter(r => r.venmo && r.venmo === parsed.handle)[0];
    if (byH) return byH;
  }
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const p = norm(parsed.payer);
  if (!p) return null;

  const exact = roster.filter(r => norm(r.name) === p)[0];
  if (exact) return exact;

  // last name + first initial (e.g., "j rivera" vs roster "Jose Rivera")
  const pParts = p.split(' ');
  if (pParts.length >= 2){
    const pFirst = pParts[0][0], pLast = pParts[pParts.length - 1];
    const cands = roster.filter(r => {
      const rp = norm(r.name).split(' ');
      if (rp.length < 2) return false;
      return rp[0][0] === pFirst && rp[rp.length - 1] === pLast;
    });
    if (cands.length === 1) return cands[0];  // only confident if unique
  }
  return null;
}

function getOrCreateLabel_(name){
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/* ── Email rerun / backfill (v2) ─────────────────────────────────────────── *
 * Re-reads the Venmo inbox INCLUDING already-processed receipts, to:
 *   (a) back-fill PayerName onto existing payment rows that predate v2 (and
 *       recover the sender from old unmatched rows that stored it in FullName), and
 *   (b) ingest any Venmo receipt that was never recorded (e.g. arrived while the
 *       script was paused/off).
 * Idempotent + non-destructive:
 *   • Rows are matched by Source = Gmail message-ID. An existing row is only
 *     touched to fill a BLANK PayerName — amounts, recruits, weeks, flags are
 *     never changed, so money cannot shift or double-count.
 *   • A receipt is only ADDED if its message-ID isn't already in the Ledger AND
 *     its thread was never processed (unlabeled). Already-processed threads only
 *     get PayerName backfill — never a second row.
 * Run it from setupKitty(), or on its own anytime. */
function backfillFromEmails(){
  ensureSchema_();
  const label = getOrCreateLabel_(PROCESSED_LABEL);
  // No "-label" filter here — we deliberately include processed receipts too.
  const query = 'from:' + VENMO_SENDER + ' (subject:("paid you") OR "paid you")';
  const threads = GmailApp.search(query, 0, 100);   // cap; raise if you have a longer history
  if (!threads.length) return 'Email rerun: no Venmo receipts found.';

  const roster = activeRoster_();
  const sh = sheet_(LEDGER_TAB);

  // message-ID -> existing ledger entry (for in-place PayerName fills).
  const bySource = {};
  getLedger_().forEach(e => { if (e.source) bySource[e.source] = e; });

  let scanned = 0, filled = 0, added = 0;
  threads.forEach(thread => {
    const processed = thread.getLabels().some(l => l.getName() === PROCESSED_LABEL);
    let touched = false;

    thread.getMessages().forEach(msg => {
      if (msg.getFrom().toLowerCase().indexOf('venmo') === -1) return;
      const parsed = extractVenmo_(msg.getSubject(), msg.getPlainBody());
      if (!parsed) return;
      scanned++;

      const id = msg.getId();
      const existing = bySource[id];

      if (existing){
        // Fill PayerName only when blank. For old unmatched rows the sender may
        // be sitting in FullName — recover it from there.
        if (!existing.payer){
          sh.getRange(existing.row, LED.PAYER).setValue(parsed.payer || existing.name || 'Unknown');
          existing.payer = parsed.payer || existing.name || 'Unknown';
          filled++;
        }
        // Backfill memo on existing rows that don't have one yet (e.g. rows
        // ingested before the Memo column existed). Also replace memos that
        // look like junk left over from a previous buggy parse (e.g. "$40.00").
        if (parsed.memo && (!existing.memo || looksBogusMemo_(existing.memo))){
          sh.getRange(existing.row, LED.MEMO).setValue(parsed.memo);
          existing.memo = parsed.memo;
          filled++;
        }
      } else if (!processed){
        // Truly missed (thread never processed) → record once, parser's own rules.
        const match = matchRecruit_(parsed, roster);
        const amountOk = isWholeWeeks_(parsed.amount);
        const confident = match && amountOk;
        appendPayment_(
          confident ? match.rid : '',
          confident ? match.name : '',
          'Venmo', parsed.amount, id, !confident,
          { payer: parsed.payer || 'Unknown', memo: parsed.memo }
        );
        bySource[id] = { row: -1, payer: parsed.payer || 'Unknown', name: '', memo: parsed.memo || '' };  // guard within this run
        added++;
      }
      // (processed thread + unknown message-ID → leave alone; don't risk a double.)
      touched = true;
    });

    if (touched && !processed) thread.addLabel(label);   // label newly-handled threads
  });

  return 'Email rerun: scanned ' + scanned + ' receipts · filled PayerName on ' + filled +
         ' rows · added ' + added + ' previously-missed payment' + (added === 1 ? '' : 's') + '.';
}

/* ── Reprocess recent Venmo under the CURRENT rules ──────────────────────────── *
 * One-shot maintenance: re-read the last N days of Venmo receipts and REBUILD
 * their ledger rows from scratch using today's crediting logic (note-wins
 * matching in matchRecruit_ + whole-week auto-credit in isWholeWeeks_). Use this
 * after changing the rules so older receipts get re-credited the new way.
 *
 * What it touches:
 *   • ONLY rows whose Source is the Gmail message-ID of a receipt in the window.
 *     Cash rows, dashboard/manual entries, and Venmo older than the window are
 *     left completely alone (their Source is 'Cash'/'Dashboard'/an older ID).
 *   • A receipt that had been hand-split into several rows collapses back to one
 *     row and is re-evaluated — the pre-existing split is preserved in the backup.
 *
 * Safety: snapshots the ENTIRE Ledger to a timestamped backup tab FIRST, so the
 * whole thing is reversible (delete Ledger, rename the backup back to "Ledger").
 * Deletes the old rows, THEN re-appends, so cumulative week math stays correct.
 *
 * Run from the editor: function dropdown → reprocessRecentVenmo (defaults to 14
 * days). Pass a number to change the window, e.g. reprocessRecentVenmo(30). */
function reprocessRecentVenmo(days){
  days = (days && days > 0) ? Math.floor(days) : 14;
  ensureSchema_();

  // 1) Back up the whole Ledger so this is fully reversible.
  const ss  = ss_();
  const led = sheet_(LEDGER_TAB);
  const backupName = 'Ledger_bak_' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd-HHmmss');
  led.copyTo(ss).setName(backupName);

  // 2) Pull the Venmo receipts in the window and parse each one.
  const query   = 'from:' + VENMO_SENDER + ' (subject:("paid you") OR "paid you") newer_than:' + days + 'd';
  const threads = GmailApp.search(query, 0, 200);
  const label   = getOrCreateLabel_(PROCESSED_LABEL);
  const roster  = activeRoster_();

  const windowIds = {};     // message-IDs of receipts in this window
  const toIngest  = [];     // [{ id, parsed }]
  threads.forEach(thread => {
    thread.getMessages().forEach(msg => {
      if (msg.getFrom().toLowerCase().indexOf('venmo') === -1) return;
      const parsed = extractVenmo_(msg.getSubject(), msg.getPlainBody());
      if (!parsed) return;
      const id = msg.getId();
      windowIds[id] = true;
      toIngest.push({ id: id, parsed: parsed });
    });
    if (!thread.getLabels().some(l => l.getName() === PROCESSED_LABEL)) thread.addLabel(label);
  });

  // 3) Remove the existing email-derived rows for these receipts (bottom-up so
  //    row numbers don't shift mid-delete). Everything else is untouched.
  const rowsToDelete = getLedger_()
    .filter(e => e.source && windowIds[e.source])
    .map(e => e.row)
    .sort((a, b) => b - a);
  rowsToDelete.forEach(r => led.deleteRow(r));

  // 4) Re-ingest each receipt under the current rules.
  let credited = 0, review = 0;
  toIngest.forEach(item => {
    const parsed    = item.parsed;
    const match     = matchRecruit_(parsed, roster);
    const amountOk  = isWholeWeeks_(parsed.amount);
    const confident = match && amountOk;
    appendPayment_(
      confident ? match.rid  : '',
      confident ? match.name : '',
      'Venmo', parsed.amount, item.id, !confident,
      { payer: parsed.payer || 'Unknown', memo: parsed.memo }
    );
    if (confident) credited++; else review++;
  });

  return 'Reprocessed Venmo (last ' + days + ' days): backed up to tab "' + backupName + '" · ' +
         'removed ' + rowsToDelete.length + ' old Venmo row' + (rowsToDelete.length === 1 ? '' : 's') + ' · ' +
         're-added ' + toIngest.length + ' (' + credited + ' auto-credited, ' + review + ' to review). ' +
         'Cash and manual entries untouched.';
}

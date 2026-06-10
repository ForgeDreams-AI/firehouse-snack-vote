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
      const amountOk = parsed.amount > 0 && parsed.amount <= MAX_PREPAY;
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

  // Venmo note (the message the payer typed). Venmo plain-text bodies usually
  // put the note on the line right after "<Sender> paid you $X.XX", often wrapped
  // in straight or smart quotes. Fall back to any "Note:" labelled line.
  let memo = '';
  const lines = body.split(/\r?\n/).map(l => l.trim());
  for (let i = 0; i < lines.length - 1; i++){
    if (/paid you/i.test(lines[i])){
      // scan the next few lines for the first plausible note, skipping blanks
      // and Venmo's own section headers ("Transfer Date", "Payment ID", etc.).
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j++){
        let cand = lines[j];
        if (!cand) continue;
        if (/^(transfer|payment id|transaction|amount|date|note from|view|help|venmo)/i.test(cand)) continue;
        cand = cand.replace(/^["“”'`]+|["“”'`]+$/g, '').trim();
        if (cand && cand.length <= 280){ memo = cand; break; }
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

/* Match a parsed payment to a recruit. Handle first, then exact normalized
 * name, then last-name + first-initial. Anything looser -> no match (review). */
function matchRecruit_(parsed, roster){
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
        // ingested before the Memo column existed). Never overwrites.
        if (parsed.memo && !existing.memo){
          sh.getRange(existing.row, LED.MEMO).setValue(parsed.memo);
          existing.memo = parsed.memo;
          filled++;
        }
      } else if (!processed){
        // Truly missed (thread never processed) → record once, parser's own rules.
        const match = matchRecruit_(parsed, roster);
        const amountOk = parsed.amount > 0 && parsed.amount <= MAX_PREPAY;
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

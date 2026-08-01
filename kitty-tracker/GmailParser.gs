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
    /paid you/i,                                                 // the "<Sender> paid you $X" headline — Venmo repeats it as a line; never the note
    /^\$?\s*[\d,]+(\.\d{1,2})?\s*(usd)?\s*$/i,                  // bare amount line
    /^\[?\s*image\b/i,                                            // "image …", "[image: …]"
    /\b(logo|icon|avatar|button|profile photo|profile picture)\s*\]?\s*$/i,  // ends with logo/icon/etc
    /^\[\s*[a-z\s:]+\s*\]\s*$/i,                                  // pure bracketed alt text "[anything]"
  ];
  const isJunk = s => JUNK_PATTERNS.some(re => re.test(s));
  // The collector (payment recipient) appears in every receipt email — a line
  // that's just their name is layout noise, never the note. Skipping it is what
  // keeps a bad parse from mass-crediting the collector.
  const normName = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const isCollectorLine = s => normName(s) === normName(COLLECTOR_NAME);
  let memo = '';
  const lines = body.split(/\r?\n/).map(l => l.trim());
  for (let i = 0; i < lines.length - 1; i++){
    if (/paid you/i.test(lines[i])){
      for (let j = i + 1; j < Math.min(lines.length, i + 20); j++){
        let cand = lines[j];
        if (!cand) continue;
        if (isJunk(cand)) continue;
        if (isCollectorLine(cand)) continue;                      // recipient-name line, not the note
        cand = cand.replace(/^["“”'`]+|["“”'`]+$/g, '').trim();
        if (cand.length < 2 || cand.length > 280) continue;
        if (isJunk(cand)) continue;                               // re-check post-strip
        if (isCollectorLine(cand)) continue;
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
  if (/paid you/i.test(s)) return true;                                    // "<Sender> paid you" headline grabbed by mistake
  if (/^\[?\s*image\b/i.test(s)) return true;                              // image alt
  if (/\b(logo|icon|avatar|button)\s*\]?\s*$/i.test(s)) return true;       // ends in logo etc
  if (/^\[\s*[a-z\s:]+\s*\]\s*$/i.test(s)) return true;                    // pure bracketed
  return false;
}

/* Debug helper: print what extractVenmo_ pulls from the latest 30 Venmo
 * "paid you" emails. Doesn't write to the sheet — just logs to Executions so
 * you can sanity-check the parser. Run from the editor: previewVenmoMemos. */
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

/* Match a parsed payment to a recruit — by the SENDER, never the note.
 * Venmo's note is scraped from HTML email bodies unreliably, and note-based
 * crediting mass-mis-credited dues to whoever's name the parser happened to
 * grab. So we credit the person who actually SENT the money (reliably parsed
 * from the "X paid you" subject): handle, then exact normalized name, then
 * last-name + first-initial. Anything looser -> no match (review). Paying for
 * someone else is surfaced by the Possible Splits panel for manual reassignment;
 * it is NEVER auto-credited here. */
function matchRecruit_(parsed, roster){
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  // Guard: the collector (Anthony) is the RECIPIENT of every receipt. If the
  // parser ever resolves the sender to him, that's a mis-read — send it to
  // review, never auto-credit him. (He's paid up via cash/manual anyway.)
  const collector = norm(COLLECTOR_NAME);
  const notCollector = r => (r && norm(r.name) !== collector) ? r : null;

  // Handle lookup. NOTE: Venmo receipts frequently contain the RECIPIENT's
  // handle (@TonyJo77) in the body, and extractVenmo_ grabs the first @handle
  // it sees — so a handle hit on the collector means we grabbed his, not the
  // sender's. Ignore it and fall through to sender-name matching below.
  if (parsed.handle){
    const byH = roster.filter(r => r.venmo && r.venmo === parsed.handle)[0];
    if (byH && norm(byH.name) !== collector) return byH;
  }
  const p = norm(parsed.payer);
  if (!p) return null;

  const exact = roster.filter(r => norm(r.name) === p)[0];
  if (exact) return notCollector(exact);

  // last name + first initial (e.g., "j rivera" vs roster "Jose Rivera")
  const pParts = p.split(' ');
  if (pParts.length >= 2){
    const pFirst = pParts[0][0], pLast = pParts[pParts.length - 1];
    const cands = roster.filter(r => {
      const rp = norm(r.name).split(' ');
      if (rp.length < 2) return false;
      return rp[0][0] === pFirst && rp[rp.length - 1] === pLast;
    });
    if (cands.length === 1) return notCollector(cands[0]);  // only confident if unique
  }
  return null;
}

function getOrCreateLabel_(name){
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

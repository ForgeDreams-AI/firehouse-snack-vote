/*  Venmo.gs — reads Venmo receipts from Gmail and credits them.
 *  ────────────────────────────────────────────────────────────────────────
 *  THE RULES, in one place:
 *
 *  1. A PAY CODE in the note wins: "Kitty R012" credits R012, "Kitty R012
 *     R015" splits it between them — whoever's account it came from. Codes
 *     are exact IDs, so they can't be mis-read the way names were.
 *     Without a code, the payment is credited to the person who SENT it,
 *     read from the "<Name> paid you" subject line. Names typed in the note
 *     never decide credit here (they surface in Possible Splits instead).
 *
 *  2. The COLLECTOR is never auto-credited. Their name and @handle appear in
 *     every receipt (they're the recipient), so any match on them is noise.
 *
 *  3. Only clean whole-week amounts auto-credit ($20, $40 … up to the season
 *     total). Anything else waits in the dashboard's review queue.
 *
 *  4. Every payment carries its REAL payment date and a fingerprint
 *     (date + payer + amount). Both the poller and a statement import build
 *     the same fingerprint, so the same payment can never be recorded twice —
 *     no matter which path it arrives through. Fingerprints are COUNTED, so
 *     two genuine $20s from one person on one day are both kept.
 *
 *  5. Every payment also lands on the Payments tab, so the books reconcile.
 *
 *  Nothing here needs editing to hand the tracker to a new class; see Config. */


/* Time-driven entry point (every GMAIL_POLL_MINUTES). */
function parseVenmoInbox(){
  ensureSchema_();
  const roster  = activeRoster_();
  const aliases = getAliases_();
  const seen    = paymentFingerprints_();      // dedupe across ALL ingest paths (counts)
  const thisRun = {};
  const label   = getOrCreateLabel_(PROCESSED_LABEL);

  /* Search by DATE, never by "-label:processed". Gmail threads repeat receipts
   * from the same sender into ONE conversation, so filtering out labeled
   * threads hid every later payment in them. Re-reading is free: the
   * fingerprint check below is what prevents duplicates. */
  const threads = GmailApp.search(
    'from:' + VENMO_SENDER + ' (subject:("paid you") OR "paid you") newer_than:' + VENMO_LOOKBACK_D + 'd',
    0, 150);

  let added = 0;
  threads.forEach(thread => {
    thread.getMessages().forEach(msg => {
      if (msg.getFrom().toLowerCase().indexOf('venmo') === -1) return;
      const parsed = extractVenmo_(msg.getSubject(), msg.getPlainBody());
      if (!parsed) return;

      const when = msg.getDate();                       // REAL payment time
      const fp   = paymentFingerprint_(when, parsed.payer, parsed.amount);
      // The Nth receipt with this fingerprint is new only if the Ledger holds
      // fewer than N — so a second real $20 the same day isn't swallowed.
      thisRun[fp] = (thisRun[fp] || 0) + 1;
      if (thisRun[fp] <= (seen[fp] || 0)) return;      // already recorded

      creditPayment_(parsed, roster, aliases, msg.getId(), when);
      seen[fp] = thisRun[fp];
      added++;
    });
    thread.addLabel(label);                             // informational only
  });
  return added;
}


/* Write one parsed payment to Payments + Ledger, credited per the rules above. */
function creditPayment_(parsed, roster, aliases, sourceId, when){
  const stamp = Utilities.formatDate(when, TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  const payer = parsed.payer || 'Unknown';
  let parts = allocatePayment_(
    { payer: parsed.payer, amount: parsed.amount, note: parsed.memo, codeText: parsed.kittyLine },
    roster, aliases, { names: false });
  // A sender matched by @handle (allocatePayment_ only sees the name).
  if (!parts.length){
    const match = matchSender_(parsed, roster);
    if (match && isWholeWeeks_(parsed.amount)) parts = [{ rid: match.rid, name: match.name, amount: parsed.amount }];
  }

  appendPaymentRecord_(sourceId, stamp, 'Venmo', payer, parsed.amount, parsed.memo,
                       parts.length ? parts.map(p => p.name).join(', ') : 'NEEDS REVIEW');

  if (!parts.length){                                    // -> review queue
    appendPayment_('', '', 'Venmo', parsed.amount, sourceId, true,
                   { payer: payer, memo: parsed.memo, ts: stamp });
    return;
  }
  const group = parts.length > 1 ? nextSplitGroupId_() : '';
  parts.forEach(p => appendPayment_(p.rid, p.name, 'Venmo', p.amount, sourceId, false,
                                    { payer: payer, memo: parsed.memo, ts: stamp, splitGroup: group }));
}


/* ── Matching ─────────────────────────────────────────────────────────────
 * Sender only. Tries the Venmo @handle, then an exact name, then
 * last-name + first-initial. The collector is excluded from every path. */
function matchSender_(parsed, roster){
  const collector = normName_(COLLECTOR_NAME);

  // @handle. NOTE: receipts often contain the RECIPIENT's handle, and the
  // parser grabs the first one it sees — so a hit on the collector means we
  // grabbed theirs. Ignore it and fall through to the sender's name.
  if (parsed.handle){
    const byHandle = roster.filter(r => r.venmo && r.venmo === parsed.handle)[0];
    if (byHandle && normName_(byHandle.name) !== collector) return byHandle;
  }

  const p = normName_(parsed.payer);
  if (!p || p === collector) return null;

  const exact = roster.filter(r => normName_(r.name) === p)[0];
  if (exact) return exact;

  const parts = p.split(' ');
  if (parts.length >= 2){
    const initial = parts[0][0], last = parts[parts.length - 1];
    const cands = roster.filter(r => {
      const rp = normName_(r.name).split(' ');
      return rp.length >= 2 && rp[0][0] === initial && rp[rp.length - 1] === last;
    });
    if (cands.length === 1 && normName_(cands[0].name) !== collector) return cands[0];
  }
  return null;
}

// Back-compat name used elsewhere.
function matchRecruit_(parsed, roster){ return matchSender_(parsed, roster); }

function normName_(s){
  return String(s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

/* Clean whole-week amount we're willing to auto-credit. */
function isWholeWeeks_(amount){
  if (!(amount > 0) || amount > TOTAL_PER_RECRUIT) return false;
  const weeks = amount / WEEKLY_DUES;
  return Math.abs(weeks - Math.round(weeks)) < 0.005;
}


/* ── Dedupe ───────────────────────────────────────────────────────────────
 * One payment = one (date, payer, amount). Source IDs can't be used for this:
 * Gmail message-IDs and Venmo transaction-IDs are different ID spaces, so the
 * same payment arriving by both routes looked like two payments. */
function paymentFingerprint_(when, payer, amount){
  const d = (when instanceof Date) ? when : new Date(when);
  const day = isNaN(d.getTime()) ? '?' : Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
  return day + '|' + normName_(payer) + '|' + Number(amount).toFixed(2);
}

/* How many Venmo payments in the Ledger carry each fingerprint. Split rows
 * share one original payment, so they're folded back to the group total first.
 * Review and Dismissed rows count too — they're payments that arrived. */
function paymentFingerprints_(){
  const groups = {}, out = {};
  getLedger_().forEach(e => {
    if (e.method !== 'Venmo') return;
    const key = (e.splitGroup ? 'g:' + e.splitGroup : 's:' + e.source + '|' + e.row);
    if (!groups[key]) groups[key] = { ts: e.ts, payer: e.payer, amount: 0 };
    groups[key].amount += e.amount;
  });
  Object.keys(groups).forEach(k => {
    const g = groups[k];
    const fp = paymentFingerprint_(g.ts, g.payer, g.amount);
    out[fp] = (out[fp] || 0) + 1;
  });
  return out;
}


/* ── Parsing ──────────────────────────────────────────────────────────────
 * Pulls payer, amount, @handle and the typed note out of a receipt. */
function extractVenmo_(subject, body){
  subject = subject || ''; body = body || '';
  const hay = subject + '\n' + body;

  const amtM = hay.match(/\$\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/);
  if (!amtM) return null;
  const amount = parseFloat(amtM[1].replace(/,/g, ''));
  if (!isFinite(amount)) return null;

  let payer = '';
  let m = subject.match(/^(.*?)\s+paid you/i) || hay.match(/(.*?)\s+paid you/i);
  if (m) payer = m[1].trim();
  if (!payer){ m = hay.match(/from\s+(.+)/i); if (m) payer = m[1].split('\n')[0].trim(); }

  let handle = '';
  const hM = hay.match(/@([A-Za-z0-9_-]{3,})/);
  if (hM) handle = hM[1].toLowerCase();

  // Any line mentioning the kitty — where a pay code lives even when the
  // note extractor picks the wrong line.
  const kittyLine = String(body).split(/\r?\n/)
    .filter(l => new RegExp('\\b' + PAY_NOTE_PREFIX + '\\b', 'i').test(l)).join(' ');

  return { payer: payer, amount: amount, handle: handle, memo: extractNote_(body), kittyLine: kittyLine };
}

/* The note the payer typed. Venmo's plain-text emails bury it among headers,
 * image alt-text and the "<Sender> paid you" headline, so we skip known junk
 * and the collector's own name (which appears as the recipient). */
function extractNote_(body){
  const JUNK = [
    /^(transfer|payment id|transaction|amount|date|note from|view|help|venmo|see transaction|money credited|view in app|reply|forward|©|unsubscribe|open in app|hi |hello |dear )/i,
    /paid you/i,                                      // the headline, never the note
    /^\$?\s*[\d,]+(\.\d{1,2})?\s*(usd)?\s*$/i,        // a bare amount
    /^\[?\s*image\b/i,
    /\b(logo|icon|avatar|button|profile photo|profile picture)\s*\]?\s*$/i,
    /^\[\s*[a-z\s:]+\s*\]\s*$/i
  ];
  const collector = normName_(COLLECTOR_NAME);
  const junk = s => JUNK.some(re => re.test(s)) || normName_(s) === collector;

  const lines = String(body).split(/\r?\n/).map(l => l.trim());
  for (let i = 0; i < lines.length - 1; i++){
    if (!/paid you/i.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 20); j++){
      let cand = lines[j];
      if (!cand || junk(cand)) continue;
      cand = cand.replace(/^["“”'`]+|["“”'`]+$/g, '').trim();
      if (cand.length < 2 || cand.length > 280 || junk(cand)) continue;
      return cand;
    }
  }
  const noteM = String(body).match(/note\s*[:\-]\s*(.{1,280})/i);
  if (noteM) return noteM[1].split(/\r?\n/)[0].replace(/^["“”'`]+|["“”'`]+$/g, '').trim();
  return '';
}

function getOrCreateLabel_(name){
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/* Debug: log what the parser sees, without writing anything. */
function previewVenmoParsing(){
  const threads = GmailApp.search(
    'from:' + VENMO_SENDER + ' (subject:("paid you") OR "paid you") newer_than:14d', 0, 30);
  const roster = activeRoster_(), aliases = getAliases_(), out = [];
  threads.forEach(t => t.getMessages().forEach(msg => {
    if (msg.getFrom().toLowerCase().indexOf('venmo') === -1) return;
    const p = extractVenmo_(msg.getSubject(), msg.getPlainBody());
    if (!p) return;
    let parts = allocatePayment_({ payer: p.payer, amount: p.amount, note: p.memo, codeText: p.kittyLine },
                                 roster, aliases, { names: false });
    const m = matchSender_(p, roster);
    if (!parts.length && m && isWholeWeeks_(p.amount)) parts = [{ name: m.name }];
    out.push(Utilities.formatDate(msg.getDate(), TIMEZONE, 'MM/dd') +
             '  $' + p.amount.toFixed(2) + '  from ' + (p.payer || '?') +
             '  -> ' + (parts.length ? parts.map(x => x.name).join(' + ') : 'REVIEW') +
             '   note: ' + (p.memo || '(none)'));
  }));
  const txt = out.length ? out.join('\n') : 'No Venmo receipts in the last 14 days.';
  Logger.log(txt);
  return txt;
}

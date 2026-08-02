/*  Venmo.gs — reads Venmo receipts from Gmail and credits them.
 *  ────────────────────────────────────────────────────────────────────────
 *  THE RULES, in one place:
 *
 *  1. A payment is credited to the person who SENT it. The sender comes from
 *     the "<Name> paid you" subject line, which is the only reliable field in
 *     a Venmo email. The typed note is recorded but NEVER decides who gets
 *     credit — note-based crediting is what put dues on the wrong people.
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
 *     no matter which path it arrives through.
 *
 *  Nothing here needs editing to hand the tracker to a new class; see Config. */


/* Time-driven entry point (every GMAIL_POLL_MINUTES). */
function parseVenmoInbox(){
  ensureSchema_();
  const roster = activeRoster_();
  const seen   = paymentFingerprints_();       // dedupe across ALL ingest paths
  const label  = getOrCreateLabel_(PROCESSED_LABEL);

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
      if (seen[fp]) return;                             // already recorded

      creditPayment_(parsed, roster, msg.getId(), when);
      seen[fp] = true;
      added++;
    });
    thread.addLabel(label);                             // informational only
  });
  return added;
}


/* Write one parsed payment to the Ledger, credited per the rules above. */
function creditPayment_(parsed, roster, sourceId, when){
  const match     = matchSender_(parsed, roster);
  const confident = match && isWholeWeeks_(parsed.amount);
  appendPayment_(
    confident ? match.rid  : '',
    confident ? match.name : '',
    'Venmo',
    parsed.amount,
    sourceId,
    !confident,                                          // -> review queue
    { payer: parsed.payer || 'Unknown',
      memo:  parsed.memo,
      ts:    Utilities.formatDate(when, TIMEZONE, 'yyyy-MM-dd HH:mm:ss') }
  );
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

/* Fingerprints of every Venmo payment already in the Ledger. Split rows share
 * one original payment, so they're folded back to the group total first. */
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
    out[paymentFingerprint_(g.ts, g.payer, g.amount)] = true;
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

  return { payer: payer, amount: amount, handle: handle, memo: extractNote_(body) };
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
  const roster = activeRoster_(), out = [];
  threads.forEach(t => t.getMessages().forEach(msg => {
    if (msg.getFrom().toLowerCase().indexOf('venmo') === -1) return;
    const p = extractVenmo_(msg.getSubject(), msg.getPlainBody());
    if (!p) return;
    const m = matchSender_(p, roster);
    out.push(Utilities.formatDate(msg.getDate(), TIMEZONE, 'MM/dd') +
             '  $' + p.amount.toFixed(2) + '  from ' + (p.payer || '?') +
             '  -> ' + (m && isWholeWeeks_(p.amount) ? m.name : 'REVIEW') +
             '   note: ' + (p.memo || '(none)'));
  }));
  const txt = out.length ? out.join('\n') : 'No Venmo receipts in the last 14 days.';
  Logger.log(txt);
  return txt;
}

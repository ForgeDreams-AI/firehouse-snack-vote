/*  WebApp.gs — serves the dashboard and handles its google.script.run calls. (v2) */

function doGet(){
  ensureSchema_();   // create/upgrade tabs before anything reads them
  return HtmlService.createHtmlOutputFromFile('dashboard')
    .setTitle('PHX FD Kitty')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* Everything the dashboard needs in one round-trip. */
function getDashboardData(){
  ensureSchema_();
  const week = getCurrentWeek();
  const active = activeRoster_().length;
  const rows = recruitStatus_().sort((a, b) => a.name.localeCompare(b.name));
  const ledger = getLedger_();

  // Money In: split by method across the whole ledger (review rows excluded).
  let cashIn = 0, venmoIn = 0;
  ledger.forEach(e => {
    if (e.review) return;
    if (e.method === 'Venmo') venmoIn += e.amount; else cashIn += e.amount;
  });
  const collected = round2_(cashIn + venmoIn);
  const expected  = active * week * WEEKLY_DUES;
  const spent     = spentToDate_();
  const balance   = round2_(collected - spent);

  // Per-recruit totals split by method (Cash vs Venmo), review rows excluded.
  const methodMap = {};
  ledger.forEach(e => {
    if (e.review || !e.rid) return;
    const m = methodMap[e.rid] || (methodMap[e.rid] = {});
    const key = e.method || 'Other';
    m[key] = (m[key] || 0) + e.amount;
  });

  // Review queue — now carries the Venmo sender (payer) + amount so the split UI
  // knows the received total to reconcile against.
  const review = ledger.filter(e => e.review).map(e => ({
    row: e.row, name: e.name, payer: e.payer || e.name, amount: e.amount,
    method: e.method, source: e.source
  }));

  // Recent payments log (newest first) — spot a Venmo that covered two people
  // (shared SplitGroupID) or one that came from someone else (payer ≠ name).
  const recent = ledger.slice().reverse().slice(0, 20).map(e => ({
    ts: (e.ts instanceof Date ? e.ts.getTime() : Number(e.ts)||0), name: e.name || 'Unknown', payer: e.payer || e.name,
    method: e.method, amount: e.amount, split: e.splitGroup, review: e.review
  }));

  return {
    week: week, seasonWeeks: SEASON_WEEKS, closed: seasonClosed(),
    paused: isPaused_(),
    activeCount: active,
    paidCount: rows.filter(r => r.paidThisWeek).length,
    unpaidCount: rows.filter(r => !r.paidThisWeek).length,
    collected: collected, expected: expected,
    weeklyDues: WEEKLY_DUES, seasonTotal: TOTAL_PER_RECRUIT,
    moneyIn: { cash: round2_(cashIn), venmo: round2_(venmoIn), total: collected },
    kitty:   { collected: collected, spent: spent, balance: balance },
    rows: rows.map(r => {
      const paid = r.paid;
      const rawWeeks = Math.floor(paid / WEEKLY_DUES);
      const owed = Math.max(0, week * WEEKLY_DUES - paid);
      const mm = methodMap[r.rid] || {};
      let kind, label;
      if (paid > TOTAL_PER_RECRUIT){
        kind = 'over';  label = 'Over by $' + (paid - TOTAL_PER_RECRUIT).toFixed(2);
      } else if (paid >= TOTAL_PER_RECRUIT){
        kind = 'full';  label = 'Paid in full';
      } else if (paid >= week * WEEKLY_DUES){
        const ahead = rawWeeks - week;
        kind  = ahead > 0 ? 'ahead' : 'current';
        label = ahead > 0 ? ('Ahead ' + ahead + ' wk' + (ahead === 1 ? '' : 's')) : 'Current';
      } else {
        const late = week - rawWeeks;
        kind  = 'late';
        label = 'Late ' + late + ' wk' + (late === 1 ? '' : 's') + ' · $' + owed.toFixed(2) + ' owed';
      }
      return {
        rid: r.rid, name: r.name,
        paidThisWeek: r.paidThisWeek,
        paid: paid,
        weeksCovered: r.weeksCovered,                 // drives greyed weeks in the picker
        cash: mm['Cash'] || 0, venmo: mm['Venmo'] || 0,
        statusKind: kind, status: label
      };
    }),
    review: review,
    recent: recent,
    roster: activeRoster_().map(r => ({ rid: r.rid, name: r.name }))  // for assignment + manual logging
  };
}

/* ── Per-row / manual payment actions ────────────────────────────────────── */

// Back-compat: one week of cash at the current week.
function markCashPaidWeb(rid){ return logPaymentWeb(rid, 'Cash', WEEKLY_DUES); }

/* Single-row logger: method = 'Cash' | 'Venmo', amount in dollars.
 * payer defaults to the recruit (pass a different name for "someone else paid").
 * weekApplied is optional free text ("Prepay", "5", "5,6,7"). */
function logPaymentWeb(rid, method, amount, payer, weekApplied){
  const r = recruitById_(rid);
  if (!r) return { ok: false, msg: 'Recruit not found.' };
  amount = round2_(amount);
  if (!(amount > 0)) return { ok: false, msg: 'Enter an amount greater than $0.' };
  method = (String(method) === 'Venmo') ? 'Venmo' : 'Cash';
  payer  = String(payer || '').trim() || r.name;
  appendPayment_(rid, r.name, method, amount, 'Dashboard', false,
                 { payer: payer, weekApplied: (weekApplied != null && String(weekApplied).length) ? weekApplied : undefined });
  return { ok: true, msg: 'Logged $' + amount.toFixed(2) + ' ' + method + ' for ' + r.name +
           (payer !== r.name ? ' (paid by ' + payer + ')' : '') + '.' };
}

/* Week-picker write (Feature 2): one Ledger row PER selected week.
 *   weeks         = array of week numbers (1–15)
 *   customAmount  = optional total to distribute across the weeks (else $20/wk)
 *   payer         = optional ("someone else paid"); defaults to the recruit
 * Selecting multiple weeks IS the prepay path. */
function logWeeksWeb(rid, method, weeks, customAmount, payer){
  const r = recruitById_(rid);
  if (!r) return { ok: false, msg: 'Recruit not found.' };
  method = (String(method) === 'Venmo') ? 'Venmo' : 'Cash';
  payer  = String(payer || '').trim() || r.name;

  let wk = (weeks || []).map(Number).filter(n => n >= 1 && n <= SEASON_WEEKS);
  wk = Array.from(new Set(wk)).sort((a, b) => a - b);
  if (!wk.length) return { ok: false, msg: 'Pick at least one week.' };

  const custom = round2_(customAmount);
  let amounts;
  if (custom > 0){
    // Distribute the custom total evenly; drop any rounding remainder on the last
    // row so the rows sum EXACTLY to the custom amount.
    const each = Math.floor((custom / wk.length) * 100) / 100;
    amounts = wk.map(() => each);
    amounts[amounts.length - 1] = round2_(custom - each * (wk.length - 1));
  } else {
    amounts = wk.map(() => WEEKLY_DUES);
  }

  wk.forEach((w, i) => {
    appendPayment_(rid, r.name, method, amounts[i], 'Dashboard', false,
                   { payer: payer, weekApplied: String(w) });
  });

  const tot = round2_(amounts.reduce((s, a) => s + a, 0));
  return { ok: true, msg: 'Logged ' + wk.length + ' week' + (wk.length === 1 ? '' : 's') + ' ' + method +
           ' ($' + tot.toFixed(2) + ') for ' + r.name + (payer !== r.name ? ' (paid by ' + payer + ')' : '') + '.' };
}

/* Per-recruit drill-down (Feature 1): every payment row for one recruit. */
function getRecruitPaymentsWeb(rid){
  const r = recruitById_(rid);
  const rows = getLedger_().filter(e => e.rid === rid && !e.review).map(e => ({
    ts: e.ts, method: e.method, amount: e.amount, week: e.week,
    payer: e.payer || e.name, source: e.source, split: e.splitGroup
  }));
  let cash = 0, venmo = 0;
  rows.forEach(p => { if (p.method === 'Venmo') venmo += p.amount; else cash += p.amount; });
  const weeksCovered = Math.min(Math.floor((cash + venmo) / WEEKLY_DUES), SEASON_WEEKS);
  return { ok: true, rid: rid, name: r ? r.name : rid, rows: rows,
           cash: round2_(cash), venmo: round2_(venmo), total: round2_(cash + venmo),
           weeksCovered: weeksCovered };
}

function nudgeNowWeb(rid){ return nudgeRecruit_(rid); }

/* Global pause toggle */
function togglePauseWeb(){
  setPaused_(!isPaused_());
  return { ok: true, paused: isPaused_() };
}

/* ── Review queue ────────────────────────────────────────────────────────── */

/* Assign a whole unmatched payment to ONE recruit (PayerName/sender preserved). */
function assignReviewWeb(row, rid){
  const sh = sheet_(LEDGER_TAB);
  if (row < 2 || row > sh.getLastRow()) return { ok: false, msg: 'Row no longer exists — refresh.' };
  const r = recruitById_(rid);
  if (!r) return { ok: false, msg: 'Recruit not found.' };
  sh.getRange(row, LED.RID).setValue(rid);
  sh.getRange(row, LED.NAME).setValue(r.name);     // credited recruit
  sh.getRange(row, LED.WEEK).setValue('Prepay');   // cumulative drives status; this is just a label
  sh.getRange(row, LED.REVIEW).setValue(REVIEW_GOOD);
  // PayerName (col G) intentionally untouched — keeps the original Venmo sender.
  return { ok: true, msg: 'Assigned to ' + r.name + '.' };
}

/* Split ONE unmatched Venmo across N recruits (Feature 1).
 *   assignments = [{ rid, amount, weeks }]  (weeks = "" or "1,2,3")
 * All new rows share the original Source (message-ID) + a fresh SplitGroupID,
 * and carry the original Venmo sender as PayerName. Split amounts must sum to
 * the received amount or the write is blocked. */
function splitVenmoReviewWeb(row, assignments){
  const sh = sheet_(LEDGER_TAB);
  if (row < 2 || row > sh.getLastRow()) return { ok: false, msg: 'Row no longer exists — refresh.' };

  const orig = getLedger_().filter(e => e.row === row)[0];
  if (!orig) return { ok: false, msg: 'Original payment not found — refresh.' };
  const received = round2_(orig.amount);

  const list = (assignments || []).map(a => ({
    rid: String(a.rid || '').trim(),
    amount: round2_(a.amount),
    weeks: String(a.weeks || '').replace(/\s/g, '')
  })).filter(a => a.rid && a.amount > 0);
  if (!list.length) return { ok: false, msg: 'Add at least one recruit + amount.' };

  // Split-sum validation: the parts must equal what was received.
  const sum  = round2_(list.reduce((s, a) => s + a.amount, 0));
  const diff = round2_(received - sum);
  if (Math.abs(diff) >= 0.01){
    return { ok: false, remaining: diff,
             msg: 'Split must total $' + received.toFixed(2) + '. ' +
                  (diff > 0 ? ('$' + diff.toFixed(2) + ' remaining.') : ('Over by $' + Math.abs(diff).toFixed(2) + '.')) };
  }

  const payer   = orig.payer || orig.name || 'Unknown';   // Venmo sender → onto each split row
  const source  = orig.source;                            // shared message-ID keeps idempotency intact
  const splitId = nextSplitGroupId_();

  // Write the split rows first, then remove the original review row (so a mid-way
  // failure never silently loses the payment).
  list.forEach(a => {
    const r = recruitById_(a.rid);
    appendPayment_(a.rid, r ? r.name : a.rid, 'Venmo', a.amount, source, false,
                   { payer: payer, splitGroup: splitId, weekApplied: a.weeks || undefined });
  });
  sh.deleteRow(row);

  return { ok: true, msg: 'Split $' + received.toFixed(2) + ' from ' + payer + ' across ' +
           list.length + ' recruit' + (list.length === 1 ? '' : 's') + '.' };
}

function dismissReviewWeb(row){
  const sh = sheet_(LEDGER_TAB);
  if (row < 2 || row > sh.getLastRow()) return { ok: false, msg: 'Row no longer exists — refresh.' };
  sh.deleteRow(row);                                 // not a dues payment — remove it
  return { ok: true, msg: 'Dismissed.' };
}

function nextSplitGroupId_(){ return 'S' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd-HHmmss-') + Math.floor(Math.random() * 900 + 100); }
function getDashHtml(){return HtmlService.createHtmlOutputFromFile("dashboard").getContent();}

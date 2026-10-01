/*  WebApp.gs — serves the dashboard and handles its google.script.run calls. (v2) */

function doGet(){
  ensureSchema_();   // create/upgrade tabs before anything reads them
  return HtmlService.createHtmlOutputFromFile('dashboard')
    .setTitle(KITTY_TITLE)
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

  const methods = getPaymentMethods_();

  // Money In: split by method across the whole ledger (review/dismissed excluded).
  let cashIn = 0, venmoIn = 0;
  const byMethod = {};
  methods.forEach(m => { byMethod[m.name] = 0; });
  ledger.forEach(e => {
    if (!credits_(e)) return;
    const k = e.method || 'Other';
    byMethod[k] = round2_((byMethod[k] || 0) + e.amount);
    if (e.method === 'Venmo') venmoIn += e.amount; else cashIn += e.amount;
  });
  const collected = round2_(cashIn + venmoIn);
  const expected  = active * week * WEEKLY_DUES;
  const spent     = spentToDate_();
  const balance   = round2_(collected - spent);

  // Per-recruit totals split by method, review/dismissed rows excluded.
  const methodMap = {};
  ledger.forEach(e => {
    if (!credits_(e)) return;
    const m = methodMap[e.rid] || (methodMap[e.rid] = {});
    const key = e.method || 'Other';
    m[key] = (m[key] || 0) + e.amount;
  });

  // Review queue — now carries the Venmo sender (payer), amount, and the memo
  // the payer typed so the operator has context before assigning/splitting.
  const review = ledger.filter(e => e.review).map(e => ({
    row: e.row, name: e.name, payer: e.payer || e.name, amount: e.amount,
    method: e.method, source: e.source, memo: e.memo || ''
  }));

  // Recent payments log — newest PAYMENT first, by when the money actually
  // arrived (not where the row sits in the sheet: imports and splits append
  // old payments at the bottom, which used to push them to the top here).
  const recent = ledger.filter(e => !e.dismissed)
    .map(e => ({ e: e, t: tsMillis_(e.ts) }))
    .sort((a, b) => b.t - a.t || b.e.row - a.e.row)
    .slice(0, 20)
    .map(x => ({
      ts: x.t, name: x.e.name || 'Unknown', payer: x.e.payer || x.e.name,
      method: x.e.method, amount: x.e.amount, split: x.e.splitGroup, review: x.e.review,
      week: String(x.e.week == null ? '' : x.e.week), memo: x.e.memo || ''
    }));

  // Possible-splits panel: every credited Venmo whose memo names another
  // recruit. The dashboard surfaces these for one-click re-attribution.
  const suggestions = splitSuggestions_();
  const recon = reconcile_();   // does the Ledger match the bank's record?

  return {
    title: KITTY_TITLE,
    setup: setupInfo_(),
    week: week, seasonWeeks: SEASON_WEEKS, closed: seasonClosed(),
    paused: isPaused_(),
    activeCount: active,
    paidCount: rows.filter(r => r.paidThisWeek).length,
    unpaidCount: rows.filter(r => !r.paidThisWeek).length,
    collected: collected, expected: expected,
    weeklyDues: WEEKLY_DUES, seasonTotal: TOTAL_PER_RECRUIT,
    moneyIn: { cash: round2_(cashIn), venmo: round2_(venmoIn), total: collected, byMethod: byMethod },
    methods: methods,
    pay: { venmo: COLLECTOR_VENMO, prefix: PAY_NOTE_PREFIX },
    kitty:   { collected: collected, spent: spent, balance: balance },
    splitSuggestions: suggestions,
    recon: recon,
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
        label = ahead > 0 ? ('Paid through wk ' + rawWeeks) : 'Current';
      } else {
        const late = week - rawWeeks;
        kind  = 'late';
        label = 'Late ' + late + ' wk' + (late === 1 ? '' : 's') + ' · $' + owed.toFixed(2) + ' owed';
      }
      return {
        rid: r.rid, name: r.name, code: payCode_(r.rid),
        paidThisWeek: r.paidThisWeek,
        paid: paid,
        weeksCovered: r.weeksCovered,                 // drives greyed weeks in the picker
        cash: mm['Cash'] || 0, venmo: mm['Venmo'] || 0, byMethod: mm,
        statusKind: kind, status: label
      };
    }),
    review: review,
    recent: recent,
    // Assign/log dropdown — the kitty manager is excluded so he can never
    // be credited, not even by a manual mis-click.
    roster: activeRoster_()
      .filter(r => r.name.trim().toLowerCase() !== COLLECTOR_NAME.trim().toLowerCase())
      .map(r => ({ rid: r.rid, name: r.name }))
  };
}

/* ── Per-row / manual payment actions ────────────────────────────────────── */

// Back-compat: one week of cash at the current week.
function markCashPaidWeb(rid){ return logPaymentWeb(rid, 'Cash', WEEKLY_DUES); }

/* Single-row logger: method = any name on the PaymentMethods tab, amount in dollars.
 * payer defaults to the recruit (pass a different name for "someone else paid").
 * weekApplied is optional free text ("Prepay", "5", "5,6,7"). */
function logPaymentWeb(rid, method, amount, payer, weekApplied){
  const r = recruitById_(rid);
  if (!r) return { ok: false, msg: 'Recruit not found.' };
  amount = round2_(amount);
  if (!(amount > 0)) return { ok: false, msg: 'Enter an amount greater than $0.' };
  method = canonicalMethod_(method);
  if (!method) return { ok: false, msg: 'Unknown payment method — add it under ⚙ Payment methods first.' };
  payer  = String(payer || '').trim() || r.name;
  appendPayment_(rid, r.name, method, amount, 'Dashboard', false,
                 { payer: payer, status: REVIEW_HAND,
                   weekApplied: (weekApplied != null && String(weekApplied).length) ? weekApplied : undefined });
  recordHandPayment_(method, payer, amount, r.name);
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
  method = canonicalMethod_(method);
  if (!method) return { ok: false, msg: 'Unknown payment method — add it under ⚙ Payment methods first.' };
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
                   { payer: payer, weekApplied: String(w), status: REVIEW_HAND });
  });

  const tot = round2_(amounts.reduce((s, a) => s + a, 0));
  recordHandPayment_(method, payer, tot, r.name);
  return { ok: true, msg: 'Logged ' + wk.length + ' week' + (wk.length === 1 ? '' : 's') + ' ' + method +
           ' ($' + tot.toFixed(2) + ') for ' + r.name + (payer !== r.name ? ' (paid by ' + payer + ')' : '') + '.' };
}

/* A Venmo logged by hand also goes on the Payments tab, so the books still
 * balance (the poller's fingerprint check then skips the matching receipt).
 * Other methods have no bank record to reconcile against. */
function recordHandPayment_(method, payer, amount, creditedName){
  if (method !== 'Venmo') return;
  const stamp = nowStamp_();
  appendPaymentRecord_('HAND-' + stamp.replace(/\D/g, '') + '-' + Math.floor(Math.random() * 900 + 100),
                       stamp, 'Venmo', payer, amount, 'Logged by hand on the dashboard', creditedName);
}

/* Per-recruit drill-down (Feature 1): every payment row for one recruit. */
function getRecruitPaymentsWeb(rid){
  const r = recruitById_(rid);
  const rows = getLedger_().filter(e => e.rid === rid && credits_(e))
    .sort((a, b) => tsMillis_(a.ts) - tsMillis_(b.ts))
    .map(e => ({
      ts: tsMillis_(e.ts), method: e.method, amount: e.amount, week: String(e.week == null ? '' : e.week),
      payer: e.payer || e.name, source: e.source, split: e.splitGroup,
      memo: e.memo || '', manual: e.manual
    }));
  let cash = 0, venmo = 0;
  const byMethod = {};
  rows.forEach(p => {
    byMethod[p.method] = round2_((byMethod[p.method] || 0) + p.amount);
    if (p.method === 'Venmo') venmo += p.amount; else cash += p.amount;
  });
  const total = round2_(cash + venmo);
  const weeksCovered = Math.min(Math.floor(total / WEEKLY_DUES), SEASON_WEEKS);
  const owed = Math.max(0, getCurrentWeek() * WEEKLY_DUES - total);
  return { ok: true, rid: rid, name: r ? r.name : rid, rows: rows,
           cash: round2_(cash), venmo: round2_(venmo), total: total, byMethod: byMethod,
           weeksCovered: weeksCovered, owed: owed,
           code: payCode_(rid), payNote: payNote_([rid]),
           payLink: venmoPayLink_([rid], owed > 0 ? owed : WEEKLY_DUES) };
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
  const orig = getLedger_().filter(e => e.row === row)[0];
  if (!orig) return { ok: false, msg: 'Row no longer exists — refresh.' };
  const before = cumulativeMap_(row)[rid] || 0;
  sh.getRange(row, LED.RID).setValue(rid);
  sh.getRange(row, LED.NAME).setValue(r.name);     // credited recruit
  sh.getRange(row, LED.WEEK).setValue(weeksLabel_(before, before + orig.amount));
  sh.getRange(row, LED.REVIEW).setValue(REVIEW_HAND);   // a person decided — automation won't move it
  // PayerName (col G) intentionally untouched — keeps the original Venmo sender.
  setPaymentAlloc_(orig.source, r.name);
  return { ok: true, msg: 'Assigned to ' + r.name + '.' };
}

/* Split ONE unmatched Venmo across N recruits (Feature 1).
 *   assignments = [{ rid, amount, weeks }]  (weeks = "" or "1,2,3")
 * All new rows share the original Source (message-ID) + a fresh SplitGroupID,
 * and carry the original Venmo sender as PayerName, payment DATE and note —
 * so the split stays where it happened in history and the poller still
 * recognises the payment (re-stamping it "now" made the poller re-add it).
 * Split amounts must sum to the received amount or the write is blocked. */
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
  const method  = orig.method || 'Venmo';
  const names   = [];
  list.forEach(a => {
    const r = recruitById_(a.rid);
    names.push(r ? r.name : a.rid);
    appendPayment_(a.rid, r ? r.name : a.rid, method, a.amount, source, false,
                   { payer: payer, splitGroup: splitId, weekApplied: a.weeks || undefined,
                     ts: stampOf_(orig.ts), memo: orig.memo, status: REVIEW_HAND, excludeRow: row });
  });
  sh.deleteRow(row);
  setPaymentAlloc_(source, names.join(', '));

  return { ok: true, msg: 'Split $' + received.toFixed(2) + ' from ' + payer + ' across ' +
           list.length + ' recruit' + (list.length === 1 ? '' : 's') + '.' };
}

/* Not a dues payment. The row is KEPT, marked Dismissed and credited to nobody:
 * deleting it let the poller find the receipt again and put it straight back. */
function dismissReviewWeb(row){
  const sh = sheet_(LEDGER_TAB);
  if (row < 2 || row > sh.getLastRow()) return { ok: false, msg: 'Row no longer exists — refresh.' };
  const orig = getLedger_().filter(e => e.row === row)[0];
  sh.getRange(row, LED.RID).setValue('');
  sh.getRange(row, LED.NAME).setValue('');
  sh.getRange(row, LED.WEEK).setValue('');
  sh.getRange(row, LED.REVIEW).setValue(REVIEW_DISMISSED);
  if (orig) setPaymentAlloc_(orig.source, 'DISMISSED');
  return { ok: true, msg: 'Dismissed — it won\'t come back.' };
}

/* Split an ALREADY-CREDITED payment (vs splitVenmoReviewWeb which only operates
 * on rows in the Review queue). Same wire format: row + assignments list.
 * Reuses splitVenmoReviewWeb under the hood since the underlying mechanics
 * (validate sum, write split rows, delete original) are identical regardless
 * of the original row's ReviewFlag. */
function splitCreditedPaymentWeb(row, assignments){
  return splitVenmoReviewWeb(row, assignments);
}

/* Persistently dismiss a Possible-Splits suggestion ("Looks fine"). Keyed by
 * Gmail message-ID when available so the dismissal survives row deletions and
 * sheet reorders. Run resetDismissedSuggestions() from the editor to clear all. */
function dismissSuggestionWeb(row, source, amount){
  const key = source ? ('src:' + source) : ('row:' + row + ':' + (amount || 0));
  addDismissedSuggestion_(key);
  return { ok: true, msg: 'Dismissed. Run resetDismissedSuggestions() in the editor to bring back.' };
}

/* ── Payment methods (⚙ on the dashboard) ────────────────────────────────── */

/* Add a method, or update its "send to" / instructions if it already exists. */
function savePaymentMethodWeb(m){
  m = m || {};
  const name = String(m.name || '').trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, msg: 'Give the method a name (e.g. Zelle).' };
  if (name.length > 30) return { ok: false, msg: 'Keep the name under 30 characters.' };
  const sendTo = String(m.sendTo || '').trim(), instr = String(m.instructions || '').trim();
  ensureSchema_();
  const sh = sheet_(METHODS_TAB);
  const last = sh.getLastRow();
  const names = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0]).trim().toLowerCase()) : [];
  const i = names.indexOf(name.toLowerCase());
  if (i >= 0){
    sh.getRange(i + 2, 1, 1, METHODS_HEADERS.length).setValues([[sh.getRange(i + 2, 1).getValue(), sendTo, instr]]);
    return { ok: true, msg: 'Updated ' + name + '.' };
  }
  sh.appendRow([name, sendTo, instr]);
  return { ok: true, msg: 'Added ' + name + '. It now shows in Log Payment and the reminder emails.' };
}

/* Remove a method. Venmo and Cash can't be removed; past payments keep their method. */
function removePaymentMethodWeb(name){
  name = String(name || '').trim();
  if (BUILTIN_METHODS.some(b => b.toLowerCase() === name.toLowerCase()))
    return { ok: false, msg: name + ' is built in and can\'t be removed.' };
  const sh = sheet_(METHODS_TAB);
  const last = sh ? sh.getLastRow() : 0;
  for (let r = last; r >= 2; r--){
    if (String(sh.getRange(r, 1).getValue()).trim().toLowerCase() === name.toLowerCase()){
      sh.deleteRow(r);
      return { ok: true, msg: 'Removed ' + name + '. Payments already logged with it are unchanged.' };
    }
  }
  return { ok: false, msg: 'Not found — refresh.' };
}

function nextSplitGroupId_(){ return 'S' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd-HHmmss-') + Math.floor(Math.random() * 900 + 100); }
function getDashHtml(){return HtmlService.createHtmlOutputFromFile("dashboard").getContent();}

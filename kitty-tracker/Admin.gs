/*  Admin.gs — the ONLY file with run-by-hand tools. Everything an operator
 *  ever needs to do lives here, in the order you'd need it.
 *  ────────────────────────────────────────────────────────────────────────
 *
 *  NEW CLASS / HANDOFF
 *    1. Edit the SETTINGS block in Config.gs (collector, season start, dues).
 *    2. Run  setUpKitty()   — builds the tabs and installs every trigger.
 *    3. Add recruits: link the sign-up Form, then run syncFormResponses().
 *    4. Share the web-app URL. Done — it runs itself from here.
 *
 *  DAY TO DAY
 *    Nothing. The poller records Venmo every 15 minutes and reminders send
 *    themselves. Use the dashboard for cash, splits and the review queue.
 *
 *  IF SOMETHING LOOKS WRONG
 *    importVenmoStatement()  — the fix-everything button. Rebuilds all Venmo
 *                              from a downloaded statement (the bank is the
 *                              source of truth). Cash is never touched.
 *    recheckCredits()        — re-applies the crediting rules to existing rows.
 *
 *  Every tool here backs the Ledger up to a timestamped tab first, and every
 *  one is safe to run twice.                                                */


/* ── Setup ────────────────────────────────────────────────────────────── */

/** One-time setup for a new season. Idempotent. */
function setUpKitty(){
  ensureSchema_();
  const t = installTriggers();
  const msg = 'Tabs ready (Roster, Ledger, Expenses).\n' + t +
         '\nCollector: ' + COLLECTOR_NAME + ' (' + COLLECTOR_VENMO + ')' +
         '\nSeason: ' + SEASON_START + ' + ' + SEASON_WEEKS + ' weeks at $' + WEEKLY_DUES +
         '\nNext: link the sign-up Form and run syncFormResponses().';
  Logger.log(msg);
  return msg;
}

/** Install/refresh every trigger: the Venmo poller and the reminder slots. */
function installTriggers(){
  ScriptApp.getProjectTriggers().forEach(t => {
    const f = t.getHandlerFunction();
    if (f === 'parseVenmoInbox' || f === 'sendRemindersNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('parseVenmoInbox').timeBased().everyMinutes(GMAIL_POLL_MINUTES).create();
  REMINDER_SLOTS.forEach(([day, hour, minute]) => {
    ScriptApp.newTrigger('sendRemindersNow').timeBased()
      .onWeekDay(ScriptApp.WeekDay[day]).atHour(hour).nearMinute(minute)
      .inTimezone(TIMEZONE).create();
  });
  const msg = 'Triggers installed: Venmo poller every ' + GMAIL_POLL_MINUTES +
         ' min + ' + REMINDER_SLOTS.length + ' reminder slots.';
  Logger.log(msg);
  return msg;
}

function removeTriggers(){
  const n = ScriptApp.getProjectTriggers().length;
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  const msg = 'Removed ' + n + ' trigger(s). The tracker is now idle.';
  Logger.log(msg);
  return msg;
}

function listTriggers(){
  const out = ScriptApp.getProjectTriggers()
    .map(t => t.getHandlerFunction() + ' — ' + t.getEventType());
  Logger.log(out.join('\n') || 'No triggers installed.');
  return out;
}


/* ── The fix-everything button ────────────────────────────────────────── */

/** Rebuild ALL Venmo from a downloaded Venmo statement. The fix-everything button.
 *
 *  WHEN: any time the numbers look wrong. The statement is the bank's own
 *  record, so this is always safe to fall back on.
 *
 *  HOW:
 *    1. Venmo app/site -> Statement -> download the CSV for the season.
 *    2. Put it in a tab named exactly "StatementImport"
 *       (File -> Import -> Insert new sheet, then rename the tab).
 *    3. Run this.
 *
 *  Writes every payment to the Payments tab (the bank's record), then allocates
 *  each one to whoever it was for — reading the note for named recruits and
 *  Aliases, falling back to the sender. Anything it can't resolve confidently
 *  goes to the review queue rather than being guessed at.
 *
 *  CASH IS NEVER TOUCHED. Finishes by reconciling the two tables. */
function importVenmoStatement(){
  ensureSchema_();
  const ss  = ss_();
  const tab = ss.getSheetByName('StatementImport');
  if (!tab) return logAndReturn_('No "StatementImport" tab found. Put the Venmo statement CSV in a tab with that exact name, then run this again.');

  const rows = tab.getDataRange().getValues();
  if (rows.length < 2) return logAndReturn_('The StatementImport tab is empty.');

  // Find the header row wherever Venmo put it.
  let hdr = -1, col = {};
  for (let i = 0; i < Math.min(rows.length, 12); i++){
    const cells = rows[i].map(c => String(c).trim().toLowerCase());
    if (cells.indexOf('datetime') >= 0 && cells.indexOf('from') >= 0){
      hdr = i;
      col = { id: cells.indexOf('id'), dt: cells.indexOf('datetime'),
              type: cells.indexOf('type'), status: cells.indexOf('status'),
              note: cells.indexOf('note'), from: cells.indexOf('from'),
              amt: cells.findIndex(c => c.indexOf('amount (total)') === 0) };
      break;
    }
  }
  if (hdr < 0) return logAndReturn_('Could not find the statement header row (needs "Datetime" and "From" columns).');

  const backup = 'Ledger_bak_' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd-HHmmss');
  const led = sheet_(LEDGER_TAB);
  led.copyTo(ss).setName(backup);

  // Clear ALL Venmo — both tables. Cash rows stay exactly as they are.
  getLedger_().filter(e => e.method === 'Venmo')
              .map(e => e.row).sort((a, b) => b - a)
              .forEach(r => led.deleteRow(r));
  const paySheet = sheet_(PAYMENTS_TAB);
  if (paySheet.getLastRow() > 1) paySheet.deleteRows(2, paySheet.getLastRow() - 1);

  const roster  = activeRoster_();
  const aliases = getAliases_();
  const payRows = [], ledRows = [];
  const covered = {};
  let total = 0, credited = 0, review = 0, split = 0;

  for (let i = hdr + 1; i < rows.length; i++){
    const r = rows[i];
    if (String(r[col.type]).trim() !== 'Payment') continue;
    if (String(r[col.status]).trim() !== 'Complete') continue;
    const m = String(r[col.amt]).match(/\+\s*\$?\s*([\d,]+\.?\d*)/);
    if (!m) continue;                                     // outgoing / transfers
    const amount = parseFloat(m[1].replace(/,/g, ''));
    if (!(amount > 0)) continue;

    const when  = new Date(String(r[col.dt]));
    const stamp = Utilities.formatDate(when, TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    const payer = String(r[col.from]).trim();
    const note  = String(r[col.note] || '').trim();
    const id    = String(r[col.id] || '').trim();
    total += amount;

    const parts = allocatePayment_({ payer: payer, amount: amount, note: note }, roster, aliases);

    const payRow = [];
    payRow[PAY.ID - 1]     = id;
    payRow[PAY.DATE - 1]   = stamp;
    payRow[PAY.METHOD - 1] = 'Venmo';
    payRow[PAY.PAYER - 1]  = payer;
    payRow[PAY.AMOUNT - 1] = amount;
    payRow[PAY.NOTE - 1]   = note;
    payRow[PAY.ALLOC - 1]  = parts.length ? parts.map(p => p.name).join(', ') : 'NEEDS REVIEW';
    payRows.push(payRow);

    if (!parts.length){                                   // couldn't resolve -> review
      ledRows.push(ledgerRow_(stamp, '', '', amount, '', payer, id, '', REVIEW_BAD, note));
      review++;
      continue;
    }
    if (parts.length > 1) split++;
    const group = parts.length > 1 ? 'S' + id.slice(-8) : '';
    parts.forEach(p => {
      covered[p.rid] = (covered[p.rid] || 0) + p.amount;
      const w = Math.floor(covered[p.rid] / WEEKLY_DUES);
      const week = (w > getCurrentWeek()) ? 'Prepay' : String(Math.max(1, w));
      ledRows.push(ledgerRow_(stamp, p.rid, p.name, p.amount, week, payer, id, group, REVIEW_GOOD, note));
    });
    credited++;
  }

  if (payRows.length) paySheet.getRange(2, 1, payRows.length, PAYMENTS_HEADERS.length).setValues(payRows);
  if (ledRows.length) led.getRange(led.getLastRow() + 1, 1, ledRows.length, LEDGER_HEADERS.length).setValues(ledRows);

  const rec = reconcile_();
  return logAndReturn_(
    'Rebuilt Venmo from the statement.\n' +
    '  Received:   $' + total.toFixed(2) + ' across ' + payRows.length + ' payments\n' +
    '  Allocated:  ' + credited + ' payments (' + split + ' covering more than one person)\n' +
    '  To review:  ' + review + '\n' +
    '  Backup:     "' + backup + '"\n\n' +
    (rec.ok ? 'BOOKS BALANCE ✓ — every dollar received is credited to somebody.\n'
            : 'OUT OF BALANCE by $' + rec.difference.toFixed(2) + ' — run checkTheBooks().\n') +
    'Compare $' + total.toFixed(2) + ' to the statement total. Cash untouched.');
}

/* Build one Ledger row in column order. */
function ledgerRow_(ts, rid, name, amount, week, payer, source, group, status, memo){
  const row = [];
  row[LED.TS - 1]     = ts;
  row[LED.RID - 1]    = rid;
  row[LED.NAME - 1]   = name;
  row[LED.METHOD - 1] = 'Venmo';
  row[LED.AMOUNT - 1] = amount;
  row[LED.WEEK - 1]   = week;
  row[LED.PAYER - 1]  = payer;
  row[LED.SOURCE - 1] = source;
  row[LED.SPLIT - 1]  = group;
  row[LED.REVIEW - 1] = status;
  row[LED.MEMO - 1]   = memo;
  return row;
}

function logAndReturn_(msg){ Logger.log(msg); return msg; }


/* ── Repairs ──────────────────────────────────────────────────────────── */

/** Re-apply the current crediting rules to Venmo rows already in the Ledger.
 *  Use after changing the collector or fixing a roster name. Moves a payment
 *  to whoever actually sent it; sends it to review if the sender isn't on the
 *  roster. Rows you split or assigned by hand are left alone. */
function recheckCredits(){
  ensureSchema_();
  const ss = ss_(), led = sheet_(LEDGER_TAB);
  const backup = 'Ledger_bak_' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd-HHmmss');
  led.copyTo(ss).setName(backup);

  const roster = activeRoster_();
  const last = led.getLastRow();
  if (last < 2) return 'Ledger is empty.';
  const rng = led.getRange(2, 1, last - 1, LEDGER_HEADERS.length);
  const vals = rng.getValues();

  let moved = 0, toReview = 0;
  vals.forEach(row => {
    if (String(row[LED.METHOD - 1]).trim() !== 'Venmo') return;
    if (String(row[LED.SPLIT - 1]).trim()) return;              // hand-split, leave it
    const payer = String(row[LED.PAYER - 1]).trim();
    if (!payer) return;

    const amount = Number(row[LED.AMOUNT - 1]) || 0;
    const match  = matchSender_({ payer: payer, amount: amount, handle: '', memo: '' }, roster);
    const ok     = match && isWholeWeeks_(amount);
    const curRid = String(row[LED.RID - 1]).trim();

    if (ok && match.rid !== curRid){
      row[LED.RID - 1]    = match.rid;
      row[LED.NAME - 1]   = match.name;
      row[LED.REVIEW - 1] = REVIEW_GOOD;
      moved++;
    } else if (!ok && curRid){
      row[LED.RID - 1]    = '';
      row[LED.NAME - 1]   = '';
      row[LED.WEEK - 1]   = '';
      row[LED.REVIEW - 1] = REVIEW_BAD;
      toReview++;
    }
  });
  rng.setValues(vals);
  const msg = 'Re-checked credits: ' + moved + ' moved to the correct sender, ' +
         toReview + ' sent to review. Backup: "' + backup + '".';
  Logger.log(msg);
  return msg;
}


/** Remove duplicate Venmo payments (same date + payer + amount kept once).
 *  Only needed if a bad import doubled things up; the poller can't create
 *  duplicates any more. Keeps the earliest row of each set. */
function removeDuplicatePayments(){
  ensureSchema_();
  const ss = ss_(), led = sheet_(LEDGER_TAB);
  const backup = 'Ledger_bak_' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd-HHmmss');
  led.copyTo(ss).setName(backup);

  const seen = {}, drop = [];
  let dropped = 0;
  getLedger_().forEach(e => {
    if (e.method !== 'Venmo' || e.splitGroup) return;           // never touch splits
    const fp = paymentFingerprint_(e.ts, e.payer, e.amount);
    if (seen[fp]){ drop.push(e.row); dropped += e.amount; }
    else seen[fp] = true;
  });
  drop.sort((a, b) => b - a).forEach(r => led.deleteRow(r));
  const msg = 'Removed ' + drop.length + ' duplicate row(s) worth $' + dropped.toFixed(2) +
         '. Backup: "' + backup + '".';
  Logger.log(msg);
  return msg;
}

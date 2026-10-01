/*  Admin.gs — setup, handoff, and the run-by-hand repair tools.
 *  ────────────────────────────────────────────────────────────────────────
 *
 *  EVERYTHING DAY-TO-DAY IS IN THE SHEET'S  🔥 Kitty  MENU — no code editing:
 *    Open dashboard          — the whole app, right inside the sheet.
 *    Settings                — academy name, kitty manager, Venmo, start date,
 *                              weeks, dues. Saving switches the automation on.
 *    Start a new academy     — archives this sheet to Drive, then clears every
 *                              recruit, payment and receipt for a fresh class.
 *    How to hand this off    — the steps for the next kitty manager.
 *
 *  IF THE NUMBERS LOOK WRONG (run from the Apps Script editor)
 *    importVenmoStatement()  — rebuilds all Venmo from a downloaded statement.
 *    recheckCredits()        — re-applies the crediting rules.
 *
 *  Every repair tool backs the Ledger up to a timestamped tab first, and every
 *  one is safe to run twice.                                                */


/* ── The Kitty menu ───────────────────────────────────────────────────── */

/* Simple trigger: adds the menu every time the sheet is opened. */
function onOpen(){
  SpreadsheetApp.getUi().createMenu('🔥 Kitty')
    .addItem('Open dashboard', 'openDashboard')
    .addItem('Settings', 'openSettings')
    .addSeparator()
    .addItem('Start a new academy…', 'openNewAcademy')
    .addItem('How to hand this off', 'showHandoff')
    .addItem('Turn off automation (old manager)', 'turnOffAutomation')
    .addToUi();
}

function dashboardDialog_(open){
  const html = HtmlService.createHtmlOutput(
      HtmlService.createHtmlOutputFromFile('dashboard').getContent() +
      (open ? '<script>OPEN_PANEL=' + JSON.stringify(open) + ';</script>' : ''))
    .setWidth(1000).setHeight(720);
  SpreadsheetApp.getUi().showModalDialog(html, KITTY_TITLE);
}
function openDashboard(){  ensureSchema_(); dashboardDialog_(isSetUp_() ? '' : 'settings'); }
function openSettings(){   ensureSchema_(); dashboardDialog_('settings'); }
function openNewAcademy(){ ensureSchema_(); dashboardDialog_('newAcademy'); }

function showHandoff(){
  const html = HtmlService.createHtmlOutput(
    '<div style="font:14px/1.5 Arial,sans-serif;color:#15171B">' +
    '<p><b>Handing the kitty to a new manager</b></p>' +
    '<ol style="padding-left:18px">' +
    '<li>The new manager opens this sheet and does <b>File ▸ Make a copy</b>. ' +
       'Their copy comes with all of the code.</li>' +
    '<li>In <b>their</b> copy: <b>🔥 Kitty ▸ Start a new academy</b> (if it\'s a new class), ' +
       'or just <b>🔥 Kitty ▸ Settings</b>. Fill in their name, their Venmo and the start date, then Save. ' +
       'Google asks them to allow access once.</li>' +
    '<li>That\'s it. Venmo receipts are read from <b>their</b> Gmail, so the Venmo account ' +
       'recruits pay must email that Gmail address.</li>' +
    '</ol>' +
    '<p style="color:#555">Optional, for phone access: Extensions ▸ Apps Script ▸ Deploy ▸ New deployment ▸ Web app ▸ Deploy, ' +
       'and bookmark the link.</p>' +
    '<p style="color:#555">Once the new manager is running, the old manager opens <b>their</b> sheet and picks ' +
       '<b>🔥 Kitty ▸ Turn off automation</b> so it stops checking Venmo and sending reminders.</p></div>')
    .setWidth(520).setHeight(420);
  SpreadsheetApp.getUi().showModalDialog(html, 'How to hand this off');
}


/* ── Settings (from the dashboard) ────────────────────────────────────── */

/* What the dashboard needs to show the setup screen. */
function setupInfo_(){
  const ss = ss_();
  let formUrl = '';
  try { formUrl = ss.getFormUrl() || ''; } catch (e){}
  const values = {};
  SETTING_DEFS.forEach(d => { values[d[0]] = SETTINGS[d[0]]; });
  values.managerVenmo = COLLECTOR_VENMO;
  return {
    done: isSetUp_(),
    values: values,
    defs: SETTING_DEFS.map(d => ({ key: d[0], label: d[1], help: d[3] })),
    formUrl: formUrl.replace(/\/edit.*$/, '/viewform'),
    sheetUrl: ss.getUrl(),
    runningAs: (function(){ try { return Session.getEffectiveUser().getEmail(); } catch (e){ return ''; } })()
  };
}

/* Save the Settings tab, then switch the automation on. */
function saveSettingsWeb(v){
  v = v || {};
  const clean = {};
  const errors = [];
  SETTING_DEFS.forEach(d => {
    let x = String(v[d[0]] == null ? '' : v[d[0]]).trim();
    if (typeof d[2] === 'number'){
      const n = Number(x);
      if (!(n > 0)) errors.push(d[1] + ' must be a number above 0.');
      x = n;
    }
    clean[d[0]] = x;
  });
  if (!clean.academyName) errors.push('Academy name is required.');
  if (!clean.managerName) errors.push('Kitty manager name is required.');
  clean.managerVenmo = clean.managerVenmo.replace(/^@/, '').replace(/\s/g, '');
  if (!clean.managerVenmo) errors.push('Kitty manager Venmo is required.');
  else clean.managerVenmo = '@' + clean.managerVenmo;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean.seasonStart)) errors.push('Week 1 start date is required.');
  if (clean.seasonWeeks > 60) errors.push('Number of weeks looks too big.');
  if (clean.managerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean.managerEmail)) errors.push('Email doesn\'t look right.');
  if (errors.length) return { ok: false, msg: errors.join(' ') };

  ensureSchema_();
  const sh = sheet_(SETTINGS_TAB);
  const last = sh.getLastRow();
  const keys = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0]).trim()) : [];
  SETTING_DEFS.forEach(d => {
    const i = keys.indexOf(d[0]);
    if (i >= 0) sh.getRange(i + 2, 2).setNumberFormat('@').setValue(String(clean[d[0]]));
    else sh.appendRow([d[0], String(clean[d[0]]), d[1], d[3]]);
  });
  // Venmo's built-in "send to" follows the manager's handle.
  setMethodSendTo_('Venmo', clean.managerVenmo);

  const t = installTriggers();
  return { ok: true, msg: 'Saved. ' + t };
}

function setMethodSendTo_(name, sendTo){
  const sh = sheet_(METHODS_TAB);
  if (!sh) return;
  for (let r = 2; r <= sh.getLastRow(); r++){
    if (String(sh.getRange(r, 1).getValue()).trim().toLowerCase() === name.toLowerCase()){
      sh.getRange(r, 2).setValue(sendTo);
      return;
    }
  }
}


/* ── Start a new academy ──────────────────────────────────────────────── */

const NEW_ACADEMY_CONFIRM = 'NEW ACADEMY';
function clearedTabs_(){ return [ROSTER_TAB, LEDGER_TAB, PAYMENTS_TAB, EXPENSES_TAB, ALIASES_TAB]; }

/* Wipe this sheet for a brand-new class. First saves a complete copy of the
 * spreadsheet to Drive (nothing is ever lost), then:
 *   • clears Roster, Ledger, Payments, Expenses, Aliases and sign-up responses
 *   • deletes the Ledger_bak_* safety copies and any StatementImport tab
 *   • resets dismissals, report guards and the pause switch
 *   • clears the start date, so nothing runs until the new Settings are saved
 * Payment methods and the rest of the Settings are kept as a starting point. */
function startNewAcademyWeb(confirmText){
  if (String(confirmText || '').trim().toUpperCase() !== NEW_ACADEMY_CONFIRM)
    return { ok: false, msg: 'Type ' + NEW_ACADEMY_CONFIRM + ' to confirm.' };
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e){ return { ok: false, msg: 'Busy — try again in a minute.' }; }
  try {
    ensureSchema_();
    const ss = ss_();
    const stamp = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
    const archive = ss.copy(KITTY_TITLE + ' — archive ' + stamp);

    clearedTabs_().forEach(name => {
      const sh = sheet_(name);
      if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    });
    let cleared = 0;
    ss.getSheets().forEach(sh => {
      const n = sh.getName();
      if (/^Ledger_bak_/.test(n) || n === 'StatementImport') ss.deleteSheet(sh);
      else if (/^form responses/i.test(n) && sh.getLastRow() > 1){
        cleared += sh.getLastRow() - 1;
        sh.deleteRows(2, sh.getLastRow() - 1);
      }
    });

    const props = PropertiesService.getScriptProperties();
    Object.keys(props.getProperties()).forEach(k => {
      if (k === PROP_DISMISSED || k === PROP_PAUSED || k.indexOf(REPORT_LOG_PREFIX) === 0) props.deleteProperty(k);
    });

    // Blank the start date: the tracker stays off until the new Settings are saved.
    const set = sheet_(SETTINGS_TAB);
    for (let r = 2; r <= set.getLastRow(); r++){
      if (String(set.getRange(r, 1).getValue()).trim() === 'seasonStart') set.getRange(r, 2).setValue('');
    }

    return logAndReturn_obj_({ ok: true, archiveUrl: archive.getUrl(),
      msg: 'Fresh start. The old academy is saved to Drive as "' + archive.getName() + '". ' +
           'Now fill in Settings for the new class.' +
           (cleared ? ' (Cleared ' + cleared + ' old sign-up responses — the sign-up Form itself is unchanged.)' : '') });
  } finally {
    lock.releaseLock();
  }
}
function logAndReturn_obj_(o){ Logger.log(o.msg); return o; }


/* ── Triggers ─────────────────────────────────────────────────────────── */

/** One-time setup from the editor (the Settings screen does this for you). */
function setUpKitty(){
  ensureSchema_();
  const t = installTriggers();
  return logAndReturn_('Tabs ready.\n' + t +
    (isSetUp_() ? '' : '\nNext: open the sheet ▸ 🔥 Kitty ▸ Settings and fill them in.'));
}

/** Install/refresh every trigger: Venmo poller, reminder slots, sign-up form. */
function installTriggers(){
  ScriptApp.getProjectTriggers().forEach(t => {
    const f = t.getHandlerFunction();
    if (f === 'parseVenmoInbox' || f === 'sendRemindersNow' || f === 'onRecruitFormSubmit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('parseVenmoInbox').timeBased().everyMinutes(GMAIL_POLL_MINUTES).create();
  REMINDER_SLOTS.forEach(([day, hour, minute]) => {
    ScriptApp.newTrigger('sendRemindersNow').timeBased()
      .onWeekDay(ScriptApp.WeekDay[day]).atHour(hour).nearMinute(minute)
      .inTimezone(TIMEZONE).create();
  });
  // New sign-ups land on the Roster by themselves.
  ScriptApp.newTrigger('onRecruitFormSubmit').forSpreadsheet(ss_()).onFormSubmit().create();
  const msg = 'Automation on: Venmo checked every ' + GMAIL_POLL_MINUTES +
         ' min, ' + REMINDER_SLOTS.length + ' weekly reminder slots, sign-ups go straight to the Roster.';
  Logger.log(msg);
  return msg;
}

/* Menu: stop this copy checking Venmo and emailing reminders. */
function turnOffAutomation(){
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Turn off automation?',
      'This copy will stop checking Venmo and sending reminder emails. Saving Settings turns it back on.',
      ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  ui.alert(removeTriggers());
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
 *  HUMAN DECISIONS SURVIVE. A payment you assigned, split or dismissed on the
 *  dashboard is matched back up (same payer + amount, same day ±1) and keeps
 *  your decision instead of being re-guessed.
 *
 *  CASH IS NEVER TOUCHED. Finishes by reconciling the two tables. */
function importVenmoStatement(){
  ensureSchema_();
  const ss  = ss_();
  const tab = ss.getSheetByName('StatementImport');
  if (!tab) return logAndReturn_('No "StatementImport" tab found. Put the Venmo statement CSV in a tab with that exact name, then run this again.');

  const rows = tab.getDataRange().getValues();
  if (rows.length < 2) return logAndReturn_('The StatementImport tab is empty.');

  // Running totals start from cash, so week labels line up with the dashboard.
  const covered = {};
  getLedger_().forEach(e => { if (e.method !== 'Venmo' && credits_(e)) covered[e.rid] = (covered[e.rid] || 0) + e.amount; });

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

  // Remember every human decision before clearing, keyed by fingerprint.
  const kept = keptDecisions_();

  // Clear ALL Venmo — both tables. Cash rows stay exactly as they are.
  getLedger_().filter(e => e.method === 'Venmo')
              .map(e => e.row).sort((a, b) => b - a)
              .forEach(r => led.deleteRow(r));
  const paySheet = sheet_(PAYMENTS_TAB);
  if (paySheet.getLastRow() > 1) paySheet.deleteRows(2, paySheet.getLastRow() - 1);

  const roster  = activeRoster_();
  const aliases = getAliases_();
  const payRows = [], ledRows = [];
  let total = 0, credited = 0, review = 0, split = 0, reused = 0;

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

    // A decision a person already made for this payment wins.
    const decision = takeDecision_(kept, when, payer, amount);
    const parts = decision ? decision.filter(d => !d.dismissed)
                           : allocatePayment_({ payer: payer, amount: amount, note: note }, roster, aliases);

    const payRow = [];
    payRow[PAY.ID - 1]     = id;
    payRow[PAY.DATE - 1]   = stamp;
    payRow[PAY.METHOD - 1] = 'Venmo';
    payRow[PAY.PAYER - 1]  = payer;
    payRow[PAY.AMOUNT - 1] = amount;
    payRow[PAY.NOTE - 1]   = note;
    payRow[PAY.ALLOC - 1]  = parts.length ? parts.map(p => p.name).join(', ')
                           : (decision ? 'DISMISSED' : 'NEEDS REVIEW');
    payRows.push(payRow);

    if (decision && !parts.length){                       // dismissed by hand — keep it dismissed
      ledRows.push(ledgerRow_(stamp, '', '', amount, '', payer, id, '', REVIEW_DISMISSED, note));
      reused++;
      continue;
    }
    if (!parts.length){                                   // couldn't resolve -> review
      ledRows.push(ledgerRow_(stamp, '', '', amount, '', payer, id, '', REVIEW_BAD, note));
      review++;
      continue;
    }
    if (parts.length > 1) split++;
    if (decision) reused++;
    const group = parts.length > 1 ? 'S' + id.slice(-8) : '';
    parts.forEach(p => {
      const before = covered[p.rid] || 0;
      covered[p.rid] = before + p.amount;
      ledRows.push(ledgerRow_(stamp, p.rid, p.name, p.amount, weeksLabel_(before, covered[p.rid]),
                              payer, id, group, decision ? REVIEW_HAND : REVIEW_GOOD, note));
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
    '  Kept your hand decisions on ' + reused + ' payment(s)\n' +
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

/* Every human decision on a Venmo payment (assign, split, dismiss), keyed by
 * payer + amount, each with its day so a statement row can find it again.
 * Returns { 'payer|amount': [{ day, parts: [{rid, name, amount, dismissed}] }] } */
function keptDecisions_(){
  const groups = {};
  getLedger_().forEach(e => {
    if (e.method !== 'Venmo' || !(e.manual || e.dismissed)) return;
    const key = e.splitGroup ? 'g:' + e.splitGroup : 'r:' + e.row;
    const g = groups[key] || (groups[key] = { ts: e.ts, payer: e.payer, amount: 0, parts: [] });
    g.amount += e.amount;
    g.parts.push({ rid: e.rid, name: e.name, amount: e.amount, dismissed: e.dismissed });
  });
  const out = {};
  Object.keys(groups).forEach(k => {
    const g = groups[k];
    const key = normName_(g.payer) + '|' + round2_(g.amount).toFixed(2);
    (out[key] = out[key] || []).push({ day: tsMillis_(g.ts), parts: g.parts });
  });
  return out;
}
/* Pull (and use up) the decision for one statement payment, if there is one.
 * Same payer + amount, within a day either way (emails and statements can
 * disagree on the date near midnight). */
function takeDecision_(kept, when, payer, amount){
  const list = kept[normName_(payer) + '|' + round2_(amount).toFixed(2)];
  if (!list || !list.length) return null;
  const t = when.getTime();
  let best = -1, bestGap = 36 * 60 * 60 * 1000;
  list.forEach((d, i) => { const gap = Math.abs(d.day - t); if (gap <= bestGap){ best = i; bestGap = gap; } });
  if (best < 0) return null;
  return list.splice(best, 1)[0].parts;
}


/* ── Repairs ──────────────────────────────────────────────────────────── */

/** Re-apply the current crediting rules to Venmo rows already in the Ledger.
 *  Use after changing the collector, fixing a roster name or adding an Alias.
 *  Reads pay codes and names in the note the same way importVenmoStatement
 *  does, then falls back to the sender. NEVER touches a row a person decided
 *  (assigned, split, dismissed or logged by hand) — those are what kept being
 *  "moved" before. A payment the rules now say covers several people is left
 *  for Possible Splits rather than split silently. */
function recheckCredits(){
  ensureSchema_();
  const ss = ss_(), led = sheet_(LEDGER_TAB);
  const backup = 'Ledger_bak_' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd-HHmmss');
  led.copyTo(ss).setName(backup);

  const roster = activeRoster_(), aliases = getAliases_();
  const last = led.getLastRow();
  if (last < 2) return logAndReturn_('Ledger is empty.');
  const rng = led.getRange(2, 1, last - 1, LEDGER_HEADERS.length);
  const vals = rng.getValues();
  const ledger = getLedger_();

  let moved = 0, toReview = 0, fixed = 0;
  vals.forEach((row, i) => {
    const e = ledger[i];
    if (e.method !== 'Venmo') return;
    if (e.splitGroup || e.manual || e.dismissed) return;        // a person or a split decided — leave it
    if (e.source === 'Dashboard') return;                       // logged by hand
    if (!e.payer) return;

    const parts = allocatePayment_({ payer: e.payer, amount: e.amount, note: e.memo }, roster, aliases);
    if (parts.length > 1) return;                               // several people -> Possible Splits
    const target = parts[0];

    if (target && target.rid !== e.rid){
      row[LED.RID - 1]    = target.rid;
      row[LED.NAME - 1]   = target.name;
      row[LED.REVIEW - 1] = REVIEW_GOOD;
      if (e.review) fixed++; else moved++;
    } else if (!target && e.rid){
      row[LED.RID - 1]    = '';
      row[LED.NAME - 1]   = '';
      row[LED.WEEK - 1]   = '';
      row[LED.REVIEW - 1] = REVIEW_BAD;
      toReview++;
    }
  });
  rng.setValues(vals);
  return logAndReturn_('Re-checked credits: ' + moved + ' moved, ' + fixed + ' cleared from review, ' +
         toReview + ' sent to review. Hand decisions left alone. Backup: "' + backup + '".');
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

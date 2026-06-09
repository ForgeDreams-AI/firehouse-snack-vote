/*  FormIntake.gs — pull recruit sign-ups from a linked Google Form into Roster.
 *  ────────────────────────────────────────────────────────────────────────
 *  HOW IT FITS TOGETHER
 *    You make a Google Form with 3 questions titled exactly:
 *        "Full name"   "Email"   "Venmo handle"
 *    Link the Form's responses to THIS spreadsheet (Form ▸ Responses ▸ Link to
 *    Sheets ▸ select this sheet). That creates a "Form Responses 1" tab.
 *    Then run installFormTrigger() ONCE so each new submission auto-fills Roster.
 *
 *  WHERE A RESPONSE GOES
 *    1. If the email already exists in Roster -> that row is updated (no dupes).
 *    2. Else the first Roster row with a blank FullName is filled (uses its
 *       existing RecruitID, e.g. R001..R055).
 *    3. Else a brand-new row is appended with the next RecruitID.
 *  ──────────────────────────────────────────────────────────────────────── */

// Installable trigger: fires on every new form submission to this spreadsheet.
function onRecruitFormSubmit(e){
  if (!e || !e.namedValues) return;
  const pick = keys => {
    for (let i = 0; i < keys.length; i++){
      const v = e.namedValues[keys[i]];
      if (v && v[0] != null && String(v[0]).trim() !== '') return String(v[0]).trim();
    }
    return '';
  };
  const name  = pick(['Full name', 'Full Name', 'Name']);
  const email = pick(['Email', 'Email Address', 'Email address']);
  const venmo = pick(['Venmo handle', 'Venmo Handle', 'Venmo']).replace(/^@/, '');
  if (!name && !email) return;
  upsertRoster_(name, email, venmo);
}

// Run this ONCE (after linking the Form to this sheet) to arm the auto-fill.
function installFormTrigger(){
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'onRecruitFormSubmit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onRecruitFormSubmit')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onFormSubmit()
    .create();
  return 'Form intake trigger installed — new submissions now auto-fill Roster.';
}

/* Manual backfill: sweep the whole "Form Responses" tab into Roster. Run this
 * once after setup to catch any responses that came in before the trigger,
 * or any time you want to re-sync. Safe to re-run (it upserts, never dupes). */
function syncFormResponses(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tab = ss.getSheets().filter(s => /^form responses/i.test(s.getName()))[0];
  if (!tab) return 'No "Form Responses" tab found — link the Form to this spreadsheet first.';
  const last = tab.getLastRow();
  if (last < 2) return 'No responses yet.';

  const data = tab.getRange(1, 1, last, tab.getLastColumn()).getValues();
  const hdr = data[0].map(h => String(h).toLowerCase());
  const find = subs => { for (let i = 0; i < hdr.length; i++){ if (subs.some(s => hdr[i].indexOf(s) >= 0)) return i; } return -1; };
  const ciName  = find(['full name', 'name']);
  const ciEmail = find(['email']);
  const ciVenmo = find(['venmo']);
  if (ciName < 0 || ciEmail < 0) return 'Could not find Name/Email columns in the responses tab.';

  let n = 0;
  for (let r = 1; r < data.length; r++){
    const name  = String(data[r][ciName]  == null ? '' : data[r][ciName]).trim();
    const email = String(data[r][ciEmail] == null ? '' : data[r][ciEmail]).trim();
    const venmo = ciVenmo >= 0 ? String(data[r][ciVenmo] == null ? '' : data[r][ciVenmo]).trim().replace(/^@/, '') : '';
    if (!name && !email) continue;
    upsertRoster_(name, email, venmo);
    n++;
  }
  return 'Synced ' + n + ' response(s) into Roster.';
}

/* Insert/update one recruit in Roster. Locked so simultaneous submissions
 * don't grab the same blank row. */
function upsertRoster_(name, email, venmo){
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e){ return; }
  try {
    const sh = sheet_(ROSTER_TAB);
    const last = sh.getLastRow();
    const vals = last >= 2 ? sh.getRange(2, 1, last - 1, ROSTER_HEADERS.length).getValues() : [];
    const emailLc = email.toLowerCase();

    let target = -1;
    // 1) existing email -> update that row
    if (emailLc){
      for (let i = 0; i < vals.length; i++){
        if (String(vals[i][ROS.EMAIL - 1]).trim().toLowerCase() === emailLc){ target = i + 2; break; }
      }
    }
    // 2) first blank-name row -> fill it (keeps its pre-seeded RecruitID)
    if (target === -1){
      for (let i = 0; i < vals.length; i++){
        if (String(vals[i][ROS.NAME - 1]).trim() === ''){ target = i + 2; break; }
      }
    }
    // 3) no room -> append a new row with the next RecruitID
    if (target === -1){
      const rid = 'R' + String(vals.length + 1).padStart(3, '0');
      sh.appendRow([rid, name, email, venmo, 'Active', '']);
      return;
    }

    sh.getRange(target, ROS.NAME).setValue(name);
    sh.getRange(target, ROS.EMAIL).setValue(email);
    if (venmo) sh.getRange(target, ROS.VENMO).setValue(venmo);
    if (String(sh.getRange(target, ROS.STATUS).getValue()).trim() === '')
      sh.getRange(target, ROS.STATUS).setValue('Active');
  } finally {
    lock.releaseLock();
  }
}

/*  FormIntake.gs — pull recruit sign-ups from a linked Google Form into Roster.
 *  ────────────────────────────────────────────────────────────────────────
 *  HOW IT FITS TOGETHER
 *    Dashboard ▸ 👥 Sign-ups ▸ Create sign-up form. That builds the Google
 *    Form (Full name, Email, Venmo handle), links it to this sheet and arms
 *    the auto-fill. Share the link it gives you — that's the whole intake.
 *    Each sign-up lands on the Roster and gets a welcome email with their pay
 *    code and a one-tap Venmo link.
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
  const rid = upsertRoster_(name, email, venmo);
  if (rid && email) {
    try { sendWelcome_(rid, name, email); }
    catch (err){ Logger.log('Welcome email failed for ' + email + ': ' + err); }
  }
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
  const tab = responsesTab_(ss);
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
 * don't grab the same blank row. Returns the recruit's RecruitID. */
function upsertRoster_(name, email, venmo){
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e){ return ''; }
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
    // 3) no room -> append a new row with the next unused RecruitID
    if (target === -1){
      const rid = nextRecruitId_(vals);
      sh.appendRow([rid, name, email, venmo, 'Active', '']);
      return rid;
    }

    sh.getRange(target, ROS.NAME).setValue(name);
    sh.getRange(target, ROS.EMAIL).setValue(email);
    if (venmo) sh.getRange(target, ROS.VENMO).setValue(venmo);
    if (String(sh.getRange(target, ROS.STATUS).getValue()).trim() === '')
      sh.getRange(target, ROS.STATUS).setValue('Active');
    return String(sh.getRange(target, ROS.RID).getValue()).trim();
  } finally {
    lock.releaseLock();
  }
}

/* One higher than the biggest R### on the Roster (never reuses a code). */
function nextRecruitId_(vals){
  let max = 0;
  vals.forEach(r => {
    const m = String(r[ROS.RID - 1]).trim().match(/^R(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 'R' + String(max + 1).padStart(3, '0');
}

/* The responses tab of the form currently linked to this sheet. */
function responsesTab_(ss){
  const linked = (function(){ try { return ss.getFormUrl() || ''; } catch (e){ return ''; } })();
  const formId = u => (String(u || '').match(/\/d\/(?:e\/)?([^/]+)/) || [])[1] || '';
  const tabs = ss.getSheets().filter(s => /^form responses/i.test(s.getName()));
  if (linked){
    const hit = tabs.filter(s => { try { return formId(s.getFormUrl()) === formId(linked); } catch (e){ return false; } })[0];
    if (hit) return hit;
  }
  return tabs[0] || null;
}


/* ── Build the sign-up form (dashboard ▸ 👥 Sign-ups) ─────────────────── */

/* Create the Google Form, link it to this sheet and arm the auto-fill.
 * replace = true swaps out an existing form (the old one is unlinked, kept in
 * Drive, and stops feeding the Roster). */
function createSignupFormWeb(replace){
  const ss = ss_();
  const existing = (function(){ try { return ss.getFormUrl() || ''; } catch (e){ return ''; } })();
  if (existing && !replace){
    return { ok: true, url: FormApp.openByUrl(existing).getPublishedUrl(), msg: 'You already have a sign-up form.' };
  }
  if (existing){
    try { FormApp.openByUrl(existing).setAcceptingResponses(false).removeDestination(); }
    catch (e){ Logger.log('Could not unlink old form: ' + e); }
  }

  const form = FormApp.create(KITTY_TITLE + ' — Sign-up')
    .setDescription('Sign up for the ' + KITTY_TITLE + '. Takes 30 seconds. ' +
                    'You\'ll get an email with your pay code and a one-tap Venmo link.')
    .setConfirmationMessage('You\'re in! Check your email for your pay code and Venmo link.')
    .setAllowResponseEdits(false)
    .setShowLinkToRespondAgain(false);
  form.addTextItem().setTitle('Full name').setHelpText('First and last, the way you\'d like it on the list.').setRequired(true);
  form.addTextItem().setTitle('Email').setRequired(true)
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().build());
  form.addTextItem().setTitle('Venmo handle')
    .setHelpText('Optional, e.g. @jane-doe. Helps match your payments automatically.');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  // Make sure submissions fill the Roster. (responsesTab_ finds the new
  // responses tab by its form link, whatever Google names it.)
  installFormTrigger();

  const url = form.getPublishedUrl();
  return { ok: true, url: url,
           msg: 'Sign-up form ready. Share the link — every sign-up lands on the Roster and gets their pay code by email.' };
}

/* Add one person by hand (no form). Same rules as a form sign-up. */
function addRecruitWeb(name, email, venmo, sendEmail){
  name = String(name || '').trim(); email = String(email || '').trim();
  venmo = String(venmo || '').trim().replace(/^@/, '');
  if (!name) return { ok: false, msg: 'Enter a name.' };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, msg: 'That email doesn\'t look right.' };
  ensureSchema_();
  const rid = upsertRoster_(name, email, venmo);
  if (!rid) return { ok: false, msg: 'Busy — try again.' };
  let sent = '';
  if (sendEmail && email){
    try { sendWelcome_(rid, name, email); sent = ' Welcome email sent.'; }
    catch (e){ sent = ' (Welcome email failed: ' + e + ')'; }
  }
  return { ok: true, rid: rid, msg: 'Added ' + name + ' as ' + rid + '.' + sent };
}


/* ── Welcome email ────────────────────────────────────────────────────── */

function sendWelcome_(rid, name, email){
  if (!isSetUp_()) return;                     // no Venmo/dues to tell them about yet
  const t = buildWelcome_(rid, name);
  GmailApp.sendEmail(email, t.subject, t.text, { name: KITTY_TITLE, htmlBody: t.html });
  Logger.log('Welcome sent to ' + name + ' <' + email + '> (' + rid + ')');
}

function buildWelcome_(rid, name){
  const first = String(name || 'Recruit').split(/\s+/)[0];
  const code = payCode_(rid), note = payNote_([rid]);
  const owedNow = Math.max(WEEKLY_DUES, getCurrentWeek() * WEEKLY_DUES);
  const link = venmoPayLink_([rid], owedNow);
  const others = getPaymentMethods_().filter(m => m.name !== 'Venmo');
  const subject = 'Welcome to the ' + KITTY_TITLE + ' — your pay code is ' + code;

  const text =
    'Hey ' + first + ',\n\n' +
    'You\'re signed up for the ' + KITTY_TITLE + '. Dues are $' + WEEKLY_DUES.toFixed(2) + ' a week for ' +
    SEASON_WEEKS + ' weeks ($' + TOTAL_PER_RECRUIT.toFixed(2) + ' total).\n\n' +
    'YOUR PAY CODE: ' + code + '\n' +
    'Always put "' + note + '" in the Venmo note. That\'s how the tracker knows it\'s you, ' +
    'even if you pay from someone else\'s account.\n\n' +
    'Pay now (amount + note filled in): ' + link + '\n' +
    'Or send to ' + COLLECTOR_VENMO + ' with the note: ' + note + '\n' +
    'Paying for friends too? Add their codes: "' + PAY_NOTE_PREFIX + ' ' + code + ' R0xx R0yy".\n' +
    (others.length ? '\nOther ways to pay:\n' + others.map(m => '  • ' + m.name +
      (m.sendTo ? ' — ' + m.sendTo : '') + (m.instructions ? ' — ' + m.instructions : '')).join('\n') + '\n' : '') +
    '\nPrepay the whole season and you\'ll never get a reminder.\n\n— ' + KITTY_TITLE;

  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#15171B;line-height:1.5;max-width:520px">' +
      '<p style="margin:0 0 12px">Hey ' + esc_(first) + ',</p>' +
      '<p style="margin:0 0 12px">You\'re signed up for the <b>' + esc_(KITTY_TITLE) + '</b>. Dues are <b>$' +
        WEEKLY_DUES.toFixed(2) + ' a week</b> for ' + SEASON_WEEKS + ' weeks ($' + TOTAL_PER_RECRUIT.toFixed(2) + ' total).</p>' +
      '<div style="background:#F3EFE7;border-radius:10px;padding:14px 16px;margin:0 0 12px">' +
        '<div style="font-size:12px;color:#555;text-transform:uppercase;letter-spacing:1px">Your pay code</div>' +
        '<div style="font-size:28px;font-weight:bold;color:#C8102E">' + esc_(code) + '</div>' +
        '<div style="font-size:13px;color:#333">Always put <b>' + esc_(note) + '</b> in the Venmo note — that\'s how the tracker ' +
        'knows it\'s you, even from someone else\'s account.</div></div>' +
      '<table cellpadding="0" cellspacing="0" style="margin:0 0 8px"><tr><td style="background:#C8102E;border-radius:8px">' +
        '<a href="' + esc_(link) + '" style="display:inline-block;color:#fff;font-weight:bold;padding:11px 18px;text-decoration:none">' +
        'Pay $' + owedNow.toFixed(2) + ' on Venmo</a></td></tr></table>' +
      '<p style="margin:0 0 12px;font-size:13px;color:#555">Or send to <b>' + esc_(COLLECTOR_VENMO) + '</b> with the note <b>' +
        esc_(note) + '</b>. Paying for friends too? Add their codes: <b>' + esc_(PAY_NOTE_PREFIX + ' ' + code) + ' R0xx R0yy</b>.</p>' +
      (others.length ? '<p style="margin:0 0 6px"><b>Other ways to pay</b></p><ul style="margin:0 0 12px;padding-left:20px">' +
        others.map(m => '<li>' + esc_(m.name) + (m.sendTo ? ' — <b>' + esc_(m.sendTo) + '</b>' : '') +
          (m.instructions ? ' — ' + esc_(m.instructions) : '') + '</li>').join('') + '</ul>' : '') +
      '<p style="margin:0 0 12px;color:#555">Prepay the whole season and you\'ll never get a reminder.</p>' +
      '<p style="margin:4px 0 0;font-size:13px;color:#888">— ' + esc_(KITTY_TITLE) + '</p>' +
    '</div>';
  return { subject: subject, text: text, html: html };
}

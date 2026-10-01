/*  Reminders.gs — the send engine + email templates.
 *  Every send re-queries the live sheet and emails ONLY currently-unpaid
 *  recruits. Respects the global PAUSE toggle and the season window. */

// Bound to every reminder trigger (see Triggers.gs).
function sendRemindersNow(){
  if (!isSetUp_())     { Logger.log('Reminders: not set up yet (Kitty menu ▸ Settings) — exiting.'); return; }
  if (isPaused_())     { Logger.log('Reminders: paused — exiting.'); return; }
  if (seasonClosed())  { Logger.log('Reminders: season closed — exiting.'); return; }

  const week = getCurrentWeek();
  const unpaid = unpaidRecruits_();          // live re-query at send time
  Logger.log('Reminders: week ' + week + ', ' + unpaid.length + ' unpaid.');

  unpaid.forEach(r => {
    try { sendOne_(r, week); }
    catch (e){ Logger.log('Reminder send failed for ' + r.rid + ': ' + e); }
  });
}

// Dashboard "Nudge Now" — one immediate send to one recruit (ignores schedule,
// still respects pause + only sends if actually unpaid).
function nudgeRecruit_(rid){
  if (isPaused_()) return { ok: false, msg: 'Reminders are paused.' };
  const r = unpaidRecruits_().filter(x => x.rid === rid)[0];
  if (!r) return { ok: false, msg: 'That recruit is already paid up for this week.' };
  sendOne_(r, getCurrentWeek());
  return { ok: true, msg: 'Nudge sent to ' + r.name + '.' };
}

function sendOne_(r, week){
  if (!r.email) { Logger.log('No email for ' + r.rid); return; }
  const tmpl = buildEmail_(r, week);
  GmailApp.sendEmail(r.email, tmpl.subject, tmpl.text, {
    name: KITTY_TITLE,
    htmlBody: tmpl.html
  });
  Logger.log('Sent week ' + week + ' reminder to ' + r.name + ' <' + r.email + '> at ' + nowStamp_());
}

/* Email template — HTML + plain text.
 * The Venmo button opens the app with the amount AND the note ("Kitty R012")
 * already filled in, so the tracker credits it even from someone else's
 * account. Every method on the PaymentMethods tab is listed. */
function buildEmail_(r, week){
  const first = (r.name || 'Recruit').split(/\s+/)[0];
  const owed = r.owed.toFixed(2);
  const weeksBehind = Math.max(1, Math.ceil(r.owed / WEEKLY_DUES));
  const subject = KITTY_TITLE + ' — Week ' + week + ' dues ($' + owed + ' to get current)';
  const code = payCode_(r.rid), note = payNote_([r.rid]);
  const link = venmoPayLink_([r.rid], r.owed);
  const methods = getPaymentMethods_();

  const methodText = m => m.name === 'Venmo'
    ? 'Venmo — tap: ' + link + '\n      (or send to ' + (m.sendTo || COLLECTOR_VENMO) + ' with the note: ' + note + ')'
    : m.name + (m.sendTo ? ' — ' + m.sendTo : '') + (m.instructions ? ' — ' + m.instructions : '');
  const methodHtml = m => m.name === 'Venmo'
    ? '<li>Venmo — use the button above, or send to <b>' + esc_(m.sendTo || COLLECTOR_VENMO) +
        '</b> with the note <b>' + esc_(note) + '</b>.</li>'
    : '<li>' + esc_(m.name) + (m.sendTo ? ' — <b>' + esc_(m.sendTo) + '</b>' : '') +
        (m.instructions ? ' — ' + esc_(m.instructions) : '') + '</li>';

  const text =
    'Hey ' + first + ',\n\n' +
    'Quick reminder on the academy snack kitty. We\'re on week ' + week + ' of ' + SEASON_WEEKS + '.\n' +
    'You\'re behind by ' + weeksBehind + ' week' + (weeksBehind === 1 ? '' : 's') + ' — $' + owed + ' gets you current.\n\n' +
    'Your pay code is ' + code + '. Put "' + note + '" in the Venmo note and it\'s credited to you\n' +
    'automatically, even if you pay from someone else\'s account.\n' +
    'Paying for friends too? Add their codes: "' + PAY_NOTE_PREFIX + ' ' + code + ' R0xx R0yy".\n\n' +
    'How to pay:\n' +
    methods.map(m => '  • ' + methodText(m)).join('\n') + '\n\n' +
    'You can also prepay the rest of the season ($' + TOTAL_PER_RECRUIT.toFixed(2) + ' total) and never hear from this reminder again.\n\n' +
    (VOTING_SITE_URL ? 'Kitty home page + snack vote: ' + homeUrlSafe_() + '\n\n' : '') +
    '— ' + KITTY_TITLE;

  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#15171B;line-height:1.5;max-width:520px">' +
      '<p style="margin:0 0 12px">Hey ' + esc_(first) + ',</p>' +
      '<p style="margin:0 0 12px">Quick reminder on the academy snack kitty — we\'re on <b>week ' + week + ' of ' + SEASON_WEEKS + '</b>.</p>' +
      '<p style="margin:0 0 12px">You\'re behind by <b>' + weeksBehind + ' week' + (weeksBehind === 1 ? '' : 's') + '</b>. ' +
        '<b>$' + owed + '</b> gets you current.</p>' +
      '<table cellpadding="0" cellspacing="0" style="margin:0 0 8px"><tr><td style="background:#C8102E;border-radius:8px">' +
        '<a href="' + esc_(link) + '" style="display:inline-block;color:#fff;font-weight:bold;padding:11px 18px;text-decoration:none">' +
        'Pay $' + owed + ' on Venmo</a></td></tr></table>' +
      '<p style="margin:0 0 12px;font-size:13px;color:#555">Opens Venmo with the amount and note filled in. ' +
        'Keep the note <b>' + esc_(note) + '</b> — that\'s what credits it to you, even from someone else\'s account.</p>' +
      '<p style="margin:0 0 12px;font-size:13px;color:#555">Your pay code: <b style="color:#15171B">' + esc_(code) + '</b>. ' +
        'Covering friends too? Add their codes to the note: <b>' + esc_(PAY_NOTE_PREFIX + ' ' + code) + ' R0xx R0yy</b>.</p>' +
      '<p style="margin:0 0 6px"><b>Other ways to pay</b></p>' +
      '<ul style="margin:0 0 12px;padding-left:20px">' + methods.map(methodHtml).join('') + '</ul>' +
      '<p style="margin:0 0 12px;color:#555">Prefer to be done? Prepay the rest of the season ($' +
        TOTAL_PER_RECRUIT.toFixed(2) + ' total) and these stop entirely.</p>' +
      (VOTING_SITE_URL ? '<p style="margin:14px 0 0;font-size:13px;color:#888">' +
        '<a href="' + esc_(homeUrlSafe_()) + '" style="color:#C8102E">Kitty home page + snack vote</a></p>' : '') +
      '<p style="margin:4px 0 0;font-size:13px;color:#888">— ' + esc_(KITTY_TITLE) + '</p>' +
    '</div>';

  return { subject: subject, text: text, html: html };
}

function esc_(s){
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

/* Home page link for emails: the sign-up-aware one when there's a form. */
function homeUrlSafe_(){
  try { return homeLink_() || VOTING_SITE_URL; } catch (e){ return VOTING_SITE_URL; }
}

/*  Reminders.gs — the send engine + email templates.
 *  Every send re-queries the live sheet and emails ONLY currently-unpaid
 *  recruits. Respects the global PAUSE toggle and the season window. */

// Bound to every reminder trigger (see Triggers.gs).
function sendRemindersNow(){
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
    name: 'PHX FD Academy Kitty',
    htmlBody: tmpl.html
  });
  Logger.log('Sent week ' + week + ' reminder to ' + r.name + ' <' + r.email + '> at ' + nowStamp_());
}

/* Email template — HTML + plain text. */
function buildEmail_(r, week){
  const first = (r.name || 'Recruit').split(/\s+/)[0];
  const owed = r.owed.toFixed(2);
  const weeksBehind = Math.max(1, Math.ceil(r.owed / WEEKLY_DUES));
  const subject = 'PHX FD Kitty — Week ' + week + ' dues ($' + owed + ' to get current)';

  const text =
    'Hey ' + first + ',\n\n' +
    'Quick reminder on the academy snack kitty. We\'re on week ' + week + ' of ' + SEASON_WEEKS + '.\n' +
    'You\'re behind by ' + weeksBehind + ' week' + (weeksBehind === 1 ? '' : 's') + ' — $' + owed + ' gets you current.\n\n' +
    'How to pay:\n' +
    '  • Cash — hand it to the academy kitty lead.\n' +
    '  • Venmo — send to ' + VENMO_HANDLE + ' on Venmo (note your full name).\n\n' +
    'You can also prepay the rest of the season ($' + TOTAL_PER_RECRUIT.toFixed(2) + ' total) and never hear from this reminder again.\n\n' +
    'Cast your snack vote here: ' + VOTING_SITE_URL + '\n\n' +
    '— PHX FD Academy Kitty';

  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#15171B;line-height:1.5;max-width:520px">' +
      '<p style="margin:0 0 12px">Hey ' + esc_(first) + ',</p>' +
      '<p style="margin:0 0 12px">Quick reminder on the academy snack kitty — we\'re on <b>week ' + week + ' of ' + SEASON_WEEKS + '</b>.</p>' +
      '<p style="margin:0 0 12px">You\'re behind by <b>' + weeksBehind + ' week' + (weeksBehind === 1 ? '' : 's') + '</b>. ' +
        '<b>$' + owed + '</b> gets you current.</p>' +
      '<table cellpadding="0" cellspacing="0" style="margin:0 0 12px"><tr><td style="background:#C8102E;color:#fff;' +
        'font-weight:bold;padding:10px 16px;border-radius:8px">$' + owed + ' to catch up</td></tr></table>' +
      '<p style="margin:0 0 6px"><b>How to pay</b></p>' +
      '<ul style="margin:0 0 12px;padding-left:20px">' +
        '<li>Cash — hand it to the academy kitty lead.</li>' +
        '<li>Venmo — send to <b>' + esc_(VENMO_HANDLE) + '</b> on Venmo (put your full name in the note).</li>' +
      '</ul>' +
      '<p style="margin:0 0 12px;color:#555">Prefer to be done? Prepay the rest of the season ($' +
        TOTAL_PER_RECRUIT.toFixed(2) + ' total) and these stop entirely.</p>' +
      '<p style="margin:14px 0 0;font-size:13px;color:#888">Cast your snack vote here: ' +
        '<a href="' + esc_(VOTING_SITE_URL) + '" style="color:#C8102E">' + esc_(VOTING_SITE_URL) + '</a></p>' +
      '<p style="margin:4px 0 0;font-size:13px;color:#888">— PHX FD Academy Kitty</p>' +
    '</div>';

  return { subject: subject, text: text, html: html };
}

function esc_(s){
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

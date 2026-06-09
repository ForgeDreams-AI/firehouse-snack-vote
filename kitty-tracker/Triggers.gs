/*  Triggers.gs — run installTriggers() ONCE from the editor to schedule
 *  everything. Safe to re-run; it clears its own triggers first. */

function installTriggers(){
  removeTriggers();   // avoid duplicates

  // Venmo parser, every 15 minutes.
  ScriptApp.newTrigger('parseVenmoInbox').timeBased().everyMinutes(GMAIL_POLL_MINUTES).create();

  // Reminder slots (one weekly trigger per [weekday, hour, minute]).
  const wd = ScriptApp.WeekDay;
  REMINDER_SLOTS.forEach(slot => {
    ScriptApp.newTrigger('sendRemindersNow')
      .timeBased()
      .onWeekDay(wd[slot[0]])
      .atHour(slot[1])
      .nearMinute(slot[2])
      .create();
  });

  const msg = 'Installed ' + (REMINDER_SLOTS.length) + ' reminder triggers + 1 Gmail poller. '
            + 'Timezone: ' + Session.getScriptTimeZone() + '. '
            + 'Note: Apps Script fires time triggers within ~15 min of the target time.';
  Logger.log(msg);
  return msg;
}

function removeTriggers(){
  ScriptApp.getProjectTriggers().forEach(t => {
    const fn = t.getHandlerFunction();
    if (fn === 'sendRemindersNow' || fn === 'parseVenmoInbox') ScriptApp.deleteTrigger(t);
  });
}

function listTriggers(){
  const lines = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction() + ' (' + t.getEventType() + ')');
  Logger.log(lines.join('\n') || 'No triggers installed.');
  return lines;
}

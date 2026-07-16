/*  FixMisassigned.gs — ONE-TIME repair for hand-assignment mistakes.
 *
 *  Six Venmo payments were credited to the wrong recruit while clearing the
 *  review queue. This re-points each one (by its Venmo transaction ID in the
 *  Source column) to the person it was actually FOR. Backs up the Ledger first;
 *  only these six Source IDs are touched. Safe to re-run (already-correct rows
 *  are left alone). Delete this file after it runs clean.
 *
 *  Run from the editor: function dropdown → fixMisassignedPayments → Run. */
function fixMisassignedPayments(){
  ensureSchema_();
  const ss  = ss_();
  const led = sheet_(LEDGER_TAB);
  led.copyTo(ss).setName('Ledger_bak_' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd-HHmmss'));

  // source (Venmo txn ID) -> correct { rid, name }
  const FIX = {
    '4617897150981972818': { rid: 'R040', name: 'Micah Barnett' },              // Micah's own 6/12 pmt (was on Anthony Abruzzini)
    '4618218381417888800': { rid: 'R028', name: 'Ricardo Garcia' },             // Landon "this is for rico"
    '4623225787159868555': { rid: 'R028', name: 'Ricardo Garcia' },             // Landon "for rico"
    '4633551197559280577': { rid: 'R028', name: 'Ricardo Garcia' },             // Landon "for rico" $40
    '4618225997048994747': { rid: 'R012', name: 'William Kent Wickware II' },   // Landon "this is for will"
    '4635592227632104942': { rid: 'R012', name: 'William Kent Wickware II' }    // Landon "for will rest of academy" $220
  };

  const last = led.getLastRow();
  if (last < 2) return 'Ledger empty — nothing to fix.';
  const rng  = led.getRange(2, 1, last - 1, LEDGER_HEADERS.length);
  const vals = rng.getValues();

  const log = [];
  vals.forEach(row => {
    const src = String(row[LED.SOURCE - 1]).trim();
    const fix = FIX[src];
    if (!fix) return;
    const before = String(row[LED.NAME - 1]).trim();
    if (String(row[LED.RID - 1]).trim() === fix.rid) return;   // already correct
    row[LED.RID - 1]   = fix.rid;
    row[LED.NAME - 1]  = fix.name;
    row[LED.SPLIT - 1] = '';                                    // drop any stale split-group tag
    row[LED.REVIEW - 1] = REVIEW_GOOD;
    log.push('$' + row[LED.AMOUNT - 1] + '  ' + (before || '(blank)') + ' -> ' + fix.name);
  });

  rng.setValues(vals);   // single write-back
  return log.length
    ? ('Fixed ' + log.length + ' row(s):\n' + log.join('\n') +
       '\n\nMicah now $100, Ricardo $120, Wickware $280 (paid in full), Landon back to $120. Backup tab created.')
    : 'Nothing to change — all six rows are already correct.';
}

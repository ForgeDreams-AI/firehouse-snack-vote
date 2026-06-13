/*  ImportVenmoStatement.gs — ONE-TIME loader for the June 2026 Venmo statement.
 *
 *  Use this when the 15-min email poller ISN'T running and you want to load a
 *  downloaded Venmo CSV straight into the Ledger under the current rules
 *  (note-wins matching in matchRecruit_ + whole-week auto-credit in isWholeWeeks_).
 *
 *  What it does, in order:
 *    1. Backs up the WHOLE Ledger to a timestamped tab (fully reversible).
 *    2. Deletes existing **Venmo** rows only — cash and any other method stay.
 *    3. Re-loads every statement line, stamped with its real payment date,
 *       crediting the right recruit / routing to review per the rules.
 *
 *  It's re-runnable: each run wipes Venmo + reloads, so totals never double up.
 *  Source column = the Venmo transaction ID (idempotency / audit key).
 *
 *  Run from the editor: function dropdown → importVenmoStatement → Run.
 *  Delete this file once the month is loaded and you've switched the poller on. */

// Per-transaction overrides for lines the rules can't read from the note alone.
//   creditTo → force-credit this recruit (looked up against the roster)
//   review   → force into the review queue for manual assignment
const VENMO_IMPORT_OVERRIDES_ = {
  '4611162632783592276': { creditTo: 'Anthony Hidalgo' }, // Logan Abele "Test" → covering Anthony Hidalgo
  '4617571315889341468': { review: true },                // Lawrence Nunez $40 "myself and Carson" → split by hand
  '4618218381417888800': { review: true },                // Landon Gillespie "this is for rico" → assign by hand
  '4618225997048994747': { review: true }                 // Landon Gillespie "this is for will" → assign by hand
};

// The statement, chronological. { id, ts, note, from, amount }
const VENMO_JUNE_2026_ = [
  { id: '4611162632783592276', ts: '2026-06-03 04:37:01', note: 'Test',                                   from: 'Logan Abele',          amount: 20 },
  { id: '4611357640479728964', ts: '2026-06-03 11:04:28', note: 'Kitty',                                  from: 'Dylan Yeager',         amount: 20 },
  { id: '4611669825849057892', ts: '2026-06-03 21:24:43', note: 'Ryan Johnson',                           from: 'Ryan Johnson',         amount: 20 },
  { id: '4611688517956811193', ts: '2026-06-03 22:01:51', note: 'Ethan Buckhardt',                        from: 'Ethan Buckhardt',      amount: 20 },
  { id: '4611690621794557933', ts: '2026-06-03 22:06:02', note: 'kitty',                                  from: 'damon nguyen',         amount: 300 },
  { id: '4611696871911961183', ts: '2026-06-03 22:18:27', note: 'Devyn O’Brien 🚒',        from: 'devyn obrien',         amount: 20 },
  { id: '4611816961638246243', ts: '2026-06-04 02:17:03', note: 'Kendrick Pulce & Anthony Abruzzini',     from: 'Kendrick Pulce',       amount: 40 },
  { id: '4611847776493541900', ts: '2026-06-04 03:18:16', note: 'Jacob Fretto',                           from: 'Jake Fretto',          amount: 20 },
  { id: '4612157690956967101', ts: '2026-06-04 13:34:01', note: 'Kitty',                                  from: 'Rayce Nichols',        amount: 100 },
  { id: '4612198906411468380', ts: '2026-06-04 14:55:54', note: 'Megan Hedlund 26.2',                     from: 'Megan Hedlund',        amount: 300 },
  { id: '4612265771678854010', ts: '2026-06-04 17:08:45', note: 'Kitty',                                  from: 'CJ CJ Curry',          amount: 20 },
  { id: '4612268074318063114', ts: '2026-06-04 17:13:20', note: 'Conner Kitterman kitty payment',        from: 'Conner Kitterman',     amount: 20 },
  { id: '4612268553945161818', ts: '2026-06-04 17:14:17', note: '🐈',                           from: 'Tyler Maguire',        amount: 20 },
  { id: '4612268833478642849', ts: '2026-06-04 17:14:50', note: 'Kitty',                                  from: 'Jakob Hernandez',      amount: 20 },
  { id: '4612269200707012261', ts: '2026-06-04 17:15:34', note: 'Kitty',                                  from: 'Nicholas Tamborrino',  amount: 20 },
  { id: '4612327763953123402', ts: '2026-06-04 19:11:55', note: 'Jacob Mulligan',                         from: 'Jacob Mulligan',       amount: 20 },
  { id: '4612476126686296310', ts: '2026-06-05 00:06:42', note: 'Ryan Giordano',                          from: 'Ryan Giordano',        amount: 20 },
  { id: '4612820353601548290', ts: '2026-06-05 11:30:37', note: 'Ryan Flores',                            from: 'Ryan Flores',          amount: 20 },
  { id: '4612840435416818364', ts: '2026-06-05 12:10:31', note: 'Kitty🍕',                      from: 'Caleb Smyers',         amount: 20 },
  { id: '4612840494900314418', ts: '2026-06-05 12:10:38', note: 'Dylan Urquilla',                         from: 'Dylan Urquilla',       amount: 20 },
  { id: '4612840529696798717', ts: '2026-06-05 12:10:42', note: 'Kitty',                                  from: 'Anthony Weidner',      amount: 300 },
  { id: '4612842369913609968', ts: '2026-06-05 12:14:21', note: 'Kitty',                                  from: 'Branson Mitchell',     amount: 20 },
  { id: '4612842602521306205', ts: '2026-06-05 12:14:49', note: 'chow',                                   from: 'Jack Shreiber',        amount: 20 },
  { id: '04L26857Y30961420',  ts: '2026-06-05 12:19:01', note: '🍕',                            from: 'Fred Miller',          amount: 20 },
  { id: '4612844792711652445', ts: '2026-06-05 12:19:10', note: ':venmo_dollar:',                         from: 'Landon Gillespie',     amount: 20 },
  { id: '4612845013256243579', ts: '2026-06-05 12:19:36', note: 'Kitty',                                  from: 'Christopher Phillips', amount: 300 },
  { id: '4612854458929993298', ts: '2026-06-05 12:38:22', note: 'JEFF OHM KITTY',                         from: 'Jeff Ohm',             amount: 20 },
  { id: '4612908474787953955', ts: '2026-06-05 14:25:42', note: 'Dj miles',                               from: 'Dj Miles',             amount: 20 },
  { id: '4612908839004125756', ts: '2026-06-05 14:26:25', note: 'Week 0 kitty',                           from: 'Micah Barnett',        amount: 20 },
  { id: '4612909778192670527', ts: '2026-06-05 14:28:17', note: ':venmo_dollar:',                         from: 'Landon Gillespie',     amount: 20 },
  { id: '4612909864058835520', ts: '2026-06-05 14:28:27', note: 'Kitty',                                  from: 'Pat Brannan',          amount: 300 },
  { id: '4612910428117070976', ts: '2026-06-05 14:29:34', note: 'Kyle Davis, Colton Mendez, Ivan Hernandez meow', from: 'Kendrick Pulce', amount: 60 },
  { id: '4612929994502701157', ts: '2026-06-05 15:08:27', note: '50 cash 10 Venmo=$60 total',            from: 'Joshua Salvatierra',   amount: 10 },
  { id: '4612932178401852179', ts: '2026-06-05 15:12:47', note: 'Carson Reilly Kitty',                    from: 'Lawrence Nunez',       amount: 20 },
  { id: '4613018318534398571', ts: '2026-06-05 18:03:56', note: 'Kitty',                                  from: 'Jade Valdez',          amount: 20 },
  { id: '4613046751771744745', ts: '2026-06-05 19:00:25', note: 'DJ Olmstead',                            from: 'DJ Olmstead',          amount: 20 },
  { id: '4613048611987050867', ts: '2026-06-05 19:04:07', note: 'William Sayle',                          from: 'William Sayle',        amount: 20 },
  { id: '4616110101115818956', ts: '2026-06-10 00:26:45', note: 'Jacob Fretto',                           from: 'Jake Fretto',          amount: 20 },
  { id: '4616111073028702021', ts: '2026-06-10 00:28:41', note: 'Ryan Johnson',                           from: 'Ryan Johnson',         amount: 20 },
  { id: '4616435646290530894', ts: '2026-06-10 11:13:33', note: 'kitty',                                  from: 'Jack Shreiber',        amount: 20 },
  { id: '4616436812390986484', ts: '2026-06-10 11:15:52', note: 'Kendrick 🐱',                  from: 'Kendrick Pulce',       amount: 20 },
  { id: '59E59339SL4826500',  ts: '2026-06-10 14:04:33', note: 'Kitty',                                  from: 'Conner Kitterman',     amount: 20 },
  { id: '4616525169674355631', ts: '2026-06-10 14:11:25', note: 'Ethan Buckhardt',                        from: 'Ethan Buckhardt',      amount: 20 },
  { id: '4616839178079993723', ts: '2026-06-11 00:35:18', note: 'Kitty',                                  from: 'William Sayle',        amount: 20 },
  { id: '4617475041873004171', ts: '2026-06-11 21:38:39', note: '🚒🐈',              from: 'Dylan Yeager',         amount: 20 },
  { id: '4617490149512633955', ts: '2026-06-11 22:08:40', note: 'Kitty',                                  from: 'Jakob Hernandez',      amount: 20 },
  { id: '4617504962260082142', ts: '2026-06-11 22:38:06', note: 'DJ Olmstead',                            from: 'DJ Olmstead',          amount: 20 },
  { id: '9AS98842TS425535B',  ts: '2026-06-11 22:54:53', note: 'Kittyyyy',                               from: 'Ryan Flores',          amount: 20 },
  { id: '4617547998083242145', ts: '2026-06-12 00:03:36', note: 'Kitty',                                  from: 'Ryan Giordano',        amount: 20 },
  { id: '4617570673422134976', ts: '2026-06-12 00:48:39', note: 'For that kitty kitty',                  from: 'Branson Mitchell',     amount: 20 },
  { id: '4617570715641787100', ts: '2026-06-12 00:48:44', note: 'Kitty',                                  from: 'Nicholas Tamborrino',  amount: 20 },
  { id: '4617570949466184701', ts: '2026-06-12 00:49:12', note: 'Kitty',                                  from: 'Jacob Mulligan',       amount: 20 },
  { id: '4617571056865466719', ts: '2026-06-12 00:49:25', note: 'Kitty',                                  from: 'CJ CJ Curry',          amount: 20 },
  { id: '4617571315889341468', ts: '2026-06-12 00:49:56', note: 'Kitty🐈 myself and Carson',    from: 'Lawrence Nunez',       amount: 40 },
  { id: '4617572021706600909', ts: '2026-06-12 00:51:20', note: ':venmo_dollar:',                         from: 'Landon Gillespie',     amount: 20 },
  { id: '4617576006311731414', ts: '2026-06-12 00:59:15', note: 'Kitty',                                  from: 'Mason Jones',          amount: 20 },
  { id: '4617584121065749337', ts: '2026-06-12 01:15:22', note: 'Anthony Abruzzini 🐱',         from: 'Kendrick Pulce',       amount: 20 },
  { id: '4617897150981972818', ts: '2026-06-12 11:37:18', note: '6/12/26',                                from: 'Micah Barnett',        amount: 20 },
  { id: '4618108455806349862', ts: '2026-06-12 18:37:08', note: 'Caleb Smyers Kitty',                     from: 'Caleb Smyers',         amount: 20 },
  { id: '4618114758704966085', ts: '2026-06-12 18:49:39', note: 'Kitty',                                  from: 'Dylan Urquilla',       amount: 20 },
  { id: '4618162217909274069', ts: '2026-06-12 20:23:57', note: 'Isen Buntz kitty',                       from: 'Jacob Mulligan',       amount: 20 },
  { id: '4618168360374608888', ts: '2026-06-12 20:36:09', note: 'Humberto R’s kitty 💵',   from: 'Nicholas Tamborrino',  amount: 20 },
  { id: '4618169733162239984', ts: '2026-06-12 20:38:52', note: 'Kyle Davis, Ivan Hernandez 🐱', from: 'Kendrick Pulce',      amount: 40 },
  { id: '4618173474808115908', ts: '2026-06-12 20:46:19', note: '🐱',                           from: 'Tyler Maguire',        amount: 20 },
  { id: '4618177737329123378', ts: '2026-06-12 20:54:47', note: 'Kitty',                                  from: 'Jade Valdez',          amount: 20 },
  { id: '51W410692A2201747',  ts: '2026-06-12 21:28:12', note: 'Kitty',                                  from: 'Jeff Ohm',             amount: 20 },
  { id: '4618202924577109139', ts: '2026-06-12 21:44:49', note: '🚒',                           from: 'devyn obrien',         amount: 20 },
  { id: '4618218381417888800', ts: '2026-06-12 22:15:32', note: 'this is for rico',                       from: 'Landon Gillespie',     amount: 20 },
  { id: '4618225997048994747', ts: '2026-06-12 22:30:40', note: 'this is for will',                       from: 'Landon Gillespie',     amount: 20 }
];

function importVenmoStatement(){
  ensureSchema_();
  const ss  = ss_();
  const led = sheet_(LEDGER_TAB);

  // 1) Back up the whole Ledger.
  const backupName = 'Ledger_bak_' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd-HHmmss');
  led.copyTo(ss).setName(backupName);

  // 2) Remove existing Venmo rows (cash + any other method untouched). Bottom-up
  //    so row numbers don't shift mid-delete.
  getLedger_()
    .filter(e => e.method.toLowerCase() === 'venmo')
    .map(e => e.row)
    .sort((a, b) => b - a)
    .forEach(r => led.deleteRow(r));

  // 3) Load the statement in date order under the current rules.
  const roster = activeRoster_();
  let credited = 0, review = 0;
  const overrideNotes = [];

  VENMO_JUNE_2026_.forEach(t => {
    const parsed = { payer: t.from, amount: t.amount, handle: '', memo: t.note };
    const ov = VENMO_IMPORT_OVERRIDES_[t.id];

    let rid = '', name = '', isReview;
    if (ov && ov.review){
      isReview = true;
      overrideNotes.push(t.from + ' $' + t.amount + ' → review (manual)');
    } else if (ov && ov.creditTo){
      const m = matchRecruit_({ payer: ov.creditTo, amount: t.amount, handle: '', memo: '' }, roster);
      if (m){ rid = m.rid; name = m.name; isReview = false; overrideNotes.push(t.from + ' $' + t.amount + ' → credited ' + m.name); }
      else  { isReview = true;            overrideNotes.push(t.from + ' $' + t.amount + ' → review (could not find "' + ov.creditTo + '" on roster)'); }
    } else {
      const match = matchRecruit_(parsed, roster);
      isReview = !(match && isWholeWeeks_(t.amount));
      if (!isReview){ rid = match.rid; name = match.name; }
    }

    appendPayment_(rid, name, 'Venmo', t.amount, t.id, isReview,
      { payer: t.from, memo: t.note, ts: t.ts });
    if (isReview) review++; else credited++;
  });

  return 'Imported ' + VENMO_JUNE_2026_.length + ' Venmo payments: backup tab "' + backupName + '" · ' +
         credited + ' auto-credited, ' + review + ' to review. Cash untouched.\n' +
         'Overrides: ' + (overrideNotes.length ? overrideNotes.join('; ') : 'none');
}

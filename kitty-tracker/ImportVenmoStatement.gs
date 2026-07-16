/*  ImportVenmoStatement.gs — authoritative loader for the Venmo statement.
 *
 *  Rebuilds the Venmo side of the Ledger from the downloaded statement, keyed by
 *  Venmo transaction ID. Credits the SENDER (never the note — that's what caused
 *  the mis-credit mess). The 23 "paying-for-someone-else / split / odd" payments
 *  are routed to Review so you assign them by hand.
 *
 *  Order to run once:
 *    1. importVenmoStatement()            → wipes Venmo rows (cash kept), reloads
 *    2. markVenmoProcessedThroughCutoff() → stops the poller re-adding these
 *  Backs the Ledger up first. Cash + other methods are never touched. */

/* Label every Venmo "paid you" receipt through the statement cutoff as processed,
 * so the 15-min poller skips them and only ingests NEW payments after. */
function markVenmoProcessedThroughCutoff(){
  const label = getOrCreateLabel_(PROCESSED_LABEL);
  const threads = GmailApp.search('from:' + VENMO_SENDER + ' (subject:("paid you") OR "paid you") before:2026/07/16', 0, 400);
  threads.forEach(t => t.addLabel(label));
  return 'Labeled ' + threads.length + ' Venmo threads processed (through 7/15). The poller will now only pick up payments dated 7/16 onward.';
}

/* REPAIR (kept for safety): move any Venmo row wrongly credited to the collector
 * back to the real sender (or Review if unmatched). Backs up first. Safe to re-run. */
function fixMiscreditedCollectorRows(){
  ensureSchema_();
  const ss  = ss_();
  const led = sheet_(LEDGER_TAB);
  led.copyTo(ss).setName('Ledger_bak_' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd-HHmmss'));
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const roster = activeRoster_();
  const collector = roster.filter(r => norm(r.name) === norm(COLLECTOR_NAME))[0];
  if (!collector) return 'Collector "' + COLLECTOR_NAME + '" not found on the roster — nothing done.';
  let fixed = 0, toReview = 0;
  getLedger_().forEach(e => {
    if (e.review || e.method !== 'Venmo' || e.rid !== collector.rid) return;
    if (!e.payer || norm(e.payer) === norm(COLLECTOR_NAME)) return;
    if (norm(e.payer) === 'logan abele') return;
    const m = matchRecruit_({ payer: e.payer, amount: e.amount, handle: '', memo: '' }, roster);
    if (m){ led.getRange(e.row, LED.RID).setValue(m.rid); led.getRange(e.row, LED.NAME).setValue(m.name); fixed++; }
    else { led.getRange(e.row, LED.RID).setValue(''); led.getRange(e.row, LED.NAME).setValue(''); led.getRange(e.row, LED.WEEK).setValue(''); led.getRange(e.row, LED.REVIEW).setValue(REVIEW_BAD); toReview++; }
  });
  return 'Repair done: ' + fixed + ' re-credited, ' + toReview + ' sent to Review. Backup tab created.';
}

// ── Statement data ───────────────────────────────────────────────────────────
// VENMO_REVIEW_IDS_: transaction IDs that must go to Review (paid-for-others,
// multi-person splits, odd amounts, off-roster sender). Everything else is
// auto-credited to the SENDER.
const VENMO_REVIEW_IDS_ = {
  '4611162632783592276': 1,
  '4611816961638246243': 1,
  '4612910428117070976': 1,
  '4612929994502701157': 1,
  '4612932178401852179': 1,
  '4617571315889341468': 1,
  '4617584121065749337': 1,
  '4618162217909274069': 1,
  '4618169733162239984': 1,
  '4621924168925922523': 1,
  '4622567585854852259': 1,
  '4622576286552131442': 1,
  '4623881893620522906': 1,
  '4627294354776196323': 1,
  '4628325813536413130': 1,
  '4628341052416115234': 1,
  '4629012108080246941': 1,
  '4632394546634341307': 1,
  '4632563783654451399': 1,
  '4635574881593701550': 1,
  '4635577952653911108': 1,
  '4635652916711330550': 1,
  '4638386658991217254': 1,
};

const VENMO_STATEMENT_ = [
  { id: '4611162632783592276', ts: '2026-06-03 04:37:01', from: 'Logan Abele', amount: 20, note: 'Test' },
  { id: '4611357640479728964', ts: '2026-06-03 11:04:28', from: 'Dylan Yeager', amount: 20, note: 'Kitty' },
  { id: '4611669825849057892', ts: '2026-06-03 21:24:43', from: 'Ryan Johnson', amount: 20, note: 'Ryan Johnson' },
  { id: '4611688517956811193', ts: '2026-06-03 22:01:51', from: 'Ethan Buckhardt', amount: 20, note: 'Ethan Buckhardt' },
  { id: '4611690621794557933', ts: '2026-06-03 22:06:02', from: 'damon nguyen', amount: 300, note: 'kitty' },
  { id: '4611696871911961183', ts: '2026-06-03 22:18:27', from: 'devyn obrien', amount: 20, note: 'Devyn O’Brien 🚒' },
  { id: '4611816961638246243', ts: '2026-06-04 02:17:03', from: 'Kendrick Pulce', amount: 40, note: 'Kendrick Pulce & Anthony Abruzzini 🐱🐱🐱🐱🐱' },
  { id: '4611847776493541900', ts: '2026-06-04 03:18:16', from: 'Jake Fretto', amount: 20, note: 'Jacob Fretto' },
  { id: '4612157690956967101', ts: '2026-06-04 13:34:01', from: 'Rayce Nichols', amount: 100, note: 'Kitty' },
  { id: '4612198906411468380', ts: '2026-06-04 14:55:54', from: 'Megan Hedlund', amount: 300, note: 'Megan Hedlund 26.2' },
  { id: '4612265771678854010', ts: '2026-06-04 17:08:45', from: 'CJ CJ Curry', amount: 20, note: 'Kitty' },
  { id: '4612268074318063114', ts: '2026-06-04 17:13:20', from: 'Conner Kitterman', amount: 20, note: 'Conner Kitterman kitty payment' },
  { id: '4612268553945161818', ts: '2026-06-04 17:14:17', from: 'Tyler Maguire', amount: 20, note: '🐈' },
  { id: '4612268833478642849', ts: '2026-06-04 17:14:50', from: 'Jakob Hernandez', amount: 20, note: 'Kitty' },
  { id: '4612269200707012261', ts: '2026-06-04 17:15:34', from: 'Nicholas Tamborrino', amount: 20, note: 'Kitty' },
  { id: '4612327763953123402', ts: '2026-06-04 19:11:55', from: 'Jacob Mulligan', amount: 20, note: 'Jacob Mulligan' },
  { id: '4612476126686296310', ts: '2026-06-05 00:06:42', from: 'Ryan Giordano', amount: 20, note: 'Ryan Giordano' },
  { id: '4612820353601548290', ts: '2026-06-05 11:30:37', from: 'Ryan Flores', amount: 20, note: 'Ryan Flores 🐱🐱' },
  { id: '4612840435416818364', ts: '2026-06-05 12:10:31', from: 'Caleb Smyers', amount: 20, note: 'Kitty🍕' },
  { id: '4612840494900314418', ts: '2026-06-05 12:10:38', from: 'Dylan Urquilla', amount: 20, note: 'Dylan Urquilla' },
  { id: '4612840529696798717', ts: '2026-06-05 12:10:42', from: 'Anthony Weidner', amount: 300, note: 'Kitty' },
  { id: '4612842369913609968', ts: '2026-06-05 12:14:21', from: 'Branson Mitchell', amount: 20, note: 'Kitty' },
  { id: '4612842602521306205', ts: '2026-06-05 12:14:49', from: 'Jack Shreiber', amount: 20, note: 'chow' },
  { id: '04L26857Y30961420', ts: '2026-06-05 12:19:01', from: 'Fred Miller', amount: 20, note: '🍕' },
  { id: '4612844792711652445', ts: '2026-06-05 12:19:10', from: 'Landon Gillespie', amount: 20, note: ':venmo_dollar:' },
  { id: '4612845013256243579', ts: '2026-06-05 12:19:36', from: 'Christopher Phillips', amount: 300, note: 'Kitty' },
  { id: '4612854458929993298', ts: '2026-06-05 12:38:22', from: 'Jeff Ohm', amount: 20, note: 'JEFF OHM KITTY' },
  { id: '4612908474787953955', ts: '2026-06-05 14:25:42', from: 'Dj Miles', amount: 20, note: 'Dj miles' },
  { id: '4612908839004125756', ts: '2026-06-05 14:26:25', from: 'Micah Barnett', amount: 20, note: 'Week 0 kitty' },
  { id: '4612909778192670527', ts: '2026-06-05 14:28:17', from: 'Landon Gillespie', amount: 20, note: ':venmo_dollar:' },
  { id: '4612909864058835520', ts: '2026-06-05 14:28:27', from: 'Pat Brannan', amount: 300, note: 'Kitty' },
  { id: '4612910428117070976', ts: '2026-06-05 14:29:34', from: 'Kendrick Pulce', amount: 60, note: 'Kyle Davis, Colton Mendez, Ivan Hernandez meow' },
  { id: '4612929994502701157', ts: '2026-06-05 15:08:27', from: 'Joshua Salvatierra', amount: 10, note: '50 cash 10 Venmo=$60 total' },
  { id: '4612932178401852179', ts: '2026-06-05 15:12:47', from: 'Lawrence Nunez', amount: 20, note: 'Carson Reilly Kitty' },
  { id: '4613018318534398571', ts: '2026-06-05 18:03:56', from: 'Jade Valdez', amount: 20, note: 'Kitty' },
  { id: '4613046751771744745', ts: '2026-06-05 19:00:25', from: 'DJ Olmstead', amount: 20, note: 'DJ Olmstead' },
  { id: '4613048611987050867', ts: '2026-06-05 19:04:07', from: 'William Sayle', amount: 20, note: 'William Sayle' },
  { id: '4616110101115818956', ts: '2026-06-10 00:26:45', from: 'Jake Fretto', amount: 20, note: 'Jacob Fretto' },
  { id: '4616111073028702021', ts: '2026-06-10 00:28:41', from: 'Ryan Johnson', amount: 20, note: 'Ryan Johnson' },
  { id: '4616435646290530894', ts: '2026-06-10 11:13:33', from: 'Jack Shreiber', amount: 20, note: 'kitty' },
  { id: '4616436812390986484', ts: '2026-06-10 11:15:52', from: 'Kendrick Pulce', amount: 20, note: 'Kendrick 🐱' },
  { id: '59E59339SL4826500', ts: '2026-06-10 14:04:33', from: 'Conner Kitterman', amount: 20, note: 'Kitty' },
  { id: '4616525169674355631', ts: '2026-06-10 14:11:25', from: 'Ethan Buckhardt', amount: 20, note: 'Ethan Buckhardt' },
  { id: '4616839178079993723', ts: '2026-06-11 00:35:18', from: 'William Sayle', amount: 20, note: 'Kitty' },
  { id: '4617475041873004171', ts: '2026-06-11 21:38:39', from: 'Dylan Yeager', amount: 20, note: '🚒🐈' },
  { id: '4617490149512633955', ts: '2026-06-11 22:08:40', from: 'Jakob Hernandez', amount: 20, note: 'Kitty' },
  { id: '4617504962260082142', ts: '2026-06-11 22:38:06', from: 'DJ Olmstead', amount: 20, note: 'DJ Olmstead' },
  { id: '9AS98842TS425535B', ts: '2026-06-11 22:54:53', from: 'Ryan Flores', amount: 20, note: 'Kittyyyy' },
  { id: '4617547998083242145', ts: '2026-06-12 00:03:36', from: 'Ryan Giordano', amount: 20, note: 'Kitty' },
  { id: '4617570673422134976', ts: '2026-06-12 00:48:39', from: 'Branson Mitchell', amount: 20, note: 'For that kitty kitty' },
  { id: '4617570715641787100', ts: '2026-06-12 00:48:44', from: 'Nicholas Tamborrino', amount: 20, note: 'Kitty' },
  { id: '4617570949466184701', ts: '2026-06-12 00:49:12', from: 'Jacob Mulligan', amount: 20, note: 'Kitty' },
  { id: '4617571056865466719', ts: '2026-06-12 00:49:25', from: 'CJ CJ Curry', amount: 20, note: 'Kitty' },
  { id: '4617571315889341468', ts: '2026-06-12 00:49:56', from: 'Lawrence Nunez', amount: 40, note: 'Kitty🐈 myself and Carson' },
  { id: '4617572021706600909', ts: '2026-06-12 00:51:20', from: 'Landon Gillespie', amount: 20, note: ':venmo_dollar:' },
  { id: '4617576006311731414', ts: '2026-06-12 00:59:15', from: 'Mason Jones', amount: 20, note: 'Kitty' },
  { id: '4617584121065749337', ts: '2026-06-12 01:15:22', from: 'Kendrick Pulce', amount: 20, note: 'Anthony Abruzzini 🐱' },
  { id: '4617897150981972818', ts: '2026-06-12 11:37:18', from: 'Micah Barnett', amount: 20, note: '6/12/26' },
  { id: '4618108455806349862', ts: '2026-06-12 18:37:08', from: 'Caleb Smyers', amount: 20, note: 'Caleb Smyers Kitty' },
  { id: '4618114758704966085', ts: '2026-06-12 18:49:39', from: 'Dylan Urquilla', amount: 20, note: 'Kitty' },
  { id: '4618162217909274069', ts: '2026-06-12 20:23:57', from: 'Jacob Mulligan', amount: 20, note: 'Isen Buntz kitty' },
  { id: '4618168360374608888', ts: '2026-06-12 20:36:09', from: 'Nicholas Tamborrino', amount: 20, note: 'Humberto R’s kitty 💵' },
  { id: '4618169733162239984', ts: '2026-06-12 20:38:52', from: 'Kendrick Pulce', amount: 40, note: 'Kyle Davis, Ivan Hernandez 🐱' },
  { id: '4618173474808115908', ts: '2026-06-12 20:46:19', from: 'Tyler Maguire', amount: 20, note: '🐱' },
  { id: '4618177737329123378', ts: '2026-06-12 20:54:47', from: 'Jade Valdez', amount: 20, note: 'Kitty' },
  { id: '51W410692A2201747', ts: '2026-06-12 21:28:12', from: 'Jeff Ohm', amount: 20, note: 'Kitty' },
  { id: '4618202924577109139', ts: '2026-06-12 21:44:49', from: 'devyn obrien', amount: 20, note: '🚒' },
  { id: '4618218381417888800', ts: '2026-06-12 22:15:32', from: 'Landon Gillespie', amount: 20, note: 'this is for rico' },
  { id: '4618225997048994747', ts: '2026-06-12 22:30:40', from: 'Landon Gillespie', amount: 20, note: 'this is for will' },
  { id: '4618755054828993203', ts: '2026-06-13 16:01:48', from: 'Fred Miller', amount: 20, note: '🍕' },
  { id: '4619510385812868144', ts: '2026-06-14 17:02:31', from: 'Dj Miles', amount: 20, note: 'Kitty' },
  { id: '25M55040T9995981X', ts: '2026-06-17 00:42:40', from: 'Ryan Johnson', amount: 20, note: 'Ryan Johnson' },
  { id: '4621518769118540104', ts: '2026-06-17 11:32:49', from: 'Ethan Buckhardt', amount: 20, note: 'Ethan Buckhardt' },
  { id: '4621780022046922110', ts: '2026-06-17 20:11:52', from: 'Jake Fretto', amount: 20, note: 'Jacob Fretto' },
  { id: '4621792302851036331', ts: '2026-06-17 20:36:16', from: 'Landon Gillespie', amount: 20, note: ':venmo_dollar:' },
  { id: '4621871416509948004', ts: '2026-06-17 23:13:27', from: 'William Sayle', amount: 20, note: 'Kitty' },
  { id: '4621872898181386797', ts: '2026-06-17 23:16:24', from: 'Justin Sanchez', amount: 20, note: 'Kitty (Justin Sanchez)' },
  { id: '4621905403415912779', ts: '2026-06-18 00:20:59', from: 'Caleb Smyers', amount: 20, note: 'Caleb Smyers kitty' },
  { id: '4621924168925922523', ts: '2026-06-18 00:58:16', from: 'Kendrick Pulce', amount: 40, note: 'Colton Mendez 🐱' },
  { id: '4622190581325540051', ts: '2026-06-18 09:47:35', from: 'Jade Valdez', amount: 20, note: 'Kitty' },
  { id: '4622193090962996377', ts: '2026-06-18 09:52:34', from: 'Jack Shreiber', amount: 20, note: 'grub' },
  { id: '4622199882790745047', ts: '2026-06-18 10:06:04', from: 'CJ CJ Curry', amount: 20, note: 'Kitty' },
  { id: '7KG23145LS720550M', ts: '2026-06-18 13:56:58', from: 'Conner Kitterman', amount: 20, note: 'Kitty' },
  { id: '4622476668116380745', ts: '2026-06-18 19:15:59', from: 'Mason Jones', amount: 20, note: 'Kitty' },
  { id: '4622477650271321356', ts: '2026-06-18 19:17:56', from: 'Jacob Mulligan', amount: 20, note: '🐈' },
  { id: '4622478888094064658', ts: '2026-06-18 19:20:24', from: 'Fred Miller', amount: 20, note: '🍕' },
  { id: '4622479000275019668', ts: '2026-06-18 19:20:37', from: 'DJ Olmstead', amount: 20, note: 'DJ Olmstead' },
  { id: '4622516768934285585', ts: '2026-06-18 20:35:39', from: 'Dylan Urquilla', amount: 20, note: 'Kitty' },
  { id: '4622532040419927873', ts: '2026-06-18 21:06:00', from: 'Ryan Giordano', amount: 20, note: 'Kitty' },
  { id: '4622539325674540153', ts: '2026-06-18 21:20:28', from: 'Branson Mitchell', amount: 20, note: '😺' },
  { id: '4622567585854852259', ts: '2026-06-18 22:16:37', from: 'devyn obrien', amount: 40, note: 'Kitty devyn and Bailey' },
  { id: '95U05200S17268034', ts: '2026-06-18 22:26:20', from: 'Humberto Rodriguez', amount: 20, note: 'Kitty' },
  { id: '4622576286552131442', ts: '2026-06-18 22:33:55', from: 'Lawrence Nunez', amount: 40, note: 'Kitty for me and Carson 🐈' },
  { id: '4622684632739476100', ts: '2026-06-19 02:09:10', from: 'Alex Mendez', amount: 20, note: 'Alex Mendez: Kitty money' },
  { id: '4622715876748017804', ts: '2026-06-19 03:11:15', from: 'Tyler Maguire', amount: 20, note: '🐱' },
  { id: '4622738879829295687', ts: '2026-06-19 03:56:57', from: 'Jakob Hernandez', amount: 20, note: 'Kitty' },
  { id: '4623062110209494672', ts: '2026-06-19 14:39:09', from: 'Nicholas Tamborrino', amount: 20, note: 'Kitty' },
  { id: '4623095257391340427', ts: '2026-06-19 15:45:01', from: 'Micah Barnett', amount: 20, note: 'Kitty' },
  { id: '4623225787159868555', ts: '2026-06-19 20:04:21', from: 'Landon Gillespie', amount: 20, note: 'for rico' },
  { id: '4623507081177853266', ts: '2026-06-20 05:23:14', from: 'Dylan Yeager', amount: 20, note: 'Kitty' },
  { id: '4623513195978057209', ts: '2026-06-20 05:35:23', from: 'Jeff Ohm', amount: 20, note: 'Sorry bro' },
  { id: '4623881893620522906', ts: '2026-06-20 17:47:55', from: 'Kendrick Pulce', amount: 60, note: 'Anthony Abruzzini, Ivan Hernandez, Kyle Davis 🐱' },
  { id: '4625430971554974255', ts: '2026-06-22 21:05:40', from: 'Kendrick Pulce', amount: 40, note: 'Kendrick Pulce🐱' },
  { id: '4626594716658042135', ts: '2026-06-24 11:37:49', from: 'Ethan Buckhardt', amount: 20, note: 'Ethan Buckhardt' },
  { id: '4626811838252239920', ts: '2026-06-24 18:49:12', from: 'Jake Fretto', amount: 20, note: 'Jacob Fretto' },
  { id: '4626915619450960072', ts: '2026-06-24 22:15:23', from: 'Jade Valdez', amount: 20, note: 'Kitty' },
  { id: '4626919936245595316', ts: '2026-06-24 22:23:58', from: 'Justin Sanchez', amount: 20, note: 'Kitty (Justin Sanchez)' },
  { id: '4626952509814114556', ts: '2026-06-24 23:28:41', from: 'Jakob Hernandez', amount: 20, note: 'Kitty' },
  { id: '7417280929304400M', ts: '2026-06-25 10:18:40', from: 'Conner Kitterman', amount: 20, note: 'Kitty' },
  { id: '4627294354776196323', ts: '2026-06-25 10:47:52', from: 'devyn obrien', amount: 40, note: 'Devyn and Bailey kitty' },
  { id: '4627307067291943719', ts: '2026-06-25 11:13:08', from: 'Nicholas Tamborrino', amount: 20, note: 'Kitty' },
  { id: '4627646370362673073', ts: '2026-06-25 22:27:16', from: 'Ryan Giordano', amount: 20, note: 'Kitty' },
  { id: '3FB829930M2437049', ts: '2026-06-25 23:57:55', from: 'Ryan Johnson', amount: 20, note: 'Ryan Johnson' },
  { id: '4627985987309603324', ts: '2026-06-26 09:42:01', from: 'Parker Munier', amount: 20, note: 'Parker Munier Kitty' },
  { id: '4627989369051647402', ts: '2026-06-26 09:48:44', from: 'DJ Olmstead', amount: 20, note: 'DJ Olmstead' },
  { id: '4628041904529477665', ts: '2026-06-26 11:33:07', from: 'Caleb Smyers', amount: 20, note: 'Caleb Smyers kitty' },
  { id: '4628325722704257225', ts: '2026-06-26 20:57:01', from: 'Landon Gillespie', amount: 20, note: ':venmo_dollar:' },
  { id: '4628325813536413130', ts: '2026-06-26 20:57:12', from: 'Lawrence Nunez', amount: 40, note: 'Kitty for Carson and I' },
  { id: '4628328076229128128', ts: '2026-06-26 21:01:41', from: 'William Sayle', amount: 20, note: 'Kitty' },
  { id: '4628329445643943272', ts: '2026-06-26 21:04:25', from: 'Mason Jones', amount: 20, note: 'Kitty' },
  { id: '4628329618642525086', ts: '2026-06-26 21:04:45', from: 'Branson Mitchell', amount: 20, note: '🐈‍⬛' },
  { id: '39P11038YS001035L', ts: '2026-06-26 21:06:51', from: 'Humberto Rodriguez', amount: 20, note: 'Kitty -Humberto Rodriguez' },
  { id: '4628331408980527740', ts: '2026-06-26 21:08:19', from: 'Christopher Phillips', amount: 20, note: 'Kitty' },
  { id: '4628333497341670653', ts: '2026-06-26 21:12:28', from: 'CJ CJ Curry', amount: 20, note: 'Kitty' },
  { id: '4628334461771878059', ts: '2026-06-26 21:14:23', from: 'Fred Miller', amount: 20, note: '🐱' },
  { id: '4628341052416115234', ts: '2026-06-26 21:27:28', from: 'Justin Sanchez', amount: 20, note: 'Kitty for Ryan Flores' },
  { id: '4628344989147985333', ts: '2026-06-26 21:35:17', from: 'Micah Barnett', amount: 20, note: 'Kitty' },
  { id: '4628345889471822487', ts: '2026-06-26 21:37:05', from: 'Tyler Maguire', amount: 20, note: '🐱' },
  { id: '4628351868678343408', ts: '2026-06-26 21:48:58', from: 'Alex Mendez', amount: 20, note: 'Week 3 kitty' },
  { id: '4628359037364718597', ts: '2026-06-26 22:03:12', from: 'Jacob Mulligan', amount: 20, note: 'Kitty' },
  { id: '4628359122894791428', ts: '2026-06-26 22:03:22', from: 'Dylan Yeager', amount: 20, note: 'Kitty' },
  { id: '4628444524679082172', ts: '2026-06-27 00:53:03', from: 'Dylan Urquilla', amount: 20, note: 'Kitty' },
  { id: '4629012108080246941', ts: '2026-06-27 19:40:44', from: 'Kendrick Pulce', amount: 60, note: 'Anthony Abruzzini, Kyle Davis, Ivan Hernandez 🐱' },
  { id: '4629012249973649874', ts: '2026-06-27 19:41:01', from: 'Kendrick Pulce', amount: 20, note: 'Kendrick Pulce🐱' },
  { id: '4629834971753975550', ts: '2026-06-28 22:55:37', from: 'Jack Shreiber', amount: 20, note: 'late kitty 🥲' },
  { id: '4630180218187689743', ts: '2026-06-29 10:21:34', from: 'Joshua Salvatierra', amount: 20, note: 'Week 4 kitty' },
  { id: '4630680369880153463', ts: '2026-06-30 02:55:17', from: 'Jeff Ohm', amount: 40, note: 'Last week and this week kitty' },
  { id: '4631630745102272574', ts: '2026-07-01 10:23:30', from: 'Dj Miles', amount: 60, note: 'Kitty' },
  { id: '4631962714910836136', ts: '2026-07-01 21:23:04', from: 'Ryan Johnson', amount: 20, note: 'Ryan Johnson' },
  { id: '0AH43044Y7048290U', ts: '2026-07-01 21:35:47', from: 'Ryan Flores', amount: 20, note: 'Ryan Flores 🐱' },
  { id: '4632012451118284996', ts: '2026-07-01 23:01:53', from: 'Parker Munier', amount: 20, note: 'Parker Munier Kittyyyyy' },
  { id: '4632394546634341307', ts: '2026-07-02 11:41:02', from: 'devyn obrien', amount: 40, note: 'Kitty Devyn and Bailey' },
  { id: '81284065M1454250L', ts: '2026-07-02 13:46:56', from: 'Ryan Giordano', amount: 20, note: 'Kitty' },
  { id: '4632563783654451399', ts: '2026-07-02 17:17:17', from: 'Ryan Johnson', amount: 20, note: 'Colton Mendez' },
  { id: '4632568483892779541', ts: '2026-07-02 17:26:37', from: 'Tyler Maguire', amount: 20, note: 'Kitty' },
  { id: '4632570437708036107', ts: '2026-07-02 17:30:30', from: 'Alex Mendez', amount: 20, note: 'Week 4 kitty' },
  { id: '4632570653463915696', ts: '2026-07-02 17:30:56', from: 'Justin Sanchez', amount: 20, note: 'Kitty' },
  { id: '4632752617889703983', ts: '2026-07-02 23:32:28', from: 'CJ CJ Curry', amount: 20, note: 'Kitty' },
  { id: '4632837096768122740', ts: '2026-07-03 02:20:18', from: 'Jade Valdez', amount: 20, note: 'Kitty' },
  { id: '4632845056063512667', ts: '2026-07-03 02:36:07', from: 'Jacob Mulligan', amount: 20, note: 'Kitty' },
  { id: '4633377427518897693', ts: '2026-07-03 20:13:51', from: 'Branson Mitchell', amount: 20, note: 'Kitty' },
  { id: '4633399584232494761', ts: '2026-07-03 20:57:52', from: 'Micah Barnett', amount: 20, note: 'Kitty' },
  { id: '4633551197559280577', ts: '2026-07-04 01:59:06', from: 'Landon Gillespie', amount: 40, note: 'for rico' },
  { id: '4634976926121087413', ts: '2026-07-06 01:11:46', from: 'Nicholas Tamborrino', amount: 20, note: 'Kitty' },
  { id: '4635278633153566310', ts: '2026-07-06 11:11:12', from: 'Rayce Nichols', amount: 100, note: 'Kitty' },
  { id: '4635361550391897248', ts: '2026-07-06 13:55:57', from: 'Joshua Salvatierra', amount: 20, note: 'Week 5 kitty' },
  { id: '4635574809594200713', ts: '2026-07-06 20:59:39', from: 'William Sayle', amount: 40, note: 'Kitty' },
  { id: '4635574881593701550', ts: '2026-07-06 20:59:48', from: 'Jacob Mulligan', amount: 20, note: 'Isen Buntz kitty' },
  { id: '93V29220L6327414U', ts: '2026-07-06 21:01:15', from: 'Jake Fretto', amount: 20, note: 'Jacob Fretto' },
  { id: '4635577952653911108', ts: '2026-07-06 21:05:54', from: 'Lawrence Nunez', amount: 80, note: 'Kitty for week 4 & 5 for Carson and I' },
  { id: '4635579954385591074', ts: '2026-07-06 21:09:53', from: 'Fred Miller', amount: 20, note: '🍕' },
  { id: '4635580114717035552', ts: '2026-07-06 21:10:12', from: 'Justin Sanchez', amount: 20, note: 'Justin Sanchez Kitty' },
  { id: '4635585335468654489', ts: '2026-07-06 21:20:34', from: 'Mason Jones', amount: 40, note: 'Kitty last week and this week' },
  { id: '4635586522665639795', ts: '2026-07-06 21:22:56', from: 'Humberto Rodriguez', amount: 20, note: 'Kitty Humberto' },
  { id: '4635592227632104942', ts: '2026-07-06 21:34:16', from: 'Landon Gillespie', amount: 220, note: 'for will rest of academy' },
  { id: '4635592373703425720', ts: '2026-07-06 21:34:33', from: 'Caleb Smyers', amount: 20, note: 'Kitty Caleb Smyers' },
  { id: '4635597169461955690', ts: '2026-07-06 21:44:05', from: 'Dylan Yeager', amount: 20, note: 'Kitty' },
  { id: '4635600351571903907', ts: '2026-07-06 21:50:24', from: 'Alex Mendez', amount: 20, note: 'Kitty week 5' },
  { id: '3EP3822858351211Y', ts: '2026-07-06 22:16:53', from: 'Jakob Hernandez', amount: 20, note: 'Kitty' },
  { id: '4635652916711330550', ts: '2026-07-06 23:34:50', from: 'Kendrick Pulce', amount: 60, note: 'Kyle Davis, Anthony Abruzzini, Ivan Hernandez 🐱' },
  { id: '4635653193518777708', ts: '2026-07-06 23:35:23', from: 'Kendrick Pulce', amount: 40, note: 'Kendrick Pulce 🐱' },
  { id: '4635663545673385911', ts: '2026-07-06 23:55:57', from: 'Ethan Buckhardt', amount: 40, note: 'Ethan Buckhardt' },
  { id: '8FF237437K437813C', ts: '2026-07-08 18:04:55', from: 'devyn obrien', amount: 20, note: 'Kitty' },
  { id: '4636936557622195643', ts: '2026-07-08 18:05:12', from: 'devyn obrien', amount: 20, note: 'Bailey kitty' },
  { id: '7B183296TV896682F', ts: '2026-07-08 23:58:50', from: 'Ryan Johnson', amount: 20, note: 'Ryan Johnson' },
  { id: '9N200816FJ0461642', ts: '2026-07-09 23:44:41', from: 'Conner Kitterman', amount: 40, note: 'Kitty' },
  { id: '4637935844921156212', ts: '2026-07-10 03:10:37', from: 'Ryan Giordano', amount: 20, note: 'Kitty' },
  { id: '4638386658991217254', ts: '2026-07-10 18:06:18', from: 'Ryan Johnson', amount: 20, note: 'Colton Mendez' },
  { id: '4638441577227888254', ts: '2026-07-10 19:55:25', from: 'CJ CJ Curry', amount: 20, note: 'Kitty' },
  { id: '4638547184787060129', ts: '2026-07-10 23:25:14', from: 'Nicholas Tamborrino', amount: 20, note: 'Kitty' },
  { id: '4638547190977388839', ts: '2026-07-10 23:25:15', from: 'Jacob Mulligan', amount: 20, note: 'Kitty' },
  { id: '4638547576651711633', ts: '2026-07-10 23:26:01', from: 'Jack Shreiber', amount: 20, note: 'money' },
  { id: '4638574284747277095', ts: '2026-07-11 00:19:05', from: 'Landon Gillespie', amount: 20, note: ':venmo_dollar:' },
  { id: '80162860C5521174T', ts: '2026-07-11 14:26:59', from: 'Jade Valdez', amount: 20, note: 'Kitty' },
  { id: '4639304628542791006', ts: '2026-07-12 00:30:08', from: 'Parker Munier', amount: 20, note: 'Parker Munier kitty money' },
  { id: '4639946239270437977', ts: '2026-07-12 21:44:54', from: 'DJ Olmstead', amount: 20, note: 'DJ Olmstead' },
  { id: '4640552723876105161', ts: '2026-07-13 17:49:53', from: 'Joshua Salvatierra', amount: 20, note: 'Week6 kitty' },
  { id: '7HM051223C4242256', ts: '2026-07-14 14:16:51', from: 'Jake Fretto', amount: 40, note: 'Jacob Fretto' },
  { id: '4641879244078759257', ts: '2026-07-15 13:45:26', from: 'Ryan Giordano', amount: 20, note: 'Kitty' },
  { id: '4642111886318003962', ts: '2026-07-15 21:27:39', from: 'Ryan Johnson', amount: 20, note: 'Ryan Johnson' },
  { id: '4642187284091117786', ts: '2026-07-15 23:57:28', from: 'Parker Munier', amount: 20, note: 'Parker Munier kitty' },
];

function importVenmoStatement(){
  ensureSchema_();
  const ss  = ss_();
  const led = sheet_(LEDGER_TAB);
  const backupName = 'Ledger_bak_' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd-HHmmss');
  led.copyTo(ss).setName(backupName);

  // Wipe existing Venmo rows (cash + other methods untouched), bottom-up.
  getLedger_().filter(e => e.method.toLowerCase() === 'venmo').map(e => e.row).sort((a, b) => b - a).forEach(r => led.deleteRow(r));

  const roster = activeRoster_();
  let credited = 0, review = 0;
  VENMO_STATEMENT_.forEach(t => {
    let rid = '', name = '', isReview;
    if (VENMO_REVIEW_IDS_[t.id]){
      isReview = true;                                   // flagged: assign by hand
    } else {
      const m = matchRecruit_({ payer: t.from, amount: t.amount, handle: '', memo: '' }, roster);
      isReview = !(m && isWholeWeeks_(t.amount));         // credit the SENDER, whole-week only
      if (!isReview){ rid = m.rid; name = m.name; }
    }
    appendPayment_(rid, name, 'Venmo', t.amount, t.id, isReview, { payer: t.from, memo: t.note, ts: t.ts });
    if (isReview) review++; else credited++;
  });

  return 'Imported ' + VENMO_STATEMENT_.length + ' Venmo payments: backup "' + backupName + '" · ' +
         credited + ' auto-credited to sender, ' + review + ' to review. Cash untouched.';
}

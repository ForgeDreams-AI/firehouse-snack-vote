/*  Payments.gs — the money model.
 *  ────────────────────────────────────────────────────────────────────────
 *  TWO TABLES, ONE JOB EACH. This separation is what makes the tracker hard
 *  to get wrong:
 *
 *    Payments  — what actually arrived. One row per real transaction, keyed by
 *                Venmo's own transaction ID. Never edited by hand. This is the
 *                bank's record.
 *
 *    Ledger    — who got the credit. One or more rows per payment (a payment
 *                covering three people makes three rows). Editable; this is
 *                where all human judgment lives.
 *
 *  RECONCILIATION: the Ledger's Venmo rows must sum to the Payments tab's
 *  Venmo rows. If they don't, something drifted — and the dashboard says so in
 *  a red bar instead of quietly showing wrong numbers. That single check would
 *  have caught every bug this tracker has ever had.
 *
 *  ALLOCATION: who a payment is FOR is read from the note, which is clean data
 *  in a downloaded statement (unlike a scraped email). Rules, in order:
 *    1. Note names roster people (or their Aliases) -> split equally among them.
 *       "me"/"myself"/"and I" also includes the sender.
 *    2. Otherwise -> the whole payment goes to the sender.
 *    3. Sender unknown, or the split doesn't divide evenly -> review queue.
 *  The collector is never a valid target — see Venmo.gs.                     */


/* ── Reading ──────────────────────────────────────────────────────────────*/

function getPayments_(){
  const sh = sheet_(PAYMENTS_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, PAYMENTS_HEADERS.length).getValues()
    .map((r, i) => ({
      row: i + 2,
      id: String(r[PAY.ID - 1]).trim(),
      date: r[PAY.DATE - 1],
      method: String(r[PAY.METHOD - 1]).trim(),
      payer: String(r[PAY.PAYER - 1]).trim(),
      amount: Number(r[PAY.AMOUNT - 1]) || 0,
      note: String(r[PAY.NOTE - 1] || '').trim()
    }))
    .filter(p => p.id);
}

/* Nickname -> roster full name. */
function getAliases_(){
  const sh = sheet_(ALIASES_TAB);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
    const nick = normName_(r[0]), full = String(r[1]).trim();
    if (nick && full) out[nick] = full;
  });
  return out;
}


/* ── Reconciliation ───────────────────────────────────────────────────────*/

/* Does the credit we handed out match the money that arrived?
 * Returns { ok, received, credited, difference, unallocated } for Venmo. */
function reconcile_(){
  let received = 0;
  getPayments_().forEach(p => { if (p.method === 'Venmo') received += p.amount; });

  let credited = 0;
  getLedger_().forEach(e => { if (e.method === 'Venmo') credited += e.amount; });

  const diff = round2_(credited - received);
  return {
    ok: Math.abs(diff) < 0.01,
    received: round2_(received),
    credited: round2_(credited),
    difference: diff
  };
}

/** Print the reconciliation. Run any time you want reassurance. */
function checkTheBooks(){
  const r = reconcile_();
  const msg = r.ok
    ? 'BOOKS BALANCE ✓\n  Venmo received (Payments tab): $' + r.received.toFixed(2) +
      '\n  Venmo credited (Ledger):       $' + r.credited.toFixed(2) +
      '\n\nEvery dollar that arrived is credited to somebody.'
    : 'OUT OF BALANCE ✗\n  Venmo received (Payments tab): $' + r.received.toFixed(2) +
      '\n  Venmo credited (Ledger):       $' + r.credited.toFixed(2) +
      '\n  Difference:                    $' + r.difference.toFixed(2) +
      '\n\n' + (r.difference > 0
        ? 'The Ledger credits MORE than arrived — duplicates. Re-run importVenmoStatement().'
        : 'The Ledger credits LESS than arrived — payments are unallocated. Check the review queue.');
  Logger.log(msg);
  return msg;
}


/* ── Allocation ───────────────────────────────────────────────────────────*/

/* Who is this payment for? Returns an array of { rid, name, amount }, or []
 * when it can't be resolved confidently (-> review queue). */
function allocatePayment_(payment, roster, aliases){
  const collector = normName_(COLLECTOR_NAME);
  const note = ' ' + normName_(payment.note) + ' ';
  const amount = payment.amount;

  // Who does the note name? Full roster names first, then aliases.
  const named = [];
  const add = r => { if (r && normName_(r.name) !== collector && named.indexOf(r) < 0) named.push(r); };

  roster.forEach(r => {
    const n = normName_(r.name);
    if (n.length >= 5 && note.indexOf(' ' + n + ' ') >= 0) add(r);
  });
  Object.keys(aliases).forEach(nick => {
    if (note.indexOf(' ' + nick + ' ') >= 0){
      const full = normName_(aliases[nick]);
      add(roster.filter(r => normName_(r.name) === full)[0]);
    }
  });
  // Distinct roster surnames/first names mentioned on their own (e.g. "Carson").
  roster.forEach(r => {
    const parts = normName_(r.name).split(' ');
    parts.forEach(tok => {
      if (tok.length < 4) return;
      const unique = roster.filter(x => normName_(x.name).split(' ').indexOf(tok) >= 0).length === 1;
      if (unique && note.indexOf(' ' + tok + ' ') >= 0) add(r);
    });
  });

  const sender = matchSender_({ payer: payment.payer, amount: amount, handle: '', memo: '' }, roster);

  // "me" / "myself" / "and I" -> the sender is one of the people covered.
  if (named.length && /\b(me|myself|and i)\b/.test(note) && sender && named.indexOf(sender) < 0){
    named.unshift(sender);
  }

  if (named.length){
    const each = round2_(amount / named.length);
    // Only auto-split when it divides cleanly into whole weeks.
    if (Math.abs(each * named.length - amount) < 0.01 && isWholeWeeks_(each)){
      return named.map(r => ({ rid: r.rid, name: r.name, amount: each }));
    }
    return [];                                    // uneven -> let a human decide
  }

  if (sender && isWholeWeeks_(amount)){
    return [{ rid: sender.rid, name: sender.name, amount: amount }];
  }
  return [];
}

/*  ReceiptReport.gs — build + send the itemized spend report.  (v2, Feature 3)
 *
 *  Sent as ONE email with all active recruits in BCC: protects privacy AND keeps
 *  the recipient count low against the consumer-Gmail daily cap (~500 recipients).
 *  A per-PurchaseID script-property guard means a receipt is never double-reported. */

function sendSpendReport_(pid){
  const props    = PropertiesService.getScriptProperties();
  const guardKey = REPORT_LOG_PREFIX + pid;
  if (props.getProperty(guardKey)) return { ok: false, msg: 'Report already sent for ' + pid + '.' };

  const lines = getExpenses_().filter(e => e.pid === pid);
  if (!lines.length) return { ok: false, msg: 'No expense rows for ' + pid + '.' };

  const vendor   = lines[0].vendor || 'Costco';
  const tax      = round2_(lines.reduce((s, e) => s + e.tax, 0));      // tax lives on the first row only
  const total    = round2_(lines.reduce((s, e) => s + e.total, 0)) ||  // PurchaseTotal on first row only
                   round2_(lines.reduce((s, e) => s + e.line, 0) + tax);
  const subtotal = round2_(total - tax);
  const url      = lines[0].url || '';
  const when     = Utilities.formatDate(new Date(), TIMEZONE, 'EEE, MMM d, yyyy');

  // Running kitty balance = everything collected − everything spent.
  const collected = collectedToDate_();
  const spent     = spentToDate_();
  const balance   = round2_(collected - spent);

  const recruits = activeRoster_().filter(r => r.email);
  if (!recruits.length) return { ok: false, msg: 'No active recruit emails to send to.' };
  const bcc = recruits.map(r => r.email).join(',');

  const tmpl = buildSpendEmail_({ vendor: vendor, lines: lines, subtotal: subtotal, tax: tax,
                                  total: total, when: when, url: url,
                                  collected: collected, spent: spent, balance: balance });

  // Single send, 55 in BCC. "To" is the academy address itself.
  GmailApp.sendEmail(SENDER_GMAIL, tmpl.subject, tmpl.text, {
    name: 'PHX FD Academy Kitty',
    bcc: bcc,
    htmlBody: tmpl.html
  });

  props.setProperty(guardKey, JSON.stringify({ ts: nowStamp_(), recipients: recruits.length }));
  Logger.log('Spend report ' + pid + ' sent to ' + recruits.length + ' recruits at ' + nowStamp_());

  return { ok: true, recipients: recruits.length, balance: balance,
           msg: 'Report emailed to ' + recruits.length + ' recruits. Kitty balance: $' + balance.toFixed(2) + '.' };
}

/* HTML + plain-text spend report. */
function buildSpendEmail_(d){
  const subject = 'PHX FD Kitty — ' + d.vendor + ' run (' + d.when + ') · $' + d.total.toFixed(2);

  // Plain text
  let text =
    'Hey crew,\n\n' +
    'Here\'s what the academy kitty covered this week (' + d.vendor + ', ' + d.when + '):\n\n';
  d.lines.forEach(it => {
    text += '  • ' + it.item + '  ×' + it.qty + '  @ $' + Number(it.unit).toFixed(2) +
            '  = $' + Number(it.line).toFixed(2) + '\n';
  });
  text +=
    '\n  Subtotal: $' + d.subtotal.toFixed(2) +
    '\n  Tax:      $' + d.tax.toFixed(2) +
    '\n  TOTAL:    $' + d.total.toFixed(2) + '\n\n' +
    'Running kitty balance:\n' +
    '  Collected to date: $' + d.collected.toFixed(2) + '\n' +
    '  Spent to date:     $' + d.spent.toFixed(2) + '\n' +
    '  Balance remaining: $' + d.balance.toFixed(2) + '\n\n' +
    (d.url ? ('Receipt: ' + d.url + '\n\n') : '') +
    'Cast your vote here: ' + VOTING_SITE_URL + '\n\n' +
    '— PHX FD Academy Kitty';

  // HTML
  let rows = '';
  d.lines.forEach((it, i) => {
    const bg = i % 2 ? '#fafafa' : '#ffffff';
    rows +=
      '<tr style="background:' + bg + '">' +
        '<td style="padding:7px 10px;border-bottom:1px solid #eee">' + esc_(it.item) + '</td>' +
        '<td style="padding:7px 10px;border-bottom:1px solid #eee;text-align:center">' + esc_(it.qty) + '</td>' +
        '<td style="padding:7px 10px;border-bottom:1px solid #eee;text-align:right">$' + Number(it.unit).toFixed(2) + '</td>' +
        '<td style="padding:7px 10px;border-bottom:1px solid #eee;text-align:right">$' + Number(it.line).toFixed(2) + '</td>' +
      '</tr>';
  });

  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#15171B;line-height:1.5;max-width:560px">' +
      '<p style="margin:0 0 12px">Hey crew,</p>' +
      '<p style="margin:0 0 14px">Here\'s what the academy kitty covered this week ' +
        '(<b>' + esc_(d.vendor) + '</b>, ' + esc_(d.when) + ').</p>' +
      '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #eee">' +
        '<thead><tr style="background:#C8102E;color:#fff">' +
          '<th style="padding:8px 10px;text-align:left">Item</th>' +
          '<th style="padding:8px 10px;text-align:center">Qty</th>' +
          '<th style="padding:8px 10px;text-align:right">Unit</th>' +
          '<th style="padding:8px 10px;text-align:right">Line</th>' +
        '</tr></thead><tbody>' + rows + '</tbody>' +
        '<tfoot>' +
          '<tr><td colspan="3" style="padding:7px 10px;text-align:right;color:#555">Subtotal</td>' +
              '<td style="padding:7px 10px;text-align:right">$' + d.subtotal.toFixed(2) + '</td></tr>' +
          '<tr><td colspan="3" style="padding:7px 10px;text-align:right;color:#555">Tax</td>' +
              '<td style="padding:7px 10px;text-align:right">$' + d.tax.toFixed(2) + '</td></tr>' +
          '<tr><td colspan="3" style="padding:9px 10px;text-align:right;font-weight:bold;border-top:2px solid #15171B">Total</td>' +
              '<td style="padding:9px 10px;text-align:right;font-weight:bold;border-top:2px solid #15171B">$' + d.total.toFixed(2) + '</td></tr>' +
        '</tfoot>' +
      '</table>' +
      '<table cellpadding="0" cellspacing="0" style="margin:16px 0 0;width:100%;font-size:14px;background:#F3EFE7;border-radius:8px">' +
        '<tr><td style="padding:10px 12px;color:#555">Collected to date</td>' +
            '<td style="padding:10px 12px;text-align:right">$' + d.collected.toFixed(2) + '</td></tr>' +
        '<tr><td style="padding:0 12px 4px;color:#555">Spent to date</td>' +
            '<td style="padding:0 12px 4px;text-align:right">$' + d.spent.toFixed(2) + '</td></tr>' +
        '<tr><td style="padding:6px 12px 10px;font-weight:bold;border-top:1px solid #ddd">Balance remaining</td>' +
            '<td style="padding:6px 12px 10px;text-align:right;font-weight:bold;border-top:1px solid #ddd">$' + d.balance.toFixed(2) + '</td></tr>' +
      '</table>' +
      (d.url ? ('<p style="margin:14px 0 0;font-size:13px"><a href="' + esc_(d.url) + '" style="color:#C8102E">View the receipt</a></p>') : '') +
      '<p style="margin:14px 0 0;font-size:13px;color:#888">Cast your vote here: ' +
        '<a href="' + esc_(VOTING_SITE_URL) + '" style="color:#C8102E">' + esc_(VOTING_SITE_URL) + '</a></p>' +
      '<p style="margin:4px 0 0;font-size:13px;color:#888">— PHX FD Academy Kitty</p>' +
    '</div>';

  return { subject: subject, text: text, html: html };
}

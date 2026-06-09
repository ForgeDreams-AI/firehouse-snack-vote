/*  Expenses.gs — receipt upload → free OCR → parse → reconcile → write. (v2, Feature 3)
 *
 *  ZERO-BUDGET OCR: we use the FREE Advanced Drive Service (Drive API v2).
 *  Inserting a file with { ocr: true } converts it to a Google Doc and runs
 *  Google's built-in OCR; we read the Doc text back, then trash the temp Doc.
 *  No paid OCR API is used anywhere.
 *
 *  SETUP REQUIRED (once):
 *    Editor ▸ Services ▸ add "Drive API"  (identifier: Drive, version v2).
 *    The provided appsscript.json already declares this + the Drive/Docs scopes.
 *
 *  QUOTA / LIMITS: Drive OCR reliably handles images/PDFs up to a few MB and
 *  reads only the first pages of long PDFs. A blurry photo parses poorly — which
 *  is exactly why nothing is auto-sent; the operator edits "the list" first. */

/* Upload a receipt photo/PDF (base64 from the dashboard), OCR it, and return
 * editable candidate line items. Does NOT write to Expenses yet. */
function uploadReceiptWeb(base64, mimeType, filename){
  ensureSchema_();
  if (!base64) return { ok: false, msg: 'No file received.' };
  mimeType = mimeType || 'application/octet-stream';

  const bytes = Utilities.base64Decode(base64);
  const blob  = Utilities.newBlob(bytes, mimeType, filename || ('receipt-' + Date.now()));

  // Save the original file to a dedicated Drive folder + make a shareable link.
  const folder = getReceiptFolder_();
  const file   = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* domain may block link sharing */ }
  const url = file.getUrl();

  const pid = newPurchaseId_();

  let items = [], ocrText = '';
  try {
    ocrText = ocrToText_(blob);
    items   = parseReceipt_(ocrText);
  } catch (e){
    // OCR failed (service not enabled, file too big, etc.) — still let the
    // operator key items in manually against the saved receipt.
    return { ok: true, purchaseId: pid, receiptUrl: url, items: [],
             warn: 'OCR unavailable (' + e + '). Saved the receipt — add items manually.' };
  }

  return {
    ok: true, purchaseId: pid, receiptUrl: url, items: items,
    guessSubtotal: round2_(items.reduce((s, it) => s + it.line, 0)),
    warn: items.length ? '' : 'OCR found no clear line items — add them manually below.'
  };
}

/* Confirm "the list" → write to Expenses (once) → send the group spend report.
 * payload = { purchaseId, vendor, items:[{name,qty,unit,line}], tax,
 *             printedTotal, receiptUrl, notes, override } */
function confirmReceiptWeb(payload){
  ensureSchema_();
  const p = payload || {};

  // Clean + normalize the edited items.
  const items = (p.items || [])
    .map(it => ({
      name: String(it.name || '').trim(),
      qty:  Number(it.qty) > 0 ? Number(it.qty) : 1,
      unit: round2_(it.unit),
      line: it.line != null ? round2_(it.line) : round2_((Number(it.qty) || 1) * round2_(it.unit))
    }))
    .filter(it => it.name && it.line >= 0);
  if (!items.length) return { ok: false, msg: 'No line items to save.' };

  const tax     = round2_(p.tax);
  const printed = round2_(p.printedTotal);
  const computed = round2_(items.reduce((s, it) => s + it.line, 0) + tax);
  const delta    = round2_(computed - printed);

  // RECONCILIATION: sum(line totals) + tax must equal the printed grand total.
  // Off by ≥ 1¢ → block + warn, unless the operator explicitly overrides.
  if (printed > 0 && Math.abs(delta) >= 0.01 && !p.override){
    return { ok: false, reconcile: true, delta: delta, computed: computed, printed: printed,
             msg: 'Items + tax = $' + computed.toFixed(2) + ' but printed total = $' + printed.toFixed(2) +
                  ' (off by $' + delta.toFixed(2) + '). Fix the list, or Save anyway.' };
  }

  const pid = p.purchaseId || newPurchaseId_();
  if (purchaseExists_(pid)) return { ok: false, msg: 'That receipt was already saved (' + pid + ').' };

  // PurchaseTotal stored = the printed total when we have it, else items+tax.
  const total = printed > 0 ? printed : computed;
  appendExpenseRows_(pid, p.vendor || 'Costco', items, tax, total, p.receiptUrl || '', p.notes || '');

  // Generate + send the itemized spend report to the group.
  const report = sendSpendReport_(pid);
  return { ok: true, purchaseId: pid,
           msg: 'Saved ' + items.length + ' item' + (items.length === 1 ? '' : 's') + '. ' + (report.msg || ''),
           report: report };
}

/* ── OCR + parse helpers ─────────────────────────────────────────────────── */

/* Insert blob as a Google Doc WITH OCR (free), read text, trash temp Doc. */
function ocrToText_(blob){
  const tmp = Drive.Files.insert(
    { title: 'kitty-ocr-' + Date.now(), mimeType: 'application/vnd.google-apps.document' },
    blob,
    { ocr: true, ocrLanguage: 'en' }
  );
  let text = '';
  try { text = DocumentApp.openById(tmp.id).getBody().getText(); }
  finally { try { Drive.Files.remove(tmp.id); } catch (e) { /* best-effort cleanup */ } }
  return text;
}

/* Parse OCR text into candidate line items {name, qty, unit, line}.
 *
 * Costco receipts are messy for OCR:
 *   • Each item line is usually "<item-code> <ABBREVIATED NAME> <price><tax-letter>"
 *     e.g. "1573  KS WATER 40PK   3.99 E"   (trailing E/A = taxable flag)
 *   • Multi-qty appears as a separate "2 @ 5.99" style line.
 *   • Lots of non-item noise: SUBTOTAL, TAX, TOTAL, member #, card digits, etc.
 * Strategy: keep only lines that END in a price; strip a leading item-code and
 * the trailing tax letter; drop known summary/footer keywords. Best-effort —
 * the operator edits everything before anything is saved or emailed. */
function parseReceipt_(text){
  const skip = /(sub\s*total|^tax\b|\btotal\b|balance|change\b|cash\b|debit|credit|visa|master|amex|tend|approv|auth|member|wholesale|costco|whse|^trm|^tran|^date|^time|items? sold|^\*+|account|chip|ref\s*#|invoice|^\$?0\.00$)/i;
  const priceRe = /(-?\d{1,4}\.\d{2})\s*[A-Za-z]?\s*$/;      // trailing price, optional 1-letter tax flag
  const qtyAtRe = /^(\d{1,2})\s*@\s*\$?(\d{1,4}\.\d{2})/;     // "2 @ 5.99"
  const out = [];

  text.split(/\r?\n/).forEach(raw => {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || line.length < 3) return;
    if (skip.test(line)) return;

    // "2 @ 5.99" → qty × unit
    const qa = line.match(qtyAtRe);
    if (qa){
      const qty = parseInt(qa[1], 10), unit = parseFloat(qa[2]);
      const nm = line.replace(qtyAtRe, '').trim() || 'Item';
      out.push({ name: cleanName_(nm), qty: qty, unit: unit, line: round2_(qty * unit) });
      return;
    }

    const pm = line.match(priceRe);
    if (!pm) return;                                  // no trailing price → not an item line
    const price = parseFloat(pm[1]);
    if (!isFinite(price) || price <= 0) return;

    let name = line.slice(0, pm.index).trim();
    name = name.replace(/^\d{4,}\s+/, '');            // strip leading Costco item code
    name = cleanName_(name);
    if (!name) name = 'Item';
    out.push({ name: name, qty: 1, unit: price, line: price });
  });

  return out;
}
function cleanName_(s){
  return String(s || '').replace(/[^A-Za-z0-9 .&\-\/%]/g, '').replace(/\s+/g, ' ').trim();
}

/* ── Drive plumbing ──────────────────────────────────────────────────────── */
function getReceiptFolder_(){
  const it = DriveApp.getFoldersByName(RECEIPT_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(RECEIPT_FOLDER_NAME);
}
function newPurchaseId_(){ return 'P' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd-HHmmss'); }

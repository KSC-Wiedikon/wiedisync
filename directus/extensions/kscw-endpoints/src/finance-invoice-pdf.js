/**
 * A real Swiss Rechnung: club header, addressee in the window position, invoice
 * meta, itemised positions, total — then the official QR payment part.
 *
 * Replaces the title-line-plus-payment-slip that renderInvoiceQrBillPdf produced.
 * A member who receives only a QR slip has no document to file, no due date, no
 * breakdown of why they owe CHF 540 rather than 440, and nothing that reads as an
 * invoice if they ever have to show one. ClubDesk emitted a proper Rechnung, so
 * this is parity, not polish.
 *
 * LAYOUT: A4. swissqrbill attaches the payment part to the bottom 105 mm, so all
 * document content must stay above 192 mm — `CONTENT_BOTTOM_MM` is that budget and
 * the positions table stops when it runs out rather than drawing behind the QR.
 *
 * The addressee sits at 120/47 mm: the right-hand window of a Swiss C5/C6 envelope.
 * The five members with no email address can only be reached by post, so the page
 * has to survive being folded into an envelope.
 */
import PDFDocument from 'pdfkit'
import { SwissQRBill } from 'swissqrbill/pdf'

/** The club as creditor — regular IBAN (no QR-IBAN), so SCOR or no reference. */
export const CLUB_CREDITOR = {
  account: 'CH6500270270N66152280',
  name: 'Kantonsschulsportclub Wiedikon',
  address: 'Schrennengasse 7',
  zip: 8003,
  city: 'Zürich',
  country: 'CH',
}

const MM = 2.834645669 // mm → pt
const LEFT = 20 * MM
const RIGHT_EDGE = 190 * MM
const CONTENT_BOTTOM_MM = 186 // hard floor: the payment part owns everything below

const chf = (n) => Number(n || 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** dd.mm.yyyy — Swiss format, never the ISO the DB hands us. */
function ddmmyyyy(v) {
  if (!v) return ''
  const iso = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

/**
 * Positions to print. Falls back to a single line from the subject so every
 * pre-293 invoice (and every ad-hoc one) still renders a complete document.
 * A stored breakdown that does not sum to the invoice total is NOT trusted —
 * printing positions that contradict the amount due is worse than printing one
 * line, because the member cannot tell which number to pay.
 */
export function invoiceLines({ lines, amount, subject }) {
  const total = Number(amount || 0)
  const parsed = Array.isArray(lines) ? lines
    : (typeof lines === 'string' && lines.trim() ? (() => { try { return JSON.parse(lines) } catch { return null } })() : null)
  const clean = (parsed || [])
    .map((l) => ({ label: String(l?.label ?? '').trim(), amount: Number(l?.amount) }))
    .filter((l) => l.label && Number.isFinite(l.amount))
  if (clean.length) {
    const sum = Math.round(clean.reduce((s, l) => s + l.amount, 0) * 100) / 100
    if (Math.abs(sum - Math.round(total * 100) / 100) < 0.005) return clean
  }
  return [{ label: String(subject || 'Rechnung').trim() || 'Rechnung', amount: total }]
}

/** A QR-bill debtor, but only from a COMPLETE address — swissqrbill throws on a
 *  partial one, and a thrown render means the member gets an email promising an
 *  attachment that is not there. */
export function debtorFrom(inv) {
  const name = String(inv?.recipient_name ?? '').trim()
  const address = String(inv?.recipient_address ?? '').trim()
  const zip = String(inv?.recipient_zip ?? '').trim()
  const city = String(inv?.recipient_city ?? '').trim()
  if (!name || !address || !zip || !city) return null
  return { name, address, zip, city, country: 'CH' }
}

/**
 * @returns {Promise<Buffer>} one-page A4 invoice + QR payment part.
 */
/**
 * Every `finance_invoices` column `renderInvoicePdf` reads off the row it is
 * handed. Callers MUST select all of these.
 *
 * This exists because a missing column here fails SILENTLY: the renderer reads
 * `undefined`, `ddmmyyyy(undefined)` returns `''`, the meta row is filtered out,
 * `debtorFrom` returns null, and the member receives a clean-looking PDF with no
 * invoice date, no due date, no positions and no addressee. Nothing throws and
 * nothing logs. That shipped in the first native dues run (audit 2026-08-08,
 * finding 17) because commit 8c02f4f8 swapped in this renderer and left the
 * caller's SELECT at the previous one's needs.
 *
 * Import it into the SELECT rather than retyping the list, so the renderer's
 * requirements and the query cannot drift apart again.
 */
export const INVOICE_PDF_COLUMNS = [
  'id', 'number', 'title', 'subject',
  'amount', 'open_amount',
  'lines',
  'invoice_date', 'due_date',
  'reference', 'reference_type',
  'recipient_name', 'recipient_address', 'recipient_zip', 'recipient_city',
]

export function renderInvoicePdf(inv) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 0 })
      const chunks = []
      doc.on('data', (c) => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const amount = Math.round(Number(inv.amount) * 100) / 100

      // ── Sender ────────────────────────────────────────────────────────────
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#000')
        .text(CLUB_CREDITOR.name, LEFT, 18 * MM)
      doc.font('Helvetica').fontSize(9).fillColor('#444')
        .text(`${CLUB_CREDITOR.address} · ${CLUB_CREDITOR.zip} ${CLUB_CREDITOR.city}`, LEFT, 23.5 * MM)

      // ── Addressee (C5/C6 right window) ────────────────────────────────────
      const addr = [
        inv.recipient_name,
        inv.recipient_address,
        [inv.recipient_zip, inv.recipient_city].filter(Boolean).join(' '),
      ].filter((s) => s && String(s).trim())
      doc.fontSize(11).fillColor('#000')
      addr.forEach((l, i) => doc.text(String(l), 120 * MM, (47 + i * 5) * MM, { width: 70 * MM }))

      // ── Title + meta ──────────────────────────────────────────────────────
      let y = 75 * MM
      doc.font('Helvetica-Bold').fontSize(15)
        .text(inv.title || 'Rechnung', LEFT, y)
      y += 9 * MM

      doc.font('Helvetica').fontSize(9.5).fillColor('#333')
      const meta = [
        ['Rechnungsnummer', inv.number],
        ['Rechnungsdatum', ddmmyyyy(inv.invoice_date)],
        ['Fällig am', ddmmyyyy(inv.due_date)],
        // Only a SCOR reference is meaningful to the payer; QRR is impossible on
        // this IBAN and an unstructured reference is not a payment key.
        [inv.reference_type === 'SCOR' ? 'Referenz' : null, inv.reference],
      ].filter(([k, v]) => k && v)
      for (const [k, v] of meta) {
        doc.fillColor('#666').text(`${k}`, LEFT, y, { width: 38 * MM })
        doc.fillColor('#000').text(String(v), LEFT + 40 * MM, y)
        y += 5 * MM
      }

      // ── Positions ─────────────────────────────────────────────────────────
      y += 5 * MM
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#666')
        .text('Position', LEFT, y)
        .text('Betrag CHF', LEFT, y, { width: RIGHT_EDGE - LEFT, align: 'right' })
      y += 5 * MM
      doc.moveTo(LEFT, y).lineTo(RIGHT_EDGE, y).lineWidth(0.5).strokeColor('#bbb').stroke()
      y += 3 * MM

      const lines = invoiceLines(inv)
      doc.font('Helvetica').fontSize(10).fillColor('#000')
      let shown = 0
      for (const l of lines) {
        // Stop before colliding with the payment part rather than drawing over it.
        if (y > (CONTENT_BOTTOM_MM - 16) * MM) break
        doc.fillColor('#000').text(l.label, LEFT, y, { width: RIGHT_EDGE - LEFT - 30 * MM })
        doc.text(chf(l.amount), LEFT, y, { width: RIGHT_EDGE - LEFT, align: 'right' })
        y += Math.max(5 * MM, doc.heightOfString(l.label, { width: RIGHT_EDGE - LEFT - 30 * MM }) + 1.5 * MM)
        shown++
      }
      if (shown < lines.length) {
        const rest = lines.slice(shown).reduce((s, l) => s + l.amount, 0)
        doc.fillColor('#444').text(`Weitere ${lines.length - shown} Position(en)`, LEFT, y)
        doc.text(chf(rest), LEFT, y, { width: RIGHT_EDGE - LEFT, align: 'right' })
        y += 5 * MM
      }

      y += 1.5 * MM
      doc.moveTo(LEFT, y).lineTo(RIGHT_EDGE, y).lineWidth(0.5).strokeColor('#bbb').stroke()
      y += 3 * MM
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#000')
        .text('Total', LEFT, y)
        .text(`CHF ${chf(amount)}`, LEFT, y, { width: RIGHT_EDGE - LEFT, align: 'right' })
      y += 8 * MM

      doc.font('Helvetica').fontSize(9).fillColor('#555')
      const terms = inv.due_date
        ? `Bitte bis ${ddmmyyyy(inv.due_date)} mit dem untenstehenden Einzahlungsschein begleichen.`
        : 'Bitte mit dem untenstehenden Einzahlungsschein begleichen.'
      if (y < CONTENT_BOTTOM_MM * MM) doc.text(terms, LEFT, y, { width: RIGHT_EDGE - LEFT })

      // ── Official QR payment part (bottom 105 mm) ──────────────────────────
      new SwissQRBill({
        currency: 'CHF',
        amount,
        creditor: { ...CLUB_CREDITOR },
        // Pre-fill "Zahlbar durch" when we hold a complete address: the member
        // does not have to hand-write it, and a named debtor is what the bank
        // reports back in camt, which is the fallback key when the SCOR
        // reference is missing. Partial addresses are omitted entirely —
        // swissqrbill rejects a debtor without all of name/address/zip/city.
        ...(inv.debtor || debtorFrom(inv) ? { debtor: inv.debtor || debtorFrom(inv) } : {}),
        // The bill's own message. Kept separate from `subject` so the invoice
        // number is never glued onto the subject line by the newline-stripping
        // in swissqrbill's additional-information field.
        ...(inv.number ? { message: `Rechnung ${inv.number}`.slice(0, 140) } : {}),
        ...(inv.reference_type === 'SCOR' && inv.reference ? { reference: inv.reference } : {}),
      }, { language: 'DE' }).attachTo(doc)

      doc.end()
    } catch (e) { reject(e) }
  })
}

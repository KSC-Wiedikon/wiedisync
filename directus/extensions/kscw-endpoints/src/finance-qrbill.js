/**
 * Server-side Swiss QR-bill PDF (invoice direction: member pays the club).
 * Mirrors the frontend qrBillPdf.ts / InvoiceQrBill — club is the creditor on its
 * regular IBAN, SCOR reference, "Rechnungsnummer:" message, no debtor. Returns a
 * Buffer to attach to the dues-run email. Uses node pdfkit + swissqrbill/pdf.
 */
import PDFDocument from 'pdfkit'
import { SwissQRBill } from 'swissqrbill/pdf'

const CLUB_CREDITOR = { account: 'CH6500270270N66152280', name: 'Kantonsschulsportclub Wiedikon', address: 'Schrennengasse 7', zip: 8003, city: 'Zürich', country: 'CH' }
const MM = 2.834645669 // mm → pt

/** @returns {Promise<Buffer>} a one-page A4 QR-bill PDF for the invoice. */
export function renderInvoiceQrBillPdf({ amount, number, recipientName, subject, message, reference }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 0 })
      const chunks = []
      doc.on('data', (c) => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const header = [recipientName, number].filter(Boolean).join(' · ')
      doc.fontSize(14).text('Mitgliederbeitrag', 20 * MM, 18 * MM)
      if (header) doc.fontSize(10).text(header, 20 * MM, 25 * MM)
      if (subject) doc.fontSize(10).text(String(subject), 20 * MM, 30 * MM)

      new SwissQRBill({
        currency: 'CHF',
        amount: Math.round(Number(amount) * 100) / 100,
        creditor: { ...CLUB_CREDITOR },
        ...(message ? { message: String(message).slice(0, 140) } : {}),
        ...(reference ? { reference } : {}),
      }, { language: 'DE' }).attachTo(doc) // payment part at the A4 bottom

      doc.end()
    } catch (e) { reject(e) }
  })
}

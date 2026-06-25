// Shared Swiss QR-bill PDF generator — used by the treasurer (member explorer)
// and the member (My finances) to download the same official payment-part slip.
// swissqrbill/pdf draws onto pdfkit's self-contained browser bundle (lazy-loaded,
// ~1.5 MB chunk, no node polyfills); output is a Blob download. True vector.

/** Minimal pdfkit surface we use (the standalone build ships no types). */
interface PdfDoc {
  page: { height: number }
  on(event: 'data', cb: (chunk: BlobPart) => void): void
  on(event: 'end', cb: () => void): void
  fontSize(size: number): PdfDoc
  text(text: string, x: number, y: number): PdfDoc
  addPage(): PdfDoc
  end(): void
}

/** The club as CREDITOR on an invoice QR-bill (member pays the club) — mirrors
 *  InvoiceQrBill.tsx: regular IBAN, SCOR reference, no debtor (no member addresses). */
const CLUB_CREDITOR = { account: 'CH6500270270N66152280', name: 'Kantonsschulsportclub Wiedikon', address: 'Schrennengasse 7', zip: 8003, city: 'Zürich', country: 'CH' } as const

/** The club is the payer on a reimbursement — shown as "Payable by" on the slip. */
const CLUB_DEBTOR = { name: 'Kantonsschulsportclub Wiedikon', address: 'Schrennengasse 7', zip: 8003, city: 'Zürich', country: 'CH' }

export interface QrBillOptions {
  account: string
  name: string
  address?: string | null
  zip: string | number
  city: string
  amount?: number
  message?: string | null
  title: string
  filename: string
}

const MM = 2.834645669 // mm → pt (pdfkit unit)

export async function downloadQrBillPdf(o: QrBillOptions): Promise<void> {
  const [pdfkitMod, swissMod] = await Promise.all([
    import('pdfkit/js/pdfkit.standalone.js'),
    import('swissqrbill/pdf'),
  ])
  const PDFDocument = ((pdfkitMod as { default?: unknown }).default ?? pdfkitMod) as new (opts: unknown) => PdfDoc
  const SwissQRBill = (swissMod as { SwissQRBill: new (data: unknown, opts?: unknown) => { attachTo: (doc: unknown) => void } }).SwissQRBill

  const doc = new PDFDocument({ size: 'A4', margin: 0 })
  const chunks: BlobPart[] = []
  doc.on('data', (c) => chunks.push(c))
  const done = new Promise<void>((resolve) => doc.on('end', () => resolve()))

  doc.fontSize(13).text(o.title, 20 * MM, 20 * MM)
  new SwissQRBill({
    currency: 'CHF',
    ...(o.amount ? { amount: o.amount } : {}),
    creditor: { account: o.account, name: o.name, address: o.address || o.name, zip: Number(o.zip), city: o.city, country: 'CH' },
    debtor: { ...CLUB_DEBTOR },
    ...(o.message?.trim() ? { message: o.message.trim().slice(0, 140) } : {}),
  }, { language: 'DE' }).attachTo(doc) // payment part at the A4 bottom (default position)
  doc.end()
  await done

  const url = URL.createObjectURL(new Blob(chunks, { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = o.filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** One invoice QR-bill in a batch (member pays the club). */
export interface InvoiceBill {
  number?: string | null
  recipientName?: string | null
  amount: number
  message?: string | null
  reference?: string | null // SCOR (RF…) — valid on the regular IBAN
}

/**
 * Bulk invoice QR-bills → one multi-page A4 PDF (one bill per page), for the
 * treasurer to print/post or attach. Club is the creditor; mirrors InvoiceQrBill.
 * Same lazy-loaded swissqrbill/pdfkit path as downloadQrBillPdf — no new deps.
 */
export async function downloadInvoiceBillsPdf(bills: InvoiceBill[], filename: string, title: string): Promise<void> {
  const payable = bills.filter((b) => b.amount >= 0.01)
  if (!payable.length) return
  const [pdfkitMod, swissMod] = await Promise.all([
    import('pdfkit/js/pdfkit.standalone.js'),
    import('swissqrbill/pdf'),
  ])
  const PDFDocument = ((pdfkitMod as { default?: unknown }).default ?? pdfkitMod) as new (opts: unknown) => PdfDoc
  const SwissQRBill = (swissMod as { SwissQRBill: new (data: unknown, opts?: unknown) => { attachTo: (doc: unknown) => void } }).SwissQRBill

  const doc = new PDFDocument({ size: 'A4', margin: 0 })
  const chunks: BlobPart[] = []
  doc.on('data', (c) => chunks.push(c))
  const done = new Promise<void>((resolve) => doc.on('end', () => resolve()))

  payable.forEach((b, i) => {
    if (i > 0) doc.addPage()
    const header = [b.recipientName, b.number].filter(Boolean).join(' · ')
    doc.fontSize(13).text(title, 20 * MM, 18 * MM)
    if (header) doc.fontSize(10).text(header, 20 * MM, 24 * MM)
    new SwissQRBill({
      currency: 'CHF',
      amount: Math.round(b.amount * 100) / 100,
      creditor: { ...CLUB_CREDITOR },
      ...(b.message?.trim() ? { message: b.message.trim().slice(0, 140) } : {}),
      ...(b.reference ? { reference: b.reference } : {}),
    }, { language: 'DE' }).attachTo(doc) // payment part at the A4 bottom
  })
  doc.end()
  await done

  const url = URL.createObjectURL(new Blob(chunks, { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

// The invoice document is what a member receives and pays from, so the two
// decisions it makes about untrusted stored data get pinned here: which
// positions to print, and whether the QR bill may name a debtor.
//
// renderInvoicePdf itself is exercised by rendering a real page and reading it;
// asserting on PDF bytes would pin the layout, not the correctness.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { invoiceLines, debtorFrom, CLUB_CREDITOR, INVOICE_PDF_COLUMNS } from '../finance-invoice-pdf.js'

describe('invoiceLines', () => {
  it('keeps stored positions when they sum to the invoice total', () => {
    expect(invoiceLines({
      lines: [{ label: 'Mitgliederbeitrag', amount: 440 }, { label: 'Zuschlag', amount: 100 }],
      amount: 540, subject: 'Sub',
    })).toEqual([{ label: 'Mitgliederbeitrag', amount: 440 }, { label: 'Zuschlag', amount: 100 }])
  })

  it('DISTRUSTS positions that contradict the amount due', () => {
    // Printing 440 next to "Total CHF 540" leaves the member unable to tell which
    // number to pay — one honest line beats two that disagree.
    expect(invoiceLines({ lines: [{ label: 'Mitgliederbeitrag', amount: 440 }], amount: 540, subject: 'Beitrag' }))
      .toEqual([{ label: 'Beitrag', amount: 540 }])
  })

  it('accepts JSONB that arrives as a string', () => {
    // knex returns jsonb parsed, but a raw query or a .returning() can hand back text.
    expect(invoiceLines({ lines: '[{"label":"A","amount":40}]', amount: 40, subject: 'S' }))
      .toEqual([{ label: 'A', amount: 40 }])
  })

  it('tolerates rounding noise rather than discarding a correct breakdown', () => {
    expect(invoiceLines({ lines: [{ label: 'A', amount: 33.33 }, { label: 'B', amount: 66.67 }], amount: 100, subject: 'S' }))
      .toHaveLength(2)
  })

  it('handles a negative position (the guest discount)', () => {
    expect(invoiceLines({
      lines: [{ label: 'Beitrag', amount: 440 }, { label: 'Abzug Gastspieler*in', amount: -110 }],
      amount: 330, subject: 'S',
    })).toHaveLength(2)
  })

  it('falls back to one subject line for every pre-293 invoice', () => {
    expect(invoiceLines({ lines: null, amount: 40, subject: 'Mitgliederbeitrag 2026/27' }))
      .toEqual([{ label: 'Mitgliederbeitrag 2026/27', amount: 40 }])
  })

  it('survives malformed JSON and junk entries instead of throwing mid-render', () => {
    expect(invoiceLines({ lines: '{not json', amount: 40, subject: 'S' })).toEqual([{ label: 'S', amount: 40 }])
    expect(invoiceLines({ lines: [{ label: '', amount: 40 }], amount: 40, subject: 'S' })).toEqual([{ label: 'S', amount: 40 }])
    expect(invoiceLines({ lines: [{ label: 'A', amount: 'x' }], amount: 40, subject: 'S' })).toEqual([{ label: 'S', amount: 40 }])
  })

  it('never returns an empty list — a page with no positions is not an invoice', () => {
    expect(invoiceLines({ lines: [], amount: 0, subject: '' })).toEqual([{ label: 'Rechnung', amount: 0 }])
  })
})

describe('debtorFrom', () => {
  const full = { recipient_name: 'A B', recipient_address: 'Weg 1', recipient_zip: '8003', recipient_city: 'Zürich' }

  it('names the payer when the address is complete', () => {
    expect(debtorFrom(full)).toEqual({ name: 'A B', address: 'Weg 1', zip: '8003', city: 'Zürich', country: 'CH' })
  })

  it('returns null on ANY missing part — swissqrbill throws on a partial debtor', () => {
    // A throw here means the member gets an email promising an attachment that
    // is not attached, which is how the Mahnung path already misbehaves.
    for (const k of ['recipient_name', 'recipient_address', 'recipient_zip', 'recipient_city']) {
      expect(debtorFrom({ ...full, [k]: null })).toBeNull()
      expect(debtorFrom({ ...full, [k]: '   ' })).toBeNull()
    }
    expect(debtorFrom({})).toBeNull()
    expect(debtorFrom(null)).toBeNull()
  })
})

describe('CLUB_CREDITOR', () => {
  it('is a REGULAR IBAN, so QRR references stay impossible', () => {
    // IID 30000-31999 would make it a QR-IBAN and change which reference types
    // are legal. This club's is 00270, hence SCOR (RF…) everywhere.
    const iid = Number(CLUB_CREDITOR.account.slice(4, 9))
    expect(iid).toBeLessThan(30000)
  })
})

// The finding this file gained a test for was NOT a bug in any function above —
// invoiceLines and debtorFrom were both correct. The dues run shipped blank PDFs
// because the CALLER's SELECT omitted six columns the renderer reads, and every
// one of those degrades to a silent blank rather than an error. So the thing
// worth pinning is the coupling between the renderer's needs and the query.
describe('INVOICE_PDF_COLUMNS ↔ the dues-run SELECT', () => {
  const financeSrc = readFileSync(new URL('../finance.js', import.meta.url), 'utf8')

  it('covers every invoice column renderInvoicePdf actually reads', () => {
    const pdfSrc = readFileSync(new URL('../finance-invoice-pdf.js', import.meta.url), 'utf8')
    // Every `inv.<column>` the renderer touches, minus the derived ones it
    // computes itself rather than selecting.
    const DERIVED = new Set(['debtor'])
    const read = new Set(
      [...pdfSrc.matchAll(/\binv\.([a-z_]+)/g)].map((m) => m[1]).filter((c) => !DERIVED.has(c))
    )
    const missing = [...read].filter((c) => !INVOICE_PDF_COLUMNS.includes(c))
    expect(missing, `renderInvoicePdf reads ${missing.join(', ')} but INVOICE_PDF_COLUMNS omits them`).toEqual([])
  })

  it('is what the dues-run send loop selects — not a retyped list that can drift', () => {
    // The regression was exactly this: a hand-typed SELECT left behind when the
    // renderer was swapped. Spreading the constant is what makes it impossible.
    expect(financeSrc).toContain('.select(...INVOICE_PDF_COLUMNS')
  })

  it('includes the six columns whose absence produced a blank invoice', () => {
    for (const col of ['lines', 'invoice_date', 'due_date', 'recipient_address', 'recipient_zip', 'recipient_city']) {
      expect(INVOICE_PDF_COLUMNS).toContain(col)
    }
  })
})

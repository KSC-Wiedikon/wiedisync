import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SwissQRCode } from 'swissqrbill/svg'
import { toNum, formatChf } from '../../hooks/useFinance'
import type { FinanceInvoice } from './types'

/**
 * Per-invoice Swiss QR-bill (QR code + Swiss cross) for in-app payment.
 *
 * Uses the club's REGULAR IBAN (not a QR-IBAN), so there's no structured QRR
 * reference — the invoice number rides in the unstructured message instead, and
 * no debtor is set (we don't mirror member addresses). A member scans it with
 * TWINT or any banking app; the amount is pre-filled. Reconciliation still
 * happens in ClubDesk and flows back on the nightly sync.
 */
const CREDITOR = {
  account: 'CH6500270270N66152280',
  name: 'Kantonsschulsportclub Wiedikon',
  address: 'Schrennengasse 7',
  zip: 8003,
  city: 'Zürich',
  country: 'CH',
} as const

export default function InvoiceQrBill({ invoice }: { invoice: FinanceInvoice }) {
  const { t } = useTranslation('finance')
  const open = toNum(invoice.open_amount)
  const amount = Math.round((open > 0 ? open : toNum(invoice.amount)) * 100) / 100

  // Replicate ClubDesk's QR-bill message ("Rechnungsnummer: 3089" + subject) so an
  // in-app payment reconciles identically in ClubDesk, which matches on the invoice
  // number in this Mitteilung. Same format for native invoices (they also carry the
  // SCOR reference below).
  const message = useMemo(() => {
    const parts = [invoice.number ? `Rechnungsnummer: ${invoice.number}` : null, invoice.subject].filter(Boolean)
    return parts.join('\n').slice(0, 140) || undefined
  }, [invoice.number, invoice.subject])

  // Native invoices carry a SCOR (ISO-11649 "RF…") reference so the payment can
  // be auto-reconciled later from camt.054. Valid on the regular IBAN; ClubDesk
  // mirror rows stay reference-less (unstructured message only).
  const reference = invoice.reference_type === 'SCOR' && invoice.reference ? invoice.reference : undefined

  const svg = useMemo(() => {
    if (!(amount >= 0.01)) return null
    try {
      return new SwissQRCode({ currency: 'CHF', amount, creditor: { ...CREDITOR }, message, ...(reference ? { reference } : {}) }).toString()
    } catch {
      return null
    }
  }, [amount, message, reference])

  if (!svg) return null

  return (
    <div className="py-2 text-center">
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('qrScanHint', { amount: formatChf(amount) })}</p>
      {/* The QR is drawn as black modules on a TRANSPARENT ground, so in dark mode
          it sat black-on-near-black — unreadable to the eye and to a scanner, which
          needs the light/dark contrast to find the finder patterns. The white plate
          (and its quiet-zone padding) is part of the symbol, not decoration, so it
          is deliberately NOT theme-aware. */}
      <div className="mt-2 flex justify-center">
        <div className="rounded-lg bg-white p-3 shadow-sm">
          {/* SVG is generated from controlled invoice data (no user markup, only QR rects). */}
          <div className="flex justify-center" dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      </div>
      <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{t('payTwintNote')}</p>
    </div>
  )
}

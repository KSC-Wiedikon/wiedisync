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

  const message = useMemo(() => {
    const parts = [invoice.number ? `Rechnung ${invoice.number}` : null, invoice.subject].filter(Boolean)
    return parts.join(' · ').slice(0, 140) || undefined
  }, [invoice.number, invoice.subject])

  const svg = useMemo(() => {
    if (!(amount >= 0.01)) return null
    try {
      return new SwissQRCode({ currency: 'CHF', amount, creditor: { ...CREDITOR }, message }).toString()
    } catch {
      return null
    }
  }, [amount, message])

  if (!svg) return null

  return (
    <div className="py-2 text-center">
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('qrScanHint', { amount: formatChf(amount) })}</p>
      {/* SVG is generated from controlled invoice data (no user markup, only QR rects). */}
      <div className="mt-2 flex justify-center" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{t('payTwintNote')}</p>
    </div>
  )
}

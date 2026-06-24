import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SwissQRCode } from 'swissqrbill/svg'
import { QrCode } from 'lucide-react'
import type { FinanceMember } from '../../hooks/useFinance'

/**
 * Per-member "pay-out" QR-bill: a Swiss QR with the MEMBER as creditor (their
 * reimbursement IBAN + name + address), amount left BLANK — the treasurer scans
 * it in e-banking to reimburse the member and types the amount. Opposite
 * direction to InvoiceQrBill (where the club is the creditor and a member pays).
 *
 * Only renders for a valid Swiss/Liechtenstein IBAN with an address (the QR-bill
 * standard requires a CH/LI creditor account + zip/city); otherwise a short hint.
 */
const isChLiIban = (iban: string) => /^(CH|LI)\d{2}[0-9A-Z]{15}$/.test(iban)
const fmtIban = (iban: string) => iban.replace(/(.{4})/g, '$1 ').trim()

export default function MemberPayoutQrBill({ member }: { member: FinanceMember }) {
  const { t } = useTranslation('finance')
  const [open, setOpen] = useState(false)
  const iban = (member.iban ?? '').replace(/\s/g, '').toUpperCase()
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ').trim()
  const hasAddress = !!member.plz && !!member.ort
  const canRender = isChLiIban(iban) && !!name && hasAddress

  const svg = useMemo(() => {
    if (!open || !canRender) return null
    try {
      return new SwissQRCode({
        currency: 'CHF',
        creditor: {
          account: iban,
          name,
          address: member.adresse || name,
          zip: Number(member.plz),
          city: member.ort as string,
          country: 'CH',
        },
      }).toString()
    } catch {
      return null
    }
  }, [open, canRender, iban, name, member.adresse, member.plz, member.ort])

  if (!iban) return null // no reimbursement account on file → nothing to pay to

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        <QrCode className="h-4 w-4" /> {t('payoutQrTitle')}
      </h3>
      <p className="font-mono text-sm text-gray-900 dark:text-gray-100">{fmtIban(iban)}</p>

      {!isChLiIban(iban) ? (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t('payoutQrNonCh')}</p>
      ) : !hasAddress ? (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t('payoutQrNeedsAddress')}</p>
      ) : (
        <>
          <button
            onClick={() => setOpen((v) => !v)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <QrCode className="h-4 w-4" /> {open ? t('payoutQrHide') : t('payoutQrShow')}
          </button>
          {open && svg && (
            <>
              {/* SVG built from controlled member data (QR rects only). */}
              <div className="mt-3 flex justify-center [&>svg]:h-auto [&>svg]:w-full [&>svg]:max-w-xs" dangerouslySetInnerHTML={{ __html: svg }} />
              <p className="mt-1 text-center text-xs text-gray-400 dark:text-gray-500">{t('payoutQrHint')}</p>
            </>
          )}
          {open && !svg && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{t('payoutQrError')}</p>}
        </>
      )}
    </section>
  )
}

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SwissQRCode } from 'swissqrbill/svg'
import { QrCode, ShieldAlert } from 'lucide-react'
import type { FinanceMember } from '../../hooks/useFinance'

/**
 * Per-member "pay-out" QR-bill: a Swiss QR with the payee as creditor, amount
 * BLANK — the treasurer scans it in e-banking to reimburse and types the amount.
 *
 * Payee = the billing contact (billing_iban + billing name/address) when "bill a
 * different contact" is on AND a billing IBAN is set (e.g. reimburse a minor's
 * guardian), otherwise the member's own reimbursement IBAN. A member's OWN IBAN
 * imported from ClubDesk is flagged until they confirm it (migration 136).
 *
 * Only renders for a valid CH/LI IBAN + address (Swiss QR-bill requirement).
 */
const isChLiIban = (iban: string) => /^(CH|LI)\d{2}[0-9A-Z]{15}$/.test(iban)
const fmtIban = (iban: string) => iban.replace(/(.{4})/g, '$1 ').trim()
const cleanIban = (s?: string | null) => (s ?? '').replace(/\s/g, '').toUpperCase()

export default function MemberPayoutQrBill({ member }: { member: FinanceMember }) {
  const { t } = useTranslation('finance')
  const [open, setOpen] = useState(false)

  const memberName = [member.first_name, member.last_name].filter(Boolean).join(' ').trim()
  const useBilling = !!member.billing_different && !!cleanIban(member.billing_iban)
  const iban = cleanIban(useBilling ? member.billing_iban : member.iban)
  const name = useBilling ? (member.billing_name?.trim() || memberName) : memberName
  const street = useBilling ? member.billing_address : member.adresse
  const zip = useBilling ? member.billing_plz : member.plz
  const city = useBilling ? member.billing_ort : member.ort
  const hasAddress = !!zip && !!city
  const canRender = isChLiIban(iban) && !!name && hasAddress
  const unconfirmed = !useBilling && !!member.iban && !member.iban_confirmed

  const svg = useMemo(() => {
    if (!open || !canRender) return null
    try {
      return new SwissQRCode({
        currency: 'CHF',
        creditor: { account: iban, name, address: street || name, zip: Number(zip), city: city as string, country: 'CH' },
      }).toString()
    } catch {
      return null
    }
  }, [open, canRender, iban, name, street, zip, city])

  if (!iban) return null // no pay-out account on file

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        <QrCode className="h-4 w-4" /> {t('payoutQrTitle')}
      </h3>
      <p className="font-mono text-sm text-gray-900 dark:text-gray-100">{fmtIban(iban)}</p>
      {useBilling && <p className="mt-0.5 text-xs font-medium text-brand-600 dark:text-brand-300">{t('payoutToBilling', { name })}</p>}
      {unconfirmed && (
        <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
          <ShieldAlert className="h-3.5 w-3.5" /> {t('payoutUnconfirmed')}
        </p>
      )}

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

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import IconButton from '@/components/IconButton'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SwissQRCode } from 'swissqrbill/svg'
import { QrCode, ShieldAlert, Download, Loader2, Trash2, Save } from 'lucide-react'
import { isValidIban } from '../../utils/iban'
import { formatChf, useMemberPayouts, type FinanceMember, type FinancePayout } from '../../hooks/useFinance'
import { createRecord, deleteRecord } from '../../lib/api'
import { logActivity } from '../../utils/logActivity'
import { useAuth } from '../../hooks/useAuth'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import { downloadQrBillPdf } from './qrBillPdf'

/**
 * Per-member pay-out QR-bill + saved reimbursements. The treasurer sets an amount
 * (+ message), can scan the QR on screen, and "Save & download" persists a
 * finance_payouts record (so it shows on the member's My-finances page) and
 * downloads the official QR-bill PDF. Saved pay-outs can be re-downloaded or
 * deleted. Payee = the billing contact (billing_iban) when billing_different,
 * else the member's own IBAN; the saved record snapshots the account/address.
 */
const isChLiIban = (iban: string) => /^(CH|LI)/.test(iban) && isValidIban(iban)
const fmtIban = (iban: string) => iban.replace(/(.{4})/g, '$1 ').trim()
const cleanIban = (s?: string | null) => (s ?? '').replace(/\s/g, '').toUpperCase()

export default function MemberPayoutQrBill({ member }: { member: FinanceMember }) {
  const { t } = useTranslation('finance')
  const { user } = useAuth()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [amountStr, setAmountStr] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

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

  const amount = useMemo(() => {
    const n = Math.round(Number(amountStr.replace(',', '.')) * 100) / 100
    return Number.isFinite(n) && n > 0 ? n : undefined
  }, [amountStr])

  const { data: payoutsRaw } = useMemberPayouts(member.id, true)
  const payouts = payoutsRaw ?? []

  const svg = useMemo(() => {
    if (!open || !canRender) return null
    try {
      return new SwissQRCode({
        currency: 'CHF',
        ...(amount ? { amount } : {}),
        creditor: { account: iban, name, address: street || name, zip: Number(zip), city: city as string, country: 'CH' },
        ...(message.trim() ? { message: message.trim().slice(0, 140) } : {}),
      }).toString()
    } catch {
      return null
    }
  }, [open, canRender, iban, name, street, zip, city, amount, message])

  const refresh = () => qc.invalidateQueries({ queryKey: ['finance', 'payouts', 'member', member.id] })

  async function saveAndDownload() {
    if (!canRender) return
    if (!amount) { toast.error(t('payoutNeedAmount')); return }
    setBusy(true)
    try {
      await createRecord('finance_payouts', {
        member: member.id, amount, currency: 'CHF', message: message.trim() || null,
        iban, payee_name: name, payee_address: street || null, payee_zip: zip || null, payee_ort: city || null,
        created_by_name: [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || null,
        created_by_email: user?.email ?? null,
      })
      logActivity('create', 'finance_payouts', undefined, { member: member.id, amount })
      await refresh()
      await downloadQrBillPdf({
        account: iban, name, address: street, zip: zip as string, city: city as string,
        amount, message, title: `${t('payoutPdfTitle')} — ${name}`, filename: `payout-${name.replace(/\s+/g, '-')}.pdf`,
      })
      toast.success(t('payoutSaved'))
      setAmountStr(''); setMessage('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('payoutQrError'))
    } finally {
      setBusy(false)
    }
  }

  async function downloadSaved(p: FinancePayout) {
    try {
      await downloadQrBillPdf({
        account: cleanIban(p.iban), name: p.payee_name || memberName, address: p.payee_address,
        zip: (p.payee_zip ?? '') as string, city: (p.payee_ort ?? '') as string,
        amount: p.amount != null ? Number(p.amount) : undefined, message: p.message,
        title: `${t('payoutPdfTitle')} — ${p.payee_name || memberName}`,
        filename: `payout-${(p.payee_name || memberName).replace(/\s+/g, '-')}.pdf`,
      })
    } catch {
      toast.error(t('payoutQrError'))
    }
  }

  async function removeSaved(p: FinancePayout) {
    try {
      await deleteRecord('finance_payouts', p.id)
      logActivity('delete', 'finance_payouts', String(p.id), null)
      await refresh()
    } catch {
      toast.error(t('payoutDeleteError'))
    }
  }

  if (!iban && payouts.length === 0) return null

  return (
    <section className="rounded-2xl border border-hairline bg-card shadow-card p-4">
      <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <QrCode className="h-4 w-4" /> {t('payoutQrTitle')}
      </h3>
      {iban && <p className="font-mono text-sm text-foreground">{fmtIban(iban)}</p>}
      {useBilling && <p className="mt-0.5 text-xs font-medium text-brand-600 dark:text-brand-300">{t('payoutToBilling', { name })}</p>}
      {unconfirmed && (
        <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
          <ShieldAlert className="h-3.5 w-3.5" /> {t('payoutUnconfirmed')}
        </p>
      )}

      {iban && (!isChLiIban(iban) ? (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t('payoutQrNonCh')}</p>
      ) : !hasAddress ? (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t('payoutQrNeedsAddress')}</p>
      ) : (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('payoutAmount')}</span>
              <input inputMode="decimal" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} placeholder={t('payoutAmountPlaceholder')}
                className="h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm sm:h-9 dark:bg-gray-800 text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('payoutMessage')}</span>
              <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={140}
                className="h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm sm:h-9 dark:bg-gray-800 text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={saveAndDownload} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {busy ? t('payoutGenerating') : t('payoutSaveDownload')}
            </Button>
            <Button variant="outline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              <QrCode className="h-4 w-4" /> {open ? t('payoutQrHide') : t('payoutQrShow')}
            </Button>
          </div>

          {open && svg && (
            <div className="mt-3">
              <div className="flex justify-center">
                <div className="w-fit rounded-lg bg-white p-4 text-black" dangerouslySetInnerHTML={{ __html: svg }} />
              </div>
              <p className="mt-2 text-center text-xs text-muted-foreground/80">
                {amount ? t('payoutQrHintAmount', { amount: formatChf(amount) }) : t('payoutQrHint')}
              </p>
            </div>
          )}
          {open && !svg && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{t('payoutQrError')}</p>}
        </>
      ))}

      {payouts.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('payoutsSaved')}</h4>
          <div className="divide-y divide-border rounded-xl border border-hairline">
            {payouts.map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-2.5">
                <div className="min-w-0 flex-1">
                  <span className="font-medium tabular-nums text-foreground">{p.amount != null ? formatChf(p.amount) : '—'}</span>
                  {p.message && <span className="ml-2 text-sm text-muted-foreground">{p.message}</span>}
                  <span className="mt-0.5 block text-xs text-muted-foreground/80">{p.date_created ? formatDateCompactZurich(p.date_created) : ''}{p.created_by_name ? ` · ${p.created_by_name}` : ''}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton size="sm" onClick={() => downloadSaved(p)} label={t('payoutDownloadPdf')} className="text-muted-foreground hover:text-brand-600 dark:hover:text-brand-300">
                    <Download />
                  </IconButton>
                  <IconButton size="sm" onClick={() => removeSaved(p)} label={t('payoutDelete')} className="text-muted-foreground/80 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400">
                    <Trash2 />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

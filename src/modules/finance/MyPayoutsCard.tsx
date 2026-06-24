import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download, Banknote } from 'lucide-react'
import { useMyPayouts, formatChf, type FinancePayout } from '../../hooks/useFinance'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import { downloadQrBillPdf } from './qrBillPdf'

/**
 * Member view of the reimbursements the club is sending them (finance_payouts,
 * migration 137). Read-only — the treasurer creates them in Club finances. The
 * member can download the QR-bill PDF (regenerated from the saved snapshot).
 */
const cleanIban = (s?: string | null) => (s ?? '').replace(/\s/g, '').toUpperCase()

export default function MyPayoutsCard() {
  const { t } = useTranslation('finance')
  const { data } = useMyPayouts()
  const payouts = data ?? []
  if (payouts.length === 0) return null

  async function download(p: FinancePayout) {
    try {
      await downloadQrBillPdf({
        account: cleanIban(p.iban), name: p.payee_name || '', address: p.payee_address,
        zip: (p.payee_zip ?? '') as string, city: (p.payee_ort ?? '') as string,
        amount: p.amount != null ? Number(p.amount) : undefined, message: p.message,
        title: t('payoutPdfTitle'), filename: 'reimbursement.pdf',
      })
    } catch {
      toast.error(t('payoutQrError'))
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
        <Banknote className="h-4 w-4 text-green-600 dark:text-green-400" /> {t('myPayoutsTitle')}
      </h2>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t('myPayoutsSubtitle')}</p>
      <div className="mt-2 divide-y divide-gray-200 dark:divide-gray-700">
        {payouts.map((p) => (
          <div key={p.id} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <span className="font-medium tabular-nums text-gray-900 dark:text-gray-100">{p.amount != null ? formatChf(p.amount) : '—'}</span>
              {p.message && <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">{p.message}</span>}
              <span className="mt-0.5 block text-xs text-gray-400">{p.date_created ? formatDateCompactZurich(p.date_created) : ''}</span>
            </div>
            <button
              onClick={() => download(p)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <Download className="h-4 w-4" /> {t('payoutDownloadPdf')}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

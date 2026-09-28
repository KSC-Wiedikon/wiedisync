import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download, Banknote } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { useMyPayouts, formatChf, type FinancePayout } from '../../hooks/useFinance'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import { downloadQrBillPdf } from './qrBillPdf'

/**
 * Member view of the reimbursements the club is sending them (finance_payouts,
 * migration 137). Read-only — the treasurer creates them in Club finances. The
 * member can download the QR-bill PDF (regenerated from the saved snapshot).
 */
const cleanIban = (s?: string | null) => (s ?? '').replace(/\s/g, '').toUpperCase()

/** open = announced, the money has not left the club yet; paid = transferred. */
function PayoutStatusBadge({ status }: { status?: string | null }) {
  const { t } = useTranslation('finance')
  const base = 'inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium'
  if (status === 'paid') {
    return <span className={`${base} bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300`}>{t('payoutStatusPaid')}</span>
  }
  return <span className={`${base} bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300`}>{t('payoutStatusOpen')}</span>
}

export default function MyPayoutsCard() {
  const { t } = useTranslation('finance')
  const { data } = useMyPayouts()
  // A cancelled pay-out was a treasurer's mistake, not money the member is
  // owed — it never belongs on the member's page.
  const payouts = useMemo(() => (data ?? []).filter((p) => p.status !== 'cancelled'), [data])
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
    <section className="rounded-2xl border border-hairline bg-card shadow-card p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Banknote className="h-4 w-4 text-green-600 dark:text-green-400" /> {t('myPayoutsTitle')}
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{t('myPayoutsSubtitle')}</p>
      <div className="-mx-4 mt-3 border-t border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="hidden sm:table-cell">{t('colDate')}</TableHead>
              <TableHead>{t('colSubject')}</TableHead>
              <TableHead className="text-right">{t('colAmount')}</TableHead>
              <TableHead>{t('colStatus')}</TableHead>
              <TableHead className="sr-only">{t('payoutDownloadPdf')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payouts.map((p) => (
              <TableRow key={p.id} className="min-h-[44px]">
                <TableCell className="hidden sm:table-cell whitespace-nowrap text-xs text-muted-foreground">
                  {p.date_created ? formatDateCompactZurich(p.date_created) : '–'}
                </TableCell>
                <TableCell className="whitespace-normal break-words text-foreground">
                  {p.message || '–'}
                  <span className="mt-0.5 block text-xs text-muted-foreground/80 sm:hidden">
                    {p.date_created ? formatDateCompactZurich(p.date_created) : ''}
                  </span>
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums text-foreground">
                  {p.amount != null ? formatChf(p.amount) : '—'}
                </TableCell>
                <TableCell><PayoutStatusBadge status={p.status} /></TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => download(p)}
                    aria-label={t('payoutDownloadPdf')}
                    title={t('payoutDownloadPdf')}
                    className="shrink-0 max-sm:w-9 max-sm:px-0"
                  >
                    <Download />
                    <span className="hidden sm:inline">{t('payoutDownloadPdf')}</span>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

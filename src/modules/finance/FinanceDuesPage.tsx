import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useMyInvoices, useMyInvoicesMeta, toNum, formatChf, isPayableInvoice } from '../../hooks/useFinance'
import { useReportPageLoading } from '../../hooks/usePageReady'
import InvoiceTable from './InvoiceTable'
import PayoutIbanCard from './PayoutIbanCard'
import MyPayoutsCard from './MyPayoutsCard'
import MyRefereeExpensesCard from './MyRefereeExpensesCard'
import { GuideHelpButton } from '../guide/GuideHelpButton'

/**
 * "Bills & reimbursements" — strictly the member's OWN money: personal bills,
 * pay-outs the club is sending them, referee fees they paid out of pocket and
 * the payout IBAN. Bills billed to a team they lead live on /finance/team.
 */
export default function FinanceDuesPage() {
  const { t } = useTranslation('finance')
  const { data: invoicesRaw, isLoading, refetch } = useMyInvoices()
  const { data: meta } = useMyInvoicesMeta()
  const invoices = useMemo(() => invoicesRaw ?? [], [invoicesRaw])

  // Report to the app boot gate — see usePageReady.tsx
  useReportPageLoading(isLoading)

  // Self-reported invoices drop out of the open balance on purpose: the member
  // has done their part and should see CHF 0.00 until finance says otherwise.
  const openTotal = useMemo(
    () => invoices.filter(isPayableInvoice).reduce((acc, i) => acc + toNum(i.open_amount), 0),
    [invoices],
  )

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">{t('myDuesTitle')}</h1>
          <GuideHelpButton />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t('myDuesSubtitle')}</p>
      </div>

      {/* Payout IBAN — the canonical add/edit/check place (was in profile editor) */}
      <div>
        <PayoutIbanCard />
      </div>

      {/* Reimbursements the club is sending this member (migration 137) */}
      <MyPayoutsCard />

      {/* Referee fees this member paid out of pocket — reimbursed at season end */}
      <MyRefereeExpensesCard />

      {/* Open balance summary */}
      <div className="rounded-2xl border border-hairline bg-card shadow-card p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('openBalance')}</div>
        <div className={`mt-1.5 text-2xl font-bold tabular-nums ${openTotal > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
          {formatChf(openTotal)}
        </div>
        {openTotal === 0 && invoices.length > 0 && (
          <div className="mt-1 text-xs text-muted-foreground">{t('allSettled')}</div>
        )}
        {openTotal > 0 && (
          <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t('payTapHint')}</div>
        )}
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">…</div>
      ) : invoices.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          {/* "You have no invoices." reads as a fault to someone who simply owes
              nothing — a Gratis member (coach, staff) has never been billed and
              never will be. Say which of the two it is. */}
          {meta?.no_fee ? (
            <>
              <p className="text-foreground/85">{t('noInvoicesFree')}</p>
              <p className="mt-1 text-xs">{t('noInvoicesFreeHint')}</p>
            </>
          ) : t('noInvoices')}
        </div>
      ) : (
        <div className="rounded-2xl border border-hairline bg-card shadow-card overflow-hidden">
          <InvoiceTable invoices={invoices} canPay onPaid={refetch} />
        </div>
      )}
    </div>
  )
}

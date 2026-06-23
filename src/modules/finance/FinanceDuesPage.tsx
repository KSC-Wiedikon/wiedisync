import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Check, Clock } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import { useMyInvoices, toNum, formatChf, isOpenInvoice, isNativeInvoice, reportInvoicePaid } from '../../hooks/useFinance'
import { useReportPageLoading } from '../../hooks/usePageReady'
import type { FinanceInvoice } from './types'
import InvoiceQrBill from './InvoiceQrBill'
import PayoutIbanCard from './PayoutIbanCard'

/** Status pill: native invoices use the lifecycle labels; ClubDesk rows show the raw status. */
function StatusBadge({ inv }: { inv: FinanceInvoice }) {
  const { t } = useTranslation('finance')
  const base = 'inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium'
  if (isNativeInvoice(inv)) {
    const s = inv.status ?? ''
    const map: Record<string, [string, string]> = {
      open: ['bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', t('statusOpen')],
      pending_confirmation: ['bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', t('statusPendingConfirmation')],
      paid: ['bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300', t('statusPaid')],
      cancelled: ['bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400', t('statusCancelled')],
    }
    const [cls, label] = map[s] ?? ['bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300', s]
    return <span className={`${base} ${cls}`}>{label}</span>
  }
  if (!inv.status) return null
  const payable = isOpenInvoice(inv)
  return (
    <span className={`${base} ${payable ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'}`}>
      {inv.status}
    </span>
  )
}

export default function FinanceDuesPage() {
  const { t } = useTranslation('finance')
  const { data: invoicesRaw, isLoading, refetch } = useMyInvoices()
  const invoices = invoicesRaw ?? []
  const [payRow, setPayRow] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<string | null>(null)

  // Report to the app boot gate — see usePageReady.tsx
  useReportPageLoading(isLoading)

  const openTotal = useMemo(
    () => invoices.filter(isOpenInvoice).reduce((acc, i) => acc + toNum(i.open_amount), 0),
    [invoices],
  )

  async function handlePaid(id: string) {
    setSubmitting(id)
    try {
      await reportInvoicePaid(id)
      await refetch()
      setPayRow(null)
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('myDuesTitle')}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('myDuesSubtitle')}</p>
      </div>

      {/* Payout IBAN — the canonical add/edit/check place (was in profile editor) */}
      <PayoutIbanCard />

      {/* Open balance summary */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('openBalance')}</div>
        <div className={`mt-1.5 text-2xl font-bold tabular-nums ${openTotal > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
          {formatChf(openTotal)}
        </div>
        {openTotal === 0 && invoices.length > 0 && (
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('allSettled')}</div>
        )}
        {openTotal > 0 && (
          <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t('payTapHint')}</div>
        )}
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">…</div>
      ) : invoices.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {t('noInvoices')}
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <Table>
            <TableHeader>
              <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colSubject')}</TableHead>
                <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colDate')}</TableHead>
                <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colDue')}</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colAmount')}</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colOpen')}</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => {
                const open = toNum(inv.open_amount)
                const payable = isOpenInvoice(inv)
                const native = isNativeInvoice(inv)
                const pending = native && inv.status === 'pending_confirmation'
                const expanded = payRow === inv.id
                return (
                  <Fragment key={inv.id}>
                    <TableRow
                      className={`border-gray-200 dark:border-gray-700 ${payable ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40' : ''}`}
                      onClick={payable ? () => setPayRow((p) => (p === inv.id ? null : inv.id)) : undefined}
                    >
                      <TableCell className="whitespace-normal break-words text-gray-900 dark:text-gray-100">
                        {payable && (
                          <span className="mr-1 inline-block align-middle text-amber-500">
                            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </span>
                        )}
                        {inv.subject || inv.number || '–'}
                        {inv.team_name && (
                          <span className="ml-1 inline-block rounded bg-brand-50 px-1.5 py-0.5 align-middle text-[10px] font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                            {t('billedToTeam', { team: inv.team_name })}
                          </span>
                        )}
                        <span className="mt-0.5 block text-xs text-gray-400 sm:hidden">
                          {inv.invoice_date ? formatDateCompactZurich(inv.invoice_date) : ''}
                        </span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell whitespace-nowrap text-gray-600 dark:text-gray-400">
                        {inv.invoice_date ? formatDateCompactZurich(inv.invoice_date) : '–'}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell whitespace-nowrap text-gray-600 dark:text-gray-400">
                        {inv.due_date ? formatDateCompactZurich(inv.due_date) : '–'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-gray-900 dark:text-gray-100">{formatChf(inv.amount)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${open > 0 && !pending ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
                        {open > 0 && payable ? formatChf(open) : '–'}
                      </TableCell>
                      <TableCell><StatusBadge inv={inv} /></TableCell>
                    </TableRow>
                    {expanded && payable && (
                      <TableRow className="border-gray-200 dark:border-gray-700">
                        <TableCell colSpan={6} className="bg-amber-50/40 dark:bg-amber-900/10">
                          <InvoiceQrBill invoice={inv} />
                          {native && (
                            <div className="flex flex-col items-center gap-1.5 pb-3">
                              <button
                                type="button"
                                disabled={submitting === inv.id}
                                onClick={() => handlePaid(inv.id)}
                                className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                              >
                                <Check className="h-4 w-4" />
                                {t('iPaid')}
                              </button>
                              <p className="max-w-sm text-center text-xs text-gray-500 dark:text-gray-400">{t('iPaidHint')}</p>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                    {pending && (
                      <TableRow className="border-gray-200 dark:border-gray-700">
                        <TableCell colSpan={6} className="bg-blue-50/40 py-2 dark:bg-blue-900/10">
                          <p className="flex items-center justify-center gap-1.5 text-xs text-blue-700 dark:text-blue-300">
                            <Clock className="h-3.5 w-3.5" /> {t('pendingConfirmationHint')}
                          </p>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

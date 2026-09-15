import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Check, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import { toNum, formatChf, isPayableInvoice, isReportedPaid, isNativeInvoice, reportInvoicePaid } from '../../hooks/useFinance'
import type { FinanceInvoice } from './types'
import InvoiceQrBill from './InvoiceQrBill'

/** Status pill: native invoices use the lifecycle labels; ClubDesk rows show the raw status. */
export function StatusBadge({ inv }: { inv: FinanceInvoice }) {
  const { t } = useTranslation('finance')
  const base = 'inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium'
  // A self-reported ClubDesk row still says "Gestellt" in ClubDesk's own column —
  // the member's own report is what the member needs to see here.
  if (!isNativeInvoice(inv) && isReportedPaid(inv)) {
    return <span className={`${base} bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300`}>{t('statusPendingConfirmation')}</span>
  }
  if (isNativeInvoice(inv)) {
    const s = inv.status ?? ''
    const map: Record<string, [string, string]> = {
      open: ['bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', t('statusOpen')],
      partial: ['bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', t('statusPartial')],
      pending_confirmation: ['bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', t('statusPendingConfirmation')],
      paid: ['bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300', t('statusPaid')],
      cancelled: ['bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400', t('statusCancelled')],
    }
    const [cls, label] = map[s] ?? ['bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300', s]
    return <span className={`${base} ${cls}`}>{label}</span>
  }
  if (!inv.status) return null
  const payable = isPayableInvoice(inv)
  return (
    <span className={`${base} ${payable ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'}`}>
      {inv.status}
    </span>
  )
}

export interface InvoiceTableProps {
  invoices: FinanceInvoice[]
  /** The viewer may expand a payable row into the QR-bill + "Set as paid" flow.
   *  Personal bills: always. Team bills: only a lead / finance (`can_pay`). */
  canPay?: boolean
  /** Called after a successful "Set as paid" report — the host refetches. */
  onPaid?: () => void | Promise<unknown>
  /** Render the guided-tour anchors (`dues-pay` / `dues-status`). Only the
   *  personal page hosts the finance-dues tour, so the team page leaves them off. */
  tourAnchors?: boolean
}

/**
 * The invoice list shared by the personal "Bills & reimbursements" page and the
 * Team finance page: subject / dates / amount / open / status, with the payable
 * rows expanding into the Swiss QR-bill and the self-report button.
 */
export default function InvoiceTable({ invoices, canPay = true, onPaid, tourAnchors = false }: InvoiceTableProps) {
  const { t } = useTranslation('finance')
  const [payRow, setPayRow] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<string | null>(null)

  // Guided-tour anchor: the first payable row doubles as the pay/QR affordance.
  const firstPayableId = invoices.find(isPayableInvoice)?.id

  async function handlePaid(id: string) {
    setSubmitting(id)
    try {
      await reportInvoicePaid(id)
      await onPaid?.()
      setPayRow(null)
      toast.success(t('reportPaidDone'))
    } catch {
      // Without this the button just stopped spinning — a 409 (already settled
      // in ClubDesk since the page loaded) looked like a dead button.
      toast.error(t('reportPaidFailed'))
    } finally {
      setSubmitting(null)
    }
  }

  return (
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
        {invoices.map((inv, idx) => {
          const open = toNum(inv.open_amount)
          const payable = isPayableInvoice(inv)
          const pending = isReportedPaid(inv)
          // Still owed AND this viewer is allowed to settle it from here.
          const expandable = payable && canPay
          const expanded = payRow === inv.id
          return (
            <Fragment key={inv.id}>
              <TableRow
                data-tour={tourAnchors && inv.id === firstPayableId ? 'dues-pay' : undefined}
                className={`border-gray-200 dark:border-gray-700 ${expandable ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40' : ''}`}
                onClick={expandable ? () => setPayRow((p) => (p === inv.id ? null : inv.id)) : undefined}
              >
                <TableCell className="whitespace-normal break-words text-gray-900 dark:text-gray-100">
                  {expandable && (
                    <span className="mr-1 inline-block align-middle text-amber-500">
                      {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </span>
                  )}
                  {inv.subject || inv.number || '–'}
                  <span className="mt-0.5 block text-xs text-gray-400 sm:hidden">
                    {inv.invoice_date ? formatDateCompactZurich(inv.invoice_date) : ''}
                  </span>
                  {/* A CHF 0 invoice's total tells the member nothing — the
                      positions are the message ("CHF 440 … Erlass −440"). A
                      free membership is never emailed, so this page is the
                      only place the member ever sees why it came to nothing. */}
                  {toNum(inv.amount) === 0 && (inv.lines?.length ?? 0) > 1 && (
                    <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                      {inv.lines!.map((l, i) => (
                        <span key={i} className="flex justify-between gap-3 tabular-nums">
                          <span className="whitespace-normal break-words">{l.label}</span>
                          <span>{formatChf(l.amount)}</span>
                        </span>
                      ))}
                    </span>
                  )}
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
                <TableCell data-tour={tourAnchors && idx === 0 ? 'dues-status' : undefined}><StatusBadge inv={inv} /></TableCell>
              </TableRow>
              {expanded && expandable && (
                <TableRow className="border-gray-200 dark:border-gray-700">
                  <TableCell colSpan={6} className="bg-amber-50/40 dark:bg-amber-900/10">
                    <InvoiceQrBill invoice={inv} />
                    {/* Offered for ClubDesk mirror rows too — the report is kept
                        in finance_invoice_self_reports so it outlives the nightly
                        mirror rebuild (migration 297). */}
                    <div className="flex flex-col items-center gap-1.5 pb-3">
                      <button
                        type="button"
                        disabled={submitting === inv.id}
                        onClick={() => handlePaid(inv.id)}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                      >
                        <Check className="h-4 w-4" />
                        {t('setAsPaid')}
                      </button>
                      <p className="max-w-sm text-center text-xs text-gray-500 dark:text-gray-400">{t('iPaidHint')}</p>
                    </div>
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
  )
}

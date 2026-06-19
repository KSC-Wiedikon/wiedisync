import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import { useMyInvoices, toNum, formatChf, isOpenInvoice } from '../../hooks/useFinance'

export default function FinanceDuesPage() {
  const { t } = useTranslation('finance')
  const { data: invoicesRaw, isLoading } = useMyInvoices()
  const invoices = invoicesRaw ?? []

  const openTotal = useMemo(
    () => invoices.filter(isOpenInvoice).reduce((acc, i) => acc + toNum(i.open_amount), 0),
    [invoices],
  )

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('myDuesTitle')}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('myDuesSubtitle')}</p>
      </div>

      {/* Open balance summary */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('openBalance')}</div>
        <div className={`mt-1.5 text-2xl font-bold tabular-nums ${openTotal > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
          {formatChf(openTotal)}
        </div>
        {openTotal === 0 && invoices.length > 0 && (
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('allSettled')}</div>
        )}
      </div>

      {/* Pay via TWINT — static club payee QR (no amount/reference): the member
          enters the amount; the paid status flows back via the nightly ClubDesk sync. */}
      {openTotal > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-center dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('payViaTwint')}</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{t('payTwintHint', { amount: formatChf(openTotal) })}</p>
          <img src="/twint-kscw.png" alt="TWINT — KSC Wiedikon" className="mx-auto mt-3 w-40 sm:w-48" />
          <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">{t('payTwintNote')}</p>
        </div>
      )}

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
                return (
                  <TableRow key={inv.id} className="border-gray-200 dark:border-gray-700">
                    <TableCell className="whitespace-normal break-words text-gray-900 dark:text-gray-100">
                      {inv.subject || inv.number || '–'}
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
                    <TableCell className={`text-right tabular-nums ${open > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
                      {open > 0 ? formatChf(open) : '–'}
                    </TableCell>
                    <TableCell>
                      {inv.status && (
                        <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                          isOpenInvoice(inv)
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                            : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                        }`}>
                          {inv.status}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

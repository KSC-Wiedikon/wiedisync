import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import { toNum, formatChf } from '../../hooks/useFinance'
import type { FinanceAccount, FinanceTransaction } from './types'

/**
 * The bookings (ledger) of one account: date, text, contra account (Gegenkonto),
 * debit/credit and a running Saldo (in the account's natural direction). Shared by
 * the Accounts tree and the P&L / balance-sheet drill-downs.
 *
 * `transactions` is whatever set the caller wants summed — the Accounts tab passes
 * ALL bookings; the income-statement drill passes the Abschluss-excluded set so the
 * ledger reconciles with the displayed P&L figure.
 */
export default function AccountLedger({ account, transactions, nameByNum }: {
  account: FinanceAccount; transactions: FinanceTransaction[]; nameByNum: Map<string, string>
}) {
  const { t } = useTranslation('finance')
  const debitNormal = account.type === 'asset' || account.type === 'expense'

  const ledger = useMemo(() => {
    const rows = transactions
      .filter((tx) => tx.debit_account_number === account.number || tx.credit_account_number === account.number)
      .sort((a, b) => (a.booking_date || '').localeCompare(b.booking_date || ''))
    return rows.reduce<Array<{ tx: FinanceTransaction; soll: number; haben: number; gegen: string | null; saldo: number }>>((acc, tx) => {
      const amt = toNum(tx.amount_chf)
      const isDebit = tx.debit_account_number === account.number
      const soll = isDebit ? amt : 0
      const haben = isDebit ? 0 : amt
      const prevSaldo = acc.length ? acc[acc.length - 1].saldo : 0
      const saldo = prevSaldo + (debitNormal ? soll - haben : haben - soll)
      const gegen = isDebit ? tx.credit_account_number : tx.debit_account_number
      acc.push({ tx, soll, haben, gegen, saldo })
      return acc
    }, [])
  }, [account, transactions, debitNormal])

  if (ledger.length === 0) {
    return <div className="rounded-lg border border-dashed border-gray-300 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">{t('noBookings')}</div>
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <Table>
        <TableHeader>
          <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
            <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colDate')}</TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colText')}</TableHead>
            <TableHead className="hidden md:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colGegenkonto')}</TableHead>
            <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colDebit')}</TableHead>
            <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colCredit')}</TableHead>
            <TableHead className="hidden sm:table-cell text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colSaldo')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ledger.map((r) => (
            <TableRow key={r.tx.id} className="border-gray-200 dark:border-gray-700">
              <TableCell className="whitespace-nowrap text-gray-900 dark:text-gray-100">{r.tx.booking_date ? formatDateCompactZurich(r.tx.booking_date) : '–'}</TableCell>
              <TableCell className="whitespace-normal break-words text-gray-700 dark:text-gray-300">
                {r.tx.text || '–'}
                {r.tx.beleg && <span className="ml-1 text-xs text-gray-400">({r.tx.beleg})</span>}
                <span className="mt-0.5 block text-xs text-gray-400 md:hidden">{r.gegen} {nameByNum.get(r.gegen ?? '') ?? ''}</span>
              </TableCell>
              <TableCell className="hidden md:table-cell whitespace-normal break-words text-gray-600 dark:text-gray-400">
                <span className="tabular-nums text-gray-400">{r.gegen || '–'}</span> {nameByNum.get(r.gegen ?? '') ?? ''}
              </TableCell>
              <TableCell className="text-right tabular-nums text-gray-900 dark:text-gray-100">{r.soll ? formatChf(r.soll) : ''}</TableCell>
              <TableCell className="text-right tabular-nums text-gray-900 dark:text-gray-100">{r.haben ? formatChf(r.haben) : ''}</TableCell>
              <TableCell className="hidden sm:table-cell text-right tabular-nums text-gray-600 dark:text-gray-400">{formatChf(r.saldo)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

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
    return <div className="rounded-2xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">{t('noBookings')}</div>
  }

  return (
    <div className="rounded-xl border border-hairline bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('colDate')}</TableHead>
            <TableHead>{t('colText')}</TableHead>
            <TableHead className="hidden md:table-cell">{t('colGegenkonto')}</TableHead>
            <TableHead className="text-right">{t('colDebit')}</TableHead>
            <TableHead className="text-right">{t('colCredit')}</TableHead>
            <TableHead className="hidden sm:table-cell text-right">{t('colSaldo')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ledger.map((r) => (
            <TableRow key={r.tx.id}>
              <TableCell className="whitespace-nowrap text-foreground">{r.tx.booking_date ? formatDateCompactZurich(r.tx.booking_date) : '–'}</TableCell>
              <TableCell className="whitespace-normal break-words text-foreground/85">
                {r.tx.text || '–'}
                {r.tx.beleg && <span className="ml-1 text-xs text-muted-foreground/80">({r.tx.beleg})</span>}
                <span className="mt-0.5 block text-xs text-muted-foreground/80 md:hidden">{r.gegen} {nameByNum.get(r.gegen ?? '') ?? ''}</span>
              </TableCell>
              <TableCell className="hidden md:table-cell whitespace-normal break-words text-muted-foreground">
                <span className="tabular-nums text-muted-foreground/80">{r.gegen || '–'}</span> {nameByNum.get(r.gegen ?? '') ?? ''}
              </TableCell>
              <TableCell className="text-right tabular-nums text-foreground">{r.soll ? formatChf(r.soll) : ''}</TableCell>
              <TableCell className="text-right tabular-nums text-foreground">{r.haben ? formatChf(r.haben) : ''}</TableCell>
              <TableCell className="hidden sm:table-cell text-right tabular-nums text-muted-foreground">{formatChf(r.saldo)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import {
  useFinanceAccounts, useFinanceFiscalYears, useFinanceTransactions, useFinanceInvoices,
  toNum, formatChf, isOpenInvoice,
} from '../../hooks/useFinance'

/** KPI tile. */
function Kpi({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'pos' | 'neg' }) {
  const toneClass =
    tone === 'pos' ? 'text-green-600 dark:text-green-400'
    : tone === 'neg' ? 'text-red-600 dark:text-red-400'
    : 'text-gray-900 dark:text-gray-100'
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`mt-1.5 text-xl font-bold tabular-nums sm:text-2xl ${toneClass}`}>{value}</div>
    </div>
  )
}

export default function FinancePage() {
  const { t } = useTranslation('finance')

  const { data: fiscalYearsRaw } = useFinanceFiscalYears()
  const fiscalYears = fiscalYearsRaw ?? []
  const [fyId, setFyId] = useState<string>('')
  // Default to the newest fiscal year once they load.
  const activeFyId = fyId || (fiscalYears[0]?.id ?? '')

  const { data: accountsRaw } = useFinanceAccounts()
  const accounts = accountsRaw ?? []
  const { data: txRaw, isLoading } = useFinanceTransactions(activeFyId || null, !!activeFyId)
  const transactions = txRaw ?? []
  const { data: invoicesRaw } = useFinanceInvoices()
  const invoices = invoicesRaw ?? []

  // Per-account debit/credit totals from the ledger (keyed by account number).
  const accountStats = useMemo(() => {
    const map = new Map<string, { debit: number; credit: number }>()
    const bump = (num: string | null, key: 'debit' | 'credit', amt: number) => {
      if (!num) return
      const e = map.get(num) ?? { debit: 0, credit: 0 }
      e[key] += amt
      map.set(num, e)
    }
    for (const tx of transactions) {
      const amt = toNum(tx.amount_chf)
      bump(tx.debit_account_number, 'debit', amt)
      bump(tx.credit_account_number, 'credit', amt)
    }
    return map
  }, [transactions])

  const kpis = useMemo(() => {
    let treasury = 0, income = 0, expense = 0
    for (const a of accounts) {
      const s = accountStats.get(a.number) ?? { debit: 0, credit: 0 }
      if (a.number.startsWith('10')) treasury += s.debit - s.credit // liquid assets (Bank/Kasse)
      if (a.type === 'income') income += s.credit - s.debit
      if (a.type === 'expense') expense += s.debit - s.credit
    }
    return { treasury, income, expense, result: income - expense }
  }, [accounts, accountStats])

  const outstanding = useMemo(
    () => invoices.filter(isOpenInvoice).reduce((acc, i) => acc + toNum(i.open_amount), 0),
    [invoices],
  )

  // Income / expense breakdown by account, largest first, for the bar list.
  const breakdown = useMemo(() => {
    const rows = accounts
      .filter((a) => a.type === 'income' || a.type === 'expense')
      .map((a) => {
        const s = accountStats.get(a.number) ?? { debit: 0, credit: 0 }
        const value = a.type === 'income' ? s.credit - s.debit : s.debit - s.credit
        return { number: a.number, name: a.name, type: a.type as 'income' | 'expense', value }
      })
      .filter((r) => Math.abs(r.value) > 0.005)
      .sort((a, b) => b.value - a.value)
    const max = rows.reduce((m, r) => Math.max(m, Math.abs(r.value)), 0) || 1
    return { rows, max }
  }, [accounts, accountStats])

  const recent = transactions.slice(0, 50)

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('boardSubtitle')}</p>
        </div>
        {fiscalYears.length > 0 && (
          <select
            value={activeFyId}
            onChange={(e) => setFyId(e.target.value)}
            className="rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            aria-label={t('fiscalYear')}
          >
            {fiscalYears.map((fy) => (
              <option key={fy.id} value={fy.id}>{fy.label}</option>
            ))}
          </select>
        )}
      </div>

      {!isLoading && transactions.length === 0 && invoices.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {t('noData')}
        </div>
      ) : (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label={t('treasury')} value={formatChf(kpis.treasury)} />
            <Kpi label={`${t('income')} · ${t('thisYear')}`} value={formatChf(kpis.income)} tone="pos" />
            <Kpi label={`${t('expense')} · ${t('thisYear')}`} value={formatChf(kpis.expense)} tone="neg" />
            <Kpi label={t('result')} value={formatChf(kpis.result)} tone={kpis.result >= 0 ? 'pos' : 'neg'} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Kpi label={t('outstandingDues')} value={formatChf(outstanding)} />
          </div>

          {/* Income & expenses by account */}
          {breakdown.rows.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">{t('byAccount')}</h2>
              <div className="space-y-1.5 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                {breakdown.rows.map((r) => (
                  <div key={r.number} className="flex items-center gap-3">
                    <div className="w-40 shrink-0 truncate text-xs text-gray-600 dark:text-gray-300" title={`${r.number} ${r.name}`}>
                      <span className="tabular-nums text-gray-400">{r.number}</span> {r.name}
                    </div>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                      <div
                        className={`h-full rounded-full ${r.type === 'income' ? 'bg-green-500 dark:bg-green-400' : 'bg-red-500 dark:bg-red-400'}`}
                        style={{ width: `${Math.max(2, (Math.abs(r.value) / breakdown.max) * 100)}%` }}
                      />
                    </div>
                    <div className="w-28 shrink-0 text-right text-xs tabular-nums text-gray-700 dark:text-gray-300">
                      {formatChf(r.value)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Recent bookings */}
          {recent.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">{t('recentBookings')}</h2>
              <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                      <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colDate')}</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colText')}</TableHead>
                      <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colDebit')}</TableHead>
                      <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colCredit')}</TableHead>
                      <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colAmount')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recent.map((tx) => (
                      <TableRow key={tx.id} className="border-gray-200 dark:border-gray-700">
                        <TableCell className="whitespace-nowrap text-gray-900 dark:text-gray-100">
                          {tx.booking_date ? formatDateCompactZurich(tx.booking_date) : '–'}
                        </TableCell>
                        <TableCell className="whitespace-normal break-words text-gray-700 dark:text-gray-300">
                          {tx.text || '–'}
                          <span className="mt-0.5 block text-xs text-gray-400 sm:hidden">
                            {tx.debit_account_number} → {tx.credit_account_number || '–'}
                          </span>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-gray-600 dark:text-gray-400" title={tx.debit_account_name ?? ''}>
                          {tx.debit_account_number || '–'}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-gray-600 dark:text-gray-400" title={tx.credit_account_name ?? ''}>
                          {tx.credit_account_number || '–'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-gray-900 dark:text-gray-100">
                          {tx.amount_chf == null || tx.amount_chf === '' ? '–' : formatChf(tx.amount_chf)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}

          <p className="text-xs text-gray-400 dark:text-gray-500">{t('mirrorNote')}</p>
        </>
      )}
    </div>
  )
}

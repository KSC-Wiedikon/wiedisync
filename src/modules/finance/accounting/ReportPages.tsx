import { Fragment, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { formatChf } from '../../../hooks/useFinance'
import { useReportPageLoading } from '../../../hooks/usePageReady'
import AccountLedger from '../AccountLedger'
import BudgetTab from '../BudgetTab'
import ReportExportMenu from '../ReportExportMenu'
import type { FinanceReport } from '../reportExport'
import type { FinanceTransaction } from '../types'
import { useAccountingFy } from './fyContext'
import { useClubBook, type AcctRow } from './useClubBook'

const ORG = 'KSC Wiedikon'
const card = 'rounded-2xl border border-hairline bg-card shadow-card'
const pos = 'text-green-600 dark:text-green-400'
const neg = 'text-red-600 dark:text-red-400'
const inputCls = 'h-11 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 dark:bg-gray-800'

/** Shared loading gate for the pages that read the club's book. */
function useBookPage() {
  const fy = useAccountingFy()
  const book = useClubBook(fy.fyId)
  const loading = fy.loading || book.loading
  useReportPageLoading(loading)
  return { ...fy, book, loading }
}

/** A statement section: account lines + total; a row opens that account's bookings. */
function StatementTable({ title, rows, total, totalLabel, transactions, nameByNum }: {
  title: string; rows: AcctRow[]; total: number; totalLabel: string
  transactions: FinanceTransaction[]; nameByNum: Map<string, string>
}) {
  const { t } = useTranslation('finance')
  const [open, setOpen] = useState<string | null>(null)
  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h2>
      <div className={`${card} overflow-hidden`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colAccount')}</TableHead>
              <TableHead className="text-right">{t('colAmount')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <Fragment key={a.number}>
                <TableRow className="cursor-pointer hover:bg-muted" onClick={() => setOpen((p) => (p === a.number ? null : a.number))} aria-expanded={open === a.number}>
                  <TableCell className="whitespace-normal break-words text-foreground/85">
                    <span className="mr-1 inline-block align-middle text-muted-foreground/80">
                      {open === a.number ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </span>
                    <span className="tabular-nums text-muted-foreground/80">{a.number}</span> {a.name}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums text-foreground">{formatChf(a.bal)}</TableCell>
                </TableRow>
                {open === a.number && (
                  <TableRow>
                    <TableCell colSpan={2} className="bg-surface-sunken p-2">
                      <AccountLedger account={a} transactions={transactions} nameByNum={nameByNum} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
            <TableRow className="border-t-2 border-input font-semibold">
              <TableCell className="text-foreground">{totalLabel}</TableCell>
              <TableCell className="text-right tabular-nums text-foreground">{formatChf(total)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

const acctCell = (a: AcctRow) => `${a.number} · ${a.name}`

export function IncomeStatementPage() {
  const { t } = useTranslation('finance')
  const { book, fyLabel, loading } = useBookPage()
  if (loading) return null
  const build = (): FinanceReport => ({
    title: t('tabIncome'), org: ORG, period: fyLabel,
    columns: [{ label: t('colAccount'), type: 'text' }, { label: 'CHF', type: 'money' }],
    sections: [
      { heading: t('income'), rows: [...book.incomeRows.map((a) => ({ cells: [acctCell(a), a.bal] })), { cells: [t('totalIncome'), book.totalIncome], bold: true }] },
      { heading: t('expense'), rows: [...book.expenseRows.map((a) => ({ cells: [acctCell(a), a.bal] })), { cells: [t('totalExpenses'), book.totalExpense], bold: true }] },
      { rows: [{ cells: [t('netResult'), book.result], bold: true }] },
    ],
  })
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t('accClickRowHint')}</p>
        <ReportExportMenu build={build} filename={`income-statement-${fyLabel}`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <StatementTable title={t('income')} rows={book.incomeRows} total={book.totalIncome} totalLabel={t('totalIncome')} transactions={book.plTransactions} nameByNum={book.nameByNum} />
        <StatementTable title={t('expense')} rows={book.expenseRows} total={book.totalExpense} totalLabel={t('totalExpenses')} transactions={book.plTransactions} nameByNum={book.nameByNum} />
      </div>
      <div className={`${card} border-2 border-input p-4`}>
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-foreground">{t('netResult')}</span>
          <span className={`text-xl font-bold tabular-nums ${book.result >= 0 ? pos : neg}`}>{formatChf(book.result)}</span>
        </div>
      </div>
    </div>
  )
}

export function BalanceSheetPage() {
  const { t } = useTranslation('finance')
  const { book, fyLabel, loading } = useBookPage()
  if (loading) return null
  const build = (): FinanceReport => ({
    title: t('tabBalance'), org: ORG, period: fyLabel,
    columns: [{ label: t('colAccount'), type: 'text' }, { label: 'CHF', type: 'money' }],
    sections: [
      { heading: t('assets'), rows: [...book.assetRows.map((a) => ({ cells: [acctCell(a), a.bal] })), { cells: [t('totalAssets'), book.totalAssets], bold: true }] },
      { heading: t('liabilitiesEquity'), rows: [...book.liabEqRows.map((a) => ({ cells: [acctCell(a), a.bal] })), { cells: [t('totalLiabEquity'), book.totalLiabEq], bold: true }] },
    ],
  })
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t('accClickRowHint')}</p>
        <ReportExportMenu build={build} filename={`balance-sheet-${fyLabel}`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <StatementTable title={t('assets')} rows={book.assetRows} total={book.totalAssets} totalLabel={t('totalAssets')} transactions={book.transactions} nameByNum={book.nameByNum} />
        <StatementTable title={t('liabilitiesEquity')} rows={book.liabEqRows} total={book.totalLiabEq} totalLabel={t('totalLiabEquity')} transactions={book.transactions} nameByNum={book.nameByNum} />
      </div>
    </div>
  )
}

export function BudgetPage() {
  const { book, fyId, fyLabel, loading } = useBookPage()
  if (loading) return null
  return <BudgetTab rows={book.accountRows.filter((a) => a.type === 'income' || a.type === 'expense')} fiscalYearId={fyId} fiscalYearLabel={fyLabel} />
}

const CATEGORY_ORDER = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

/**
 * Every account in one table (number, name, kind, balance for the year), searchable,
 * grouped by the leading digit. A row opens the account statement (`?acc=1020`), which
 * is also where the search box's account hits land.
 */
export function AccountsPage() {
  const { t } = useTranslation('finance')
  const { book, fyLabel, loading } = useBookPage()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [withBookings, setWithBookings] = useState(true)
  const selected = params.get('acc')

  const typeLabel = (ty: string | null) =>
    ty === 'asset' ? t('accTypeAsset') : ty === 'liability' ? t('accTypeLiability') : ty === 'equity' ? t('accTypeEquity')
    : ty === 'income' ? t('income') : ty === 'expense' ? t('expense') : '–'
  const catLabel = (d: string) =>
    d === '1' ? t('assets') : d === '2' ? t('liabilitiesEquity') : d === '3' ? t('income')
    : d === '9' ? t('catClosing') : t('expense')

  const used = useMemo(() => {
    const s = new Set<string>()
    for (const tx of book.transactions) { if (tx.debit_account_number) s.add(tx.debit_account_number); if (tx.credit_account_number) s.add(tx.credit_account_number) }
    return s
  }, [book.transactions])

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const rows = book.accountRows
      .filter((a) => !withBookings || used.has(a.number))
      .filter((a) => !needle || a.number.includes(needle) || a.name.toLowerCase().includes(needle))
      .sort((x, y) => x.number.localeCompare(y.number))
    return CATEGORY_ORDER.map((d) => ({ d, rows: rows.filter((a) => a.number.startsWith(d)) })).filter((g) => g.rows.length > 0)
  }, [book.accountRows, q, withBookings, used])

  if (loading) return null

  const acct = selected ? book.accountRows.find((a) => a.number === selected) : undefined
  if (selected) {
    const back = () => setParams((p) => { const n = new URLSearchParams(p); n.delete('acc'); return n })
    return (
      <div className="space-y-4">
        <Button type="button" variant="ghost" onClick={back} className="-ml-2 gap-1.5 text-muted-foreground"><ArrowLeft className="h-4 w-4" />{t('accAllAccounts')}</Button>
        {!acct ? (
          <p className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">{t('accUnknownAccount', { number: selected })}</p>
        ) : (
          <>
            <div className={`${card} flex flex-wrap items-baseline gap-x-4 gap-y-1 p-4`}>
              <h2 className="min-w-0 flex-1 break-words text-lg font-semibold text-foreground">
                <span className="tabular-nums text-muted-foreground">{acct.number}</span> {acct.name}
              </h2>
              <span className="text-sm text-muted-foreground">{typeLabel(acct.type)} · {fyLabel}</span>
              <span className="text-lg font-bold tabular-nums text-foreground">{formatChf(acct.bal)}</span>
            </div>
            <AccountLedger account={acct} transactions={acct.type === 'income' || acct.type === 'expense' ? book.plTransactions : book.transactions} nameByNum={book.nameByNum} />
          </>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('accFilterAccounts')} aria-label={t('accFilterAccounts')} className={inputCls} />
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground sm:min-h-0">
          <input type="checkbox" checked={withBookings} onChange={(e) => setWithBookings(e.target.checked)} className="h-4 w-4 accent-primary" />
          {t('accOnlyWithBookings')}
        </label>
      </div>
      {groups.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">{t('accNoAccountsMatch')}</p>
      ) : (
        <div className={`${card} overflow-hidden`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="hidden w-20 sm:table-cell">{t('accColNumber')}</TableHead>
                <TableHead>{t('colAccount')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('accColType')}</TableHead>
                <TableHead className="text-right">{t('accColBalance')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <Fragment key={g.d}>
                  <TableRow className="bg-surface-sunken hover:bg-surface-sunken">
                    <TableCell colSpan={4} className="py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{g.d} · {catLabel(g.d)}</TableCell>
                  </TableRow>
                  {g.rows.map((a) => (
                    <TableRow key={a.number} className="cursor-pointer hover:bg-muted">
                      <TableCell className="hidden tabular-nums text-muted-foreground sm:table-cell">
                        <Link to={`?acc=${encodeURIComponent(a.number)}`} className="block py-1">{a.number}</Link>
                      </TableCell>
                      <TableCell className="whitespace-normal break-words text-foreground">
                        <Link to={`?acc=${encodeURIComponent(a.number)}`} className="block py-1 hover:underline">
                          <span className="tabular-nums text-muted-foreground sm:hidden">{a.number} </span>{a.name}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">{typeLabel(a.type)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums text-foreground">{formatChf(a.bal)}</TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

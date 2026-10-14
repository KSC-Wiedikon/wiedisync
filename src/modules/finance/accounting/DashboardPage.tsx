import { useMemo, useState, type ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BellRing, ChevronRight, CircleCheck, GitCompareArrows, Landmark, Paperclip, Receipt, RefreshCw } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import TruncatedText from '../../../components/TruncatedText'
import { formatDateCompactZurich, formatDateTimeCompactZurich } from '../../../utils/dateHelpers'
import {
  formatChf, isOpenInvoice, toNum, useAllExpenses, useDunningCandidates, useFinanceImports, useFinanceInvoices,
} from '../../../hooks/useFinance'
import { useBankLines, useParallel, useReceiptCoverage } from '../../../hooks/useFinanceBooks'
import { useAuth } from '../../../hooks/useAuth'
import { useReportPageLoading } from '../../../hooks/usePageReady'
import { useAccountingFy } from './fyContext'
import { resultEffect, useClubBook, type MonthPoint } from './useClubBook'

const card = 'rounded-2xl border border-hairline bg-card shadow-card'
const sectionTitle = 'text-base font-semibold text-foreground'
const pos = 'text-green-600 dark:text-green-400'
const neg = 'text-red-600 dark:text-red-400'
const STALE_SYNC_MS = 30 * 3600 * 1000

function Kpi({ label, value, hint, tone = 'default', to }: { label: string; value: string; hint?: string; tone?: 'default' | 'pos' | 'neg'; to?: string }) {
  const body = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className={`mt-1.5 whitespace-nowrap text-lg font-bold tabular-nums sm:text-2xl xl:text-xl 2xl:text-2xl ${tone === 'pos' ? pos : tone === 'neg' ? neg : 'text-foreground'}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </>
  )
  return to
    ? <Link to={to} className={`${card} block p-4 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>{body}</Link>
    : <div className={`${card} p-4`}>{body}</div>
}

interface Todo { key: string; icon: ComponentType<{ className?: string }>; text: string; to: string; tone: 'warn' | 'info' }

export default function DashboardPage() {
  const { t } = useTranslation('finance')
  const { fyId, fyLabel, loading: fyLoading } = useAccountingFy()
  const { isRevisor } = useAuth()
  const book = useClubBook(fyId)
  const { data: invoices } = useFinanceInvoices()
  const { data: imports } = useFinanceImports(!isRevisor)
  const { data: bank } = useBankLines('open', fyId, !!fyId)
  const { data: coverage } = useReceiptCoverage(fyId, !!fyId)
  const { data: parallel } = useParallel(fyId, null, !!fyId)
  const { data: dunning } = useDunningCandidates()
  const { data: expenses } = useAllExpenses(!isRevisor)
  useReportPageLoading(fyLoading || book.loading)
  // Read once per visit — render must stay pure.
  const [now] = useState(() => Date.now())

  const open = useMemo(() => (invoices ?? []).filter(isOpenInvoice), [invoices])
  const outstanding = open.reduce((s, i) => s + toNum(i.open_amount), 0)

  const todos = useMemo<Todo[]>(() => {
    const list: Todo[] = []
    const lines = bank?.lines.length ?? 0
    if (lines > 0) list.push({ key: 'bank', icon: Landmark, text: t('accTodoBank', { count: lines }), to: '/bank', tone: 'warn' })
    const pending = (expenses ?? []).filter((e) => (e.status || 'pending') === 'pending').length
    if (pending > 0) list.push({ key: 'expenses', icon: Receipt, text: t('accTodoExpenses', { count: pending }), to: '/expenses', tone: 'warn' })
    const overdue = dunning?.candidates.length ?? 0
    if (overdue > 0) list.push({ key: 'dunning', icon: BellRing, text: t('accTodoDunning', { count: overdue }), to: '/reminders', tone: 'warn' })
    const thisMonth = new Date(now).toISOString().slice(0, 7)
    const unsigned = (parallel?.months ?? []).filter((m) => !m.signoff && m.month < thisMonth).length
    if (unsigned > 0) list.push({ key: 'parallel', icon: GitCompareArrows, text: t('accTodoParallel', { count: unsigned }), to: '/parallel', tone: 'warn' })
    const missing = coverage?.missing ?? 0
    if (missing > 0) list.push({ key: 'receipts', icon: Paperclip, text: t('accTodoReceipts', { count: missing }), to: '/journal', tone: 'warn' })
    const last = imports?.[0]?.imported_at
    if (!isRevisor && imports && (!last || now - Date.parse(last) > STALE_SYNC_MS)) {
      list.push({ key: 'sync', icon: RefreshCw, text: t('accTodoSync'), to: '/sync', tone: 'warn' })
    }
    return list
  }, [bank, expenses, dunning, parallel, coverage, imports, isRevisor, now, t])

  if (fyLoading || book.loading) return null
  // A ClubDesk compound booking ("Rechnung (Sammel)") is a header with no amount and
  // no credit account; its "Sammelposition" lines carry the money and follow it.
  const recent = book.transactions.filter((tx) => tx.amount_chf != null).slice(0, 12)
  const divLabel = (d: string) => d === 'vb' ? t('divVb') : d === 'bb' ? t('divBb') : t('divClub')

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5 [&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1">
        <Kpi label={t('treasury')} value={formatChf(book.treasury)} hint={t('accKpiTreasuryHint')} to="/balance-sheet" />
        <Kpi label={t('income')} value={formatChf(book.totalIncome)} hint={fyLabel} tone="pos" to="/income-statement" />
        <Kpi label={t('expense')} value={formatChf(book.totalExpense)} hint={fyLabel} tone="neg" to="/income-statement" />
        <Kpi label={t('result')} value={formatChf(book.result)} hint={fyLabel} tone={book.result >= 0 ? 'pos' : 'neg'} to="/income-statement" />
        <Kpi label={t('outstandingDues')} value={formatChf(outstanding)} hint={t('accKpiOpenInvoices', { count: open.length })} to="/invoices" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className={`${card} p-4`}>
          <h2 className={sectionTitle}>{t('accTodoTitle')}</h2>
          {todos.length === 0 ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><CircleCheck className={`h-5 w-5 ${pos}`} />{t('accTodoNone')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {todos.map((td) => (
                <li key={td.key}>
                  <Link to={td.to} className="flex min-h-12 items-center gap-3 rounded-lg px-1 py-2 text-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                      <td.icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1 text-foreground">{td.text}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {!isRevisor && imports?.[0] && (
            <p className="mt-3 text-xs text-muted-foreground">{t('accLastSync', { when: formatDateTimeCompactZurich(imports[0].imported_at) })}</p>
          )}
        </section>

        <section className={`${card} p-4`}>
          <h2 className={sectionTitle}>{t('accMonthlyTitle')}</h2>
          <MonthlyChart points={book.monthly} />
        </section>
      </div>

      {book.divisions.length > 0 && (
        <section>
          <h2 className={`mb-3 ${sectionTitle}`}>{t('byDivision')}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {book.divisions.map((dv) => (
              <div key={dv.d} className={`${card} p-4`}>
                <div className="text-sm font-semibold text-foreground">{divLabel(dv.d)}</div>
                <div className="mt-2 space-y-1 text-sm tabular-nums">
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground">{t('income')}</span><span className={pos}>{formatChf(dv.inc)}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground">{t('expense')}</span><span className={neg}>{formatChf(dv.exp)}</span></div>
                  <div className="flex justify-between gap-2 border-t border-border pt-1 font-semibold"><span className="text-foreground/85">{t('result')}</span><span className={dv.net >= 0 ? pos : neg}>{formatChf(dv.net)}</span></div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline gap-3">
            <h2 className={`flex-1 ${sectionTitle}`}>{t('recentBookings')}</h2>
            <Link to="/journal" className="text-sm font-medium text-primary hover:underline dark:text-brand-300">{t('accShowAll')}</Link>
          </div>
          <div className={`${card} overflow-hidden`}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="hidden sm:table-cell">{t('colDate')}</TableHead>
                  <TableHead>{t('colText')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('colDebit')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('colCredit')}</TableHead>
                  <TableHead className="text-right">{t('colAmount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((tx) => {
                  // Green + for income, red − for an expense; a transfer between the club's own accounts stays neutral.
                  const effect = resultEffect(tx, book.typeByNum)
                  const kind = effect > 0.005 ? 'income' : effect < -0.005 ? 'expense' : null
                  return (
                    <TableRow key={tx.id}>
                      <TableCell className="hidden sm:table-cell whitespace-nowrap text-foreground">{tx.booking_date ? formatDateCompactZurich(tx.booking_date) : '–'}</TableCell>
                      <TableCell className="whitespace-normal break-words text-foreground/85">
                        {tx.text || '–'}
                        <span className="mt-0.5 block text-xs text-muted-foreground/80 sm:hidden">{tx.booking_date ? formatDateCompactZurich(tx.booking_date) : '–'} · {tx.debit_account_number} → {tx.credit_account_number || '–'}</span>
                      </TableCell>
                      <AccountCell num={tx.debit_account_number} name={tx.debit_account_name || book.nameByNum.get(tx.debit_account_number ?? '') || ''} />
                      <AccountCell num={tx.credit_account_number} name={tx.credit_account_name || book.nameByNum.get(tx.credit_account_number ?? '') || ''} />
                      <TableCell
                        className={`whitespace-nowrap text-right tabular-nums ${kind === 'income' ? pos : kind === 'expense' ? neg : 'text-foreground'}`}
                        title={kind ? t(kind) : undefined}
                      >
                        {kind === 'income' ? '+' : kind === 'expense' ? '−' : ''}{formatChf(tx.amount_chf)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      <p className="text-xs text-muted-foreground/80">{t('mirrorNote')}</p>
    </div>
  )
}

/** Account number (links to its ledger) with the account's name beneath it where the table has room. */
function AccountCell({ num, name }: { num: string | null; name: string }) {
  return (
    <TableCell className="hidden sm:table-cell text-muted-foreground" title={name}>
      <Link to={`/accounts?acc=${encodeURIComponent(num ?? '')}`} className="hover:underline">{num || '–'}</Link>
      {num && name && <TruncatedText text={name} className="hidden max-w-[11rem] text-xs text-muted-foreground/80 md:block" />}
    </TableCell>
  )
}

/** Income vs expenses per month as paired bars; a table carries the same numbers
 *  for screen readers and for anyone who wants the exact figures (tap "Show figures"). */
function MonthlyChart({ points }: { points: MonthPoint[] }) {
  const { t } = useTranslation('finance')
  if (points.length === 0) return <p className="mt-3 text-sm text-muted-foreground">{t('noBookings')}</p>
  const max = Math.max(1, ...points.flatMap((p) => [p.income, p.expense]))
  const label = (m: string) => `${m.slice(5, 7)}.${m.slice(2, 4)}`
  const h = (v: number) => `${Math.max(0, (v / max) * 100)}%`
  const plain = (v: number) => formatChf(v).replace(/^CHF\u00a0/, '')
  return (
    <div className="mt-3">
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-green-500" aria-hidden="true" />{t('income')}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-400" aria-hidden="true" />{t('expense')}</span>
      </div>
      <div className="mt-3 flex h-44 items-end gap-1.5 overflow-x-auto sm:gap-2" aria-hidden="true">
        {points.map((p) => (
          <div key={p.month} className="flex h-full min-w-[1.75rem] flex-1 flex-col items-center"
            title={`${label(p.month)} — ${t('income')}: ${formatChf(p.income)}, ${t('expense')}: ${formatChf(p.expense)}`}>
            <div className="flex w-full flex-1 items-end justify-center gap-0.5">
              <div className="w-1/2 max-w-4 rounded-t bg-green-500" style={{ height: h(p.income) }} />
              <div className="w-1/2 max-w-4 rounded-t bg-red-400" style={{ height: h(p.expense) }} />
            </div>
            <div className="mt-1 text-[10px] tabular-nums text-muted-foreground">{label(p.month)}</div>
          </div>
        ))}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer select-none py-2 text-sm font-medium text-primary dark:text-brand-300">{t('accShowFigures')}</summary>
        {/* Plain figures (CHF in the headers) so four columns fit a phone. */}
        <div className="mt-2 overflow-hidden rounded-xl border border-hairline">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('accMonth')}</TableHead>
                <TableHead className="text-right">{t('income')} CHF</TableHead>
                <TableHead className="text-right">{t('expense')} CHF</TableHead>
                <TableHead className="hidden sm:table-cell text-right">{t('result')} CHF</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {points.map((p) => (
                <TableRow key={p.month}>
                  <TableCell className="tabular-nums">{label(p.month)}</TableCell>
                  <TableCell className={`whitespace-nowrap text-right tabular-nums ${pos}`}>{plain(p.income)}</TableCell>
                  <TableCell className={`whitespace-nowrap text-right tabular-nums ${neg}`}>{plain(p.expense)}</TableCell>
                  <TableCell className={`hidden sm:table-cell whitespace-nowrap text-right tabular-nums ${p.income - p.expense >= 0 ? pos : neg}`}>{plain(p.income - p.expense)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </details>
    </div>
  )
}

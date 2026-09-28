import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { formatDateCompactZurich, formatDateTimeCompactZurich } from '../../utils/dateHelpers'
import {
  useFinanceAccounts, useFinanceFiscalYears, useFinanceTransactions, useFinanceInvoices, useFinanceImports,
  toNum, formatChf, isOpenInvoice, triggerClubdeskSync, fetchClubdeskSyncStatus,
} from '../../hooks/useFinance'
import { useReportPageLoading } from '../../hooks/usePageReady'
import type { FinanceAccount, FinanceTransaction } from './types'
import AccountExplorer from './AccountExplorer'
import AccountLedger from './AccountLedger'
import InvoiceManager from './InvoiceManager'
import DuesRunManager from './DuesRunManager'
import TeamFinance from './TeamFinance'
import BudgetTab from './BudgetTab'
import DunningConsole from './DunningConsole'
import LedgerTab from './LedgerTab'
import FinanceMemberExplorer from './FinanceMemberExplorer'
import ExpensesTab from './ExpensesTab'
import ReportExportMenu from './ReportExportMenu'
import type { FinanceReport } from './reportExport'

type Tab = 'overview' | 'income' | 'budget' | 'balance' | 'ledger' | 'accounts' | 'invoices' | 'dues' | 'dunning' | 'expenses' | 'members' | 'teams' | 'sync'

const TAB_LABEL: Record<Tab, string> = {
  overview: 'tabOverview', income: 'tabIncome', budget: 'tabBudget', balance: 'tabBalance',
  ledger: 'tabLedger', accounts: 'tabAccounts', invoices: 'tabInvoices', dues: 'tabDues',
  dunning: 'tabDunning', expenses: 'tabExpenses', members: 'tabMembers', teams: 'tabTeams',
  sync: 'tabSync',
}

/** Tabs grouped by the treasurer's job, not by which component was built first.
 *  Billing leads because that is now where the club's invoices come from. */
const TAB_GROUPS: Array<{ key: string; labelKey: string; tabs: Tab[] }> = [
  { key: 'summary', labelKey: 'tabGroupSummary', tabs: ['overview'] },
  { key: 'billing', labelKey: 'tabGroupBilling', tabs: ['dues', 'invoices', 'dunning'] },
  { key: 'books', labelKey: 'tabGroupBooks', tabs: ['income', 'balance', 'budget', 'ledger', 'accounts'] },
  { key: 'records', labelKey: 'tabGroupRecords', tabs: ['members', 'teams', 'expenses'] },
  { key: 'data', labelKey: 'tabGroupData', tabs: ['sync'] },
]

/** On-demand "Sync now" — requests a ClubDesk finance import and polls until the
 *  host dispatcher reports done/failed (state changes in the handler, not an effect). */
function SyncNowButton() {
  const { t } = useTranslation('finance')
  const qc = useQueryClient()
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  // Guard against the polling loop running / setState firing after the Sync tab
  // (and this button) unmounts mid-poll.
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])
  async function go() {
    setSyncing(true); setError('')
    try {
      await triggerClubdeskSync()
      const deadline = Date.now() + 240000
      for (;;) {
        await new Promise((r) => setTimeout(r, 5000))
        if (!mountedRef.current) return
        const s = await fetchClubdeskSyncStatus()
        if (!mountedRef.current) return
        if (s.state === 'done') break
        if (s.state === 'failed') throw new Error(s.message || t('syncFailed'))
        if (Date.now() > deadline) throw new Error(t('syncTimeout'))
      }
      await qc.invalidateQueries({ queryKey: ['finance'] })
    } catch (e) {
      if (!mountedRef.current) return
      setError((e as { body?: { error?: string } })?.body?.error || (e as Error)?.message || t('syncFailed'))
    } finally { if (mountedRef.current) setSyncing(false) }
  }
  return (
    <div className="mt-3">
      <Button type="button" disabled={syncing} onClick={go}>
        {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{syncing ? t('syncing') : t('syncNow')}
      </Button>
      {syncing && <p className="mt-1.5 text-xs text-muted-foreground">{t('syncingNote')}</p>}
      {error && <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}

/** Aggregate debit/credit totals per account number from a set of transactions. */
function statsFrom(rows: FinanceTransaction[]) {
  const map = new Map<string, { debit: number; credit: number }>()
  const bump = (num: string | null, key: 'debit' | 'credit', amt: number) => {
    if (!num) return
    const e = map.get(num) ?? { debit: 0, credit: 0 }
    e[key] += amt
    map.set(num, e)
  }
  for (const tx of rows) {
    const amt = toNum(tx.amount_chf)
    bump(tx.debit_account_number, 'debit', amt)
    bump(tx.credit_account_number, 'credit', amt)
  }
  return map
}
type AcctRow = FinanceAccount & { bal: number }

/** KPI tile. */
function Kpi({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'pos' | 'neg' }) {
  const toneClass =
    tone === 'pos' ? 'text-green-600 dark:text-green-400'
    : tone === 'neg' ? 'text-red-600 dark:text-red-400'
    : 'text-foreground'
  return (
    <div className="rounded-2xl border border-hairline bg-card shadow-card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className={`mt-1.5 text-xl font-bold tabular-nums sm:text-2xl ${toneClass}`}>{value}</div>
    </div>
  )
}

/** Dashboard view-switch button. */
function TabBtn({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-pressed={active}
      onClick={onClick}
      className={`px-3 ${
        active
          ? 'bg-selected text-selected-foreground hover:bg-selected/90 hover:text-selected-foreground'
          : 'text-muted-foreground hover:bg-accent'
      }`}
    >{label}</Button>
  )
}

/** A financial-statement section: account line items + a total row. Rows drill into
 *  the account ledger (inline) when onToggle + renderDetail are provided. */
function StatementTable({ title, rows, total, totalLabel, accLabel, amtLabel, expandedNum, onToggle, renderDetail }: {
  title: string; rows: AcctRow[]; total: number; totalLabel: string; accLabel: string; amtLabel: string
  expandedNum?: string | null; onToggle?: (n: string) => void; renderDetail?: (a: AcctRow) => ReactNode
}) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h3>
      <div className="rounded-2xl border border-hairline bg-card shadow-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{accLabel}</TableHead>
              <TableHead className="text-right">{amtLabel}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <Fragment key={a.number}>
                <TableRow
                  className={`${onToggle ? 'cursor-pointer hover:bg-muted' : ''}`}
                  onClick={onToggle ? () => onToggle(a.number) : undefined}
                >
                  <TableCell className="whitespace-normal break-words text-foreground/85">
                    {onToggle && (
                      <span className="mr-1 inline-block align-middle text-muted-foreground/80">
                        {expandedNum === a.number ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </span>
                    )}
                    <span className="tabular-nums text-muted-foreground/80">{a.number}</span> {a.name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-foreground">{formatChf(a.bal)}</TableCell>
                </TableRow>
                {expandedNum === a.number && renderDetail && (
                  <TableRow>
                    <TableCell colSpan={2} className="bg-surface-sunken p-2">{renderDetail(a)}</TableCell>
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

export default function FinancePage() {
  const { t } = useTranslation('finance')
  // Tab lives in the URL (?tab=) so a refresh / shared link keeps the view.
  const [searchParams, setSearchParams] = useSearchParams()
  const TABS: Tab[] = ['overview', 'income', 'budget', 'balance', 'ledger', 'accounts', 'invoices', 'dues', 'dunning', 'expenses', 'members', 'teams', 'sync']
  const tabParam = searchParams.get('tab') as Tab | null
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'overview'
  const setTab = (next: Tab) => setSearchParams((prev) => {
    const p = new URLSearchParams(prev)
    p.set('tab', next)
    if (next !== 'members') p.delete('m') // drop the selected-member param when leaving Members
    return p
  }, { replace: true })
  const [expandedAcct, setExpandedAcct] = useState<string | null>(null)

  const { data: fiscalYearsRaw } = useFinanceFiscalYears()
  const fiscalYears = fiscalYearsRaw ?? []
  const [fyId, setFyId] = useState<string>('')
  const activeFyId = fyId || (fiscalYears[0]?.id ?? '')
  const activeFyLabel = fiscalYears.find((fy) => String(fy.id) === String(activeFyId))?.label ?? ''

  const { data: accountsRaw } = useFinanceAccounts()
  const accounts = accountsRaw ?? []
  // Board dashboard = the ClubDesk-mirror book (source='clubdesk'). The native ledger
  // (source='native') is a parallel book with its own reports — never summed here, or
  // a year with both would double-count. Flip this when native becomes the book of record.
  const { data: txRaw } = useFinanceTransactions(activeFyId || null, !!activeFyId, 'clubdesk')
  const transactions = txRaw ?? []
  const { data: invoicesRaw } = useFinanceInvoices()
  const invoices = invoicesRaw ?? []
  const { data: importsRaw } = useFinanceImports()
  const imports = importsRaw ?? []

  // Whole-page boot flag. The transactions query is DISABLED until fiscal years
  // load (activeFyId is '' at first paint), and a disabled react-query reports
  // isLoading=false — so keying off the transactions loading flag alone lifted
  // the boot gate too early and briefly rendered the "No data" empty state before
  // the real data arrived (the flash of nothing → full dashboard). Stay "loading"
  // until every source the reveal depends on has actually resolved (raw data is
  // `undefined` only while a query is in-flight; an empty result is `[]`).
  const bootLoading =
    fiscalYearsRaw === undefined ||
    accountsRaw === undefined ||
    invoicesRaw === undefined ||
    (!!activeFyId && txRaw === undefined)
  const isLoading = bootLoading

  // Report to the app boot gate — see usePageReady.tsx
  useReportPageLoading(bootLoading)

  // Per-account debit/credit totals. allStats = every booking (balance sheet +
  // liquidity); plStats EXCLUDES year-end closing entries (typ 'Abschluss'), which
  // zero the income/expense accounts — without this a CLOSED fiscal year's P&L
  // reads as 0, because the closing offsets the whole year's nominal activity.
  const nameByNum = useMemo(() => { const m = new Map<string, string>(); for (const a of accounts) m.set(a.number, a.name); return m }, [accounts])
  const plTransactions = useMemo(() => transactions.filter((tx) => tx.typ !== 'Abschluss' && tx.typ !== 'Eroeffnung'), [transactions])
  const allStats = useMemo(() => statsFrom(transactions), [transactions])
  const plStats = useMemo(() => statsFrom(plTransactions), [plTransactions])

  /** Natural-sign balance. Income/expense (nominal) accounts read plStats so a
   *  closed year still shows its real P&L; balance-sheet accounts read allStats. */
  const accountRows = useMemo<AcctRow[]>(() => accounts.map((a) => {
    const nominal = a.type === 'income' || a.type === 'expense'
    const s = (nominal ? plStats : allStats).get(a.number) ?? { debit: 0, credit: 0 }
    const bal = (a.type === 'asset' || a.type === 'expense') ? s.debit - s.credit : s.credit - s.debit
    return { ...a, bal }
  }), [accounts, allStats, plStats])

  const nonZero = (a: AcctRow) => Math.abs(a.bal) > 0.005
  const incomeRows = useMemo(() => accountRows.filter((a) => a.type === 'income' && nonZero(a)).sort((x, y) => y.bal - x.bal), [accountRows])
  const expenseRows = useMemo(() => accountRows.filter((a) => a.type === 'expense' && nonZero(a)).sort((x, y) => y.bal - x.bal), [accountRows])
  const assetRows = useMemo(() => accountRows.filter((a) => a.type === 'asset' && nonZero(a)).sort((x, y) => x.number.localeCompare(y.number)), [accountRows])
  const liabEqRows = useMemo(() => accountRows.filter((a) => (a.type === 'liability' || a.type === 'equity') && nonZero(a)).sort((x, y) => x.number.localeCompare(y.number)), [accountRows])

  const sum = (rows: AcctRow[]) => rows.reduce((s, a) => s + a.bal, 0)
  const totalIncome = sum(incomeRows)
  const totalExpense = sum(expenseRows)
  const result = totalIncome - totalExpense
  const totalAssets = sum(assetRows)
  const totalLiabEq = sum(liabEqRows)

  // Report models for the PDF / Excel / PowerPoint export.
  const ORG = 'KSC Wiedikon'
  const fyLabel = activeFyLabel || String(activeFyId)
  const acctCell = (a: AcctRow) => `${a.number} · ${a.name}`
  const incomeReport = (): FinanceReport => ({
    title: t('tabIncome'), org: ORG, period: fyLabel,
    columns: [{ label: t('colAccount'), type: 'text' }, { label: 'CHF', type: 'money' }],
    sections: [
      { heading: t('income'), rows: [...incomeRows.map((a) => ({ cells: [acctCell(a), a.bal] })), { cells: [t('totalIncome'), totalIncome], bold: true }] },
      { heading: t('expense'), rows: [...expenseRows.map((a) => ({ cells: [acctCell(a), a.bal] })), { cells: [t('totalExpenses'), totalExpense], bold: true }] },
      { rows: [{ cells: [t('netResult'), result], bold: true }] },
    ],
  })
  const balanceReport = (): FinanceReport => ({
    title: t('tabBalance'), org: ORG, period: fyLabel,
    columns: [{ label: t('colAccount'), type: 'text' }, { label: 'CHF', type: 'money' }],
    sections: [
      { heading: t('assets'), rows: [...assetRows.map((a) => ({ cells: [acctCell(a), a.bal] })), { cells: [t('totalAssets'), totalAssets], bold: true }] },
      { heading: t('liabilitiesEquity'), rows: [...liabEqRows.map((a) => ({ cells: [acctCell(a), a.bal] })), { cells: [t('totalLiabEquity'), totalLiabEq], bold: true }] },
    ],
  })
  const treasury = useMemo(() => accountRows.filter((a) => a.number.startsWith('10')).reduce((s, a) => s + a.bal, 0), [accountRows])
  const outstanding = useMemo(() => invoices.filter(isOpenInvoice).reduce((acc, i) => acc + toNum(i.open_amount), 0), [invoices])

  // VB / BB / club division split (income / expense / net).
  const divisions = useMemo(() => (['vb', 'bb', 'club'] as const).map((d) => {
    const inc = incomeRows.filter((a) => a.division === d).reduce((s, a) => s + a.bal, 0)
    const exp = expenseRows.filter((a) => a.division === d).reduce((s, a) => s + a.bal, 0)
    return { d, inc, exp, net: inc - exp }
  }).filter((x) => Math.abs(x.inc) > 0.005 || Math.abs(x.exp) > 0.005), [incomeRows, expenseRows])

  const recent = transactions.slice(0, 50)
  const empty = !isLoading && transactions.length === 0 && invoices.length === 0
  const divLabel = (d: string) => d === 'vb' ? t('divVb') : d === 'bb' ? t('divBb') : t('divClub')
  const importTypeLabel = (ty: string) => ty === 'invoices' ? t('typeInvoices') : ty === 'bookings' ? t('typeBookings') : ty
  const toggleAcct = (n: string) => setExpandedAcct((p) => (p === n ? null : n))

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('boardSubtitle')}</p>
        </div>
        {fiscalYears.length > 0 && (
          <select
            value={activeFyId}
            onChange={(e) => setFyId(e.target.value)}
            className="ml-auto h-11 shrink-0 rounded-lg border border-input bg-card px-3 py-2 text-sm sm:h-9 dark:bg-gray-800 text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('fiscalYear')}
          >
            {fiscalYears.map((fy) => <option key={fy.id} value={fy.id}>{fy.label}</option>)}
          </select>
        )}
      </div>

      {empty ? (
        <div className="rounded-2xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          {t('noData')}
        </div>
      ) : (
        <>
          {/* Thirteen peer tabs in one row gave no clue which of them is a daily
              job and which is a once-a-year one. Grouped by what the treasurer is
              actually doing: bill people → keep the books → look things up →
              move data. Tab ids and the ?tab= URL are unchanged, so existing
              links and bookmarks still land in the right place. */}
          <nav aria-label={t('tabGroupsAria')} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-3">
            {TAB_GROUPS.map((g) => (
              <div key={g.key} className="min-w-0">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t(g.labelKey)}</p>
                <div className="flex flex-wrap gap-1.5">
                  {g.tabs.map((id) => (
                    <TabBtn key={id} active={tab === id} label={t(TAB_LABEL[id])} onClick={() => setTab(id)} />
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {/* ── Invoices (native create/manage + orphan member-linking) ── */}
          {tab === 'invoices' && <InvoiceManager fiscalYearId={String(activeFyId)} fiscalYearLabel={activeFyLabel} />}

          {/* ── Dues run (recurring/batch membership-dues billing) ── */}
          {tab === 'dues' && <DuesRunManager fiscalYearId={String(activeFyId)} fiscalYearLabel={activeFyLabel} />}

          {/* ── Per-team finance (sponsoring + bills) ── */}
          {tab === 'teams' && <TeamFinance fiscalYearId={String(activeFyId)} fiscalYearLabel={activeFyLabel} />}

          {/* ── Dunning / Mahnwesen ── */}
          {tab === 'dunning' && <DunningConsole />}

          {tab === 'expenses' && <ExpensesTab />}

          {/* ── Budget vs actual ── */}
          {tab === 'budget' && <BudgetTab rows={accountRows.filter((a) => a.type === 'income' || a.type === 'expense')} fiscalYearId={String(activeFyId)} fiscalYearLabel={activeFyLabel} />}

          {/* ── Members (per-member finance: contact, billing, invoices) ── */}
          {tab === 'members' && <FinanceMemberExplorer />}

          {/* ── Overview ─────────────────────────────────────────── */}
          {tab === 'overview' && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi label={t('treasury')} value={formatChf(treasury)} />
                <Kpi label={`${t('income')} · ${t('thisYear')}`} value={formatChf(totalIncome)} tone="pos" />
                <Kpi label={`${t('expense')} · ${t('thisYear')}`} value={formatChf(totalExpense)} tone="neg" />
                <Kpi label={t('result')} value={formatChf(result)} tone={result >= 0 ? 'pos' : 'neg'} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Kpi label={t('outstandingDues')} value={formatChf(outstanding)} />
              </div>

              {divisions.length > 0 && (
                <section>
                  <h2 className="mb-3 text-base font-semibold text-foreground">{t('byDivision')}</h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {divisions.map((dv) => (
                      <div key={dv.d} className="rounded-2xl border border-hairline bg-card shadow-card p-4">
                        <div className="text-sm font-semibold text-foreground">{divLabel(dv.d)}</div>
                        <div className="mt-2 space-y-1 text-sm tabular-nums">
                          <div className="flex justify-between"><span className="text-muted-foreground">{t('income')}</span><span className="text-green-600 dark:text-green-400">{formatChf(dv.inc)}</span></div>
                          <div className="flex justify-between"><span className="text-muted-foreground">{t('expense')}</span><span className="text-red-600 dark:text-red-400">{formatChf(dv.exp)}</span></div>
                          <div className="flex justify-between border-t border-border pt-1 font-semibold"><span className="text-foreground/85">{t('result')}</span><span className={dv.net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{formatChf(dv.net)}</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {recent.length > 0 && (
                <section>
                  <h2 className="mb-3 text-base font-semibold text-foreground">{t('recentBookings')}</h2>
                  <div className="rounded-2xl border border-hairline bg-card shadow-card overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('colDate')}</TableHead>
                          <TableHead>{t('colText')}</TableHead>
                          <TableHead className="hidden sm:table-cell">{t('colDebit')}</TableHead>
                          <TableHead className="hidden sm:table-cell">{t('colCredit')}</TableHead>
                          <TableHead className="text-right">{t('colAmount')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {recent.map((tx) => (
                          <TableRow key={tx.id}>
                            <TableCell className="whitespace-nowrap text-foreground">{tx.booking_date ? formatDateCompactZurich(tx.booking_date) : '–'}</TableCell>
                            <TableCell className="whitespace-normal break-words text-foreground/85">
                              {tx.text || '–'}
                              <span className="mt-0.5 block text-xs text-muted-foreground/80 sm:hidden">{tx.debit_account_number} → {tx.credit_account_number || '–'}</span>
                            </TableCell>
                            <TableCell className="hidden sm:table-cell text-muted-foreground" title={tx.debit_account_name ?? ''}>{tx.debit_account_number || '–'}</TableCell>
                            <TableCell className="hidden sm:table-cell text-muted-foreground" title={tx.credit_account_name ?? ''}>{tx.credit_account_number || '–'}</TableCell>
                            <TableCell className="text-right tabular-nums text-foreground">{tx.amount_chf == null || tx.amount_chf === '' ? '–' : formatChf(tx.amount_chf)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              )}
            </>
          )}

          {/* ── Income statement (P&L) ───────────────────────────── */}
          {tab === 'income' && (
            <div className="space-y-5">
              <div className="flex justify-end"><ReportExportMenu build={incomeReport} filename={`income-statement-${fyLabel}`} /></div>
              <StatementTable title={t('income')} rows={incomeRows} total={totalIncome} totalLabel={t('totalIncome')} accLabel={t('colAccount')} amtLabel={t('colAmount')}
                expandedNum={expandedAcct} onToggle={toggleAcct} renderDetail={(a) => <AccountLedger account={a} transactions={plTransactions} nameByNum={nameByNum} />} />
              <StatementTable title={t('expense')} rows={expenseRows} total={totalExpense} totalLabel={t('totalExpenses')} accLabel={t('colAccount')} amtLabel={t('colAmount')}
                expandedNum={expandedAcct} onToggle={toggleAcct} renderDetail={(a) => <AccountLedger account={a} transactions={plTransactions} nameByNum={nameByNum} />} />
              <div className="rounded-2xl border-2 border-input bg-card shadow-card p-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">{t('netResult')}</span>
                  <span className={`text-xl font-bold tabular-nums ${result >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{formatChf(result)}</span>
                </div>
              </div>
            </div>
          )}

          {/* ── Balance sheet ────────────────────────────────────── */}
          {tab === 'balance' && (
            <div className="space-y-5">
              <div className="flex justify-end"><ReportExportMenu build={balanceReport} filename={`balance-sheet-${fyLabel}`} /></div>
              <StatementTable title={t('assets')} rows={assetRows} total={totalAssets} totalLabel={t('totalAssets')} accLabel={t('colAccount')} amtLabel={t('colAmount')}
                expandedNum={expandedAcct} onToggle={toggleAcct} renderDetail={(a) => <AccountLedger account={a} transactions={transactions} nameByNum={nameByNum} />} />
              <StatementTable title={t('liabilitiesEquity')} rows={liabEqRows} total={totalLiabEq} totalLabel={t('totalLiabEquity')} accLabel={t('colAccount')} amtLabel={t('colAmount')}
                expandedNum={expandedAcct} onToggle={toggleAcct} renderDetail={(a) => <AccountLedger account={a} transactions={transactions} nameByNum={nameByNum} />} />
            </div>
          )}

          {/* ── Accounts (drill-down tree) ───────────────────────── */}
          {tab === 'ledger' && <LedgerTab fiscalYearId={activeFyId} />}
          {tab === 'accounts' && <AccountExplorer accounts={accounts} transactions={transactions} />}

          {/* ── Sync status ──────────────────────────────────────── */}
          {tab === 'sync' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-hairline bg-card shadow-card p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('lastSync')}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{imports[0] ? formatDateTimeCompactZurich(imports[0].imported_at) : '–'}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t('autoSyncNote')}</div>
                <SyncNowButton />
              </div>
              {imports.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">{t('noSyncs')}</div>
              ) : (
                <section>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('syncHistory')}</h3>
                  <div className="rounded-2xl border border-hairline bg-card shadow-card overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('colWhen')}</TableHead>
                          <TableHead>{t('colType')}</TableHead>
                          <TableHead className="hidden sm:table-cell">{t('colBy')}</TableHead>
                          <TableHead className="text-right">{t('colRows')}</TableHead>
                          <TableHead className="hidden sm:table-cell">{t('colPeriod')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {imports.slice(0, 30).map((im) => (
                          <TableRow key={im.id}>
                            <TableCell className="whitespace-nowrap text-foreground">{formatDateTimeCompactZurich(im.imported_at)}</TableCell>
                            <TableCell className="text-foreground/85">{importTypeLabel(im.import_type)}</TableCell>
                            <TableCell className="hidden sm:table-cell whitespace-normal break-words text-muted-foreground">{im.imported_by_name || '–'}</TableCell>
                            <TableCell className="text-right tabular-nums text-foreground">{im.row_count ?? '–'}</TableCell>
                            <TableCell className="hidden sm:table-cell text-muted-foreground">{im.fiscal_year_label || '–'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground/80">{t('mirrorNote')}</p>
        </>
      )}
    </div>
  )
}

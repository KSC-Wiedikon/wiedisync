import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
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
import ReportExportMenu from './ReportExportMenu'
import type { FinanceReport } from './reportExport'

type Tab = 'overview' | 'income' | 'budget' | 'balance' | 'ledger' | 'accounts' | 'invoices' | 'dues' | 'dunning' | 'members' | 'teams' | 'sync'

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
      <button type="button" disabled={syncing} onClick={go}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
        {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{syncing ? t('syncing') : t('syncNow')}
      </button>
      {syncing && <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{t('syncingNote')}</p>}
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
    : 'text-gray-900 dark:text-gray-100'
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`mt-1.5 text-xl font-bold tabular-nums sm:text-2xl ${toneClass}`}>{value}</div>
    </div>
  )
}

/** Dashboard view-switch button. */
function TabBtn({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
          : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'
      }`}
    >{label}</button>
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
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{title}</h3>
      <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <Table>
          <TableHeader>
            <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
              <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{accLabel}</TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{amtLabel}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <Fragment key={a.number}>
                <TableRow
                  className={`border-gray-200 dark:border-gray-700 ${onToggle ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40' : ''}`}
                  onClick={onToggle ? () => onToggle(a.number) : undefined}
                >
                  <TableCell className="whitespace-normal break-words text-gray-700 dark:text-gray-300">
                    {onToggle && (
                      <span className="mr-1 inline-block align-middle text-gray-400">
                        {expandedNum === a.number ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </span>
                    )}
                    <span className="tabular-nums text-gray-400">{a.number}</span> {a.name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-gray-900 dark:text-gray-100">{formatChf(a.bal)}</TableCell>
                </TableRow>
                {expandedNum === a.number && renderDetail && (
                  <TableRow className="border-gray-200 dark:border-gray-700">
                    <TableCell colSpan={2} className="bg-gray-50/60 p-2 dark:bg-gray-900/20">{renderDetail(a)}</TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
            <TableRow className="border-t-2 border-gray-300 font-semibold dark:border-gray-600">
              <TableCell className="text-gray-900 dark:text-gray-100">{totalLabel}</TableCell>
              <TableCell className="text-right tabular-nums text-gray-900 dark:text-gray-100">{formatChf(total)}</TableCell>
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
  const TABS: Tab[] = ['overview', 'income', 'budget', 'balance', 'ledger', 'accounts', 'invoices', 'dues', 'dunning', 'members', 'teams', 'sync']
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
  const { data: txRaw, isLoading } = useFinanceTransactions(activeFyId || null, !!activeFyId, 'clubdesk')
  const transactions = txRaw ?? []
  const { data: invoicesRaw } = useFinanceInvoices()
  const invoices = invoicesRaw ?? []
  const { data: importsRaw } = useFinanceImports()
  const imports = importsRaw ?? []

  // Report to the app boot gate — see usePageReady.tsx
  useReportPageLoading(isLoading)

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
            {fiscalYears.map((fy) => <option key={fy.id} value={fy.id}>{fy.label}</option>)}
          </select>
        )}
      </div>

      {empty ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {t('noData')}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <TabBtn active={tab === 'overview'} label={t('tabOverview')} onClick={() => setTab('overview')} />
            <TabBtn active={tab === 'income'} label={t('tabIncome')} onClick={() => setTab('income')} />
            <TabBtn active={tab === 'budget'} label={t('tabBudget')} onClick={() => setTab('budget')} />
            <TabBtn active={tab === 'balance'} label={t('tabBalance')} onClick={() => setTab('balance')} />
            <TabBtn active={tab === 'ledger'} label={t('tabLedger')} onClick={() => setTab('ledger')} />
            <TabBtn active={tab === 'accounts'} label={t('tabAccounts')} onClick={() => setTab('accounts')} />
            <TabBtn active={tab === 'invoices'} label={t('tabInvoices')} onClick={() => setTab('invoices')} />
            <TabBtn active={tab === 'dues'} label={t('tabDues')} onClick={() => setTab('dues')} />
            <TabBtn active={tab === 'dunning'} label={t('tabDunning')} onClick={() => setTab('dunning')} />
            <TabBtn active={tab === 'members'} label={t('tabMembers')} onClick={() => setTab('members')} />
            <TabBtn active={tab === 'teams'} label={t('tabTeams')} onClick={() => setTab('teams')} />
            <TabBtn active={tab === 'sync'} label={t('tabSync')} onClick={() => setTab('sync')} />
          </div>

          {/* ── Invoices (native create/manage + orphan member-linking) ── */}
          {tab === 'invoices' && <InvoiceManager />}

          {/* ── Dues run (recurring/batch membership-dues billing) ── */}
          {tab === 'dues' && <DuesRunManager fiscalYearId={String(activeFyId)} fiscalYearLabel={activeFyLabel} />}

          {/* ── Per-team finance (sponsoring + bills) ── */}
          {tab === 'teams' && <TeamFinance fiscalYearId={String(activeFyId)} fiscalYearLabel={activeFyLabel} />}

          {/* ── Dunning / Mahnwesen ── */}
          {tab === 'dunning' && <DunningConsole />}

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
                  <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">{t('byDivision')}</h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {divisions.map((dv) => (
                      <div key={dv.d} className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{divLabel(dv.d)}</div>
                        <div className="mt-2 space-y-1 text-sm tabular-nums">
                          <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('income')}</span><span className="text-green-600 dark:text-green-400">{formatChf(dv.inc)}</span></div>
                          <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('expense')}</span><span className="text-red-600 dark:text-red-400">{formatChf(dv.exp)}</span></div>
                          <div className="flex justify-between border-t border-gray-200 pt-1 font-semibold dark:border-gray-700"><span className="text-gray-700 dark:text-gray-300">{t('result')}</span><span className={dv.net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{formatChf(dv.net)}</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

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
                            <TableCell className="whitespace-nowrap text-gray-900 dark:text-gray-100">{tx.booking_date ? formatDateCompactZurich(tx.booking_date) : '–'}</TableCell>
                            <TableCell className="whitespace-normal break-words text-gray-700 dark:text-gray-300">
                              {tx.text || '–'}
                              <span className="mt-0.5 block text-xs text-gray-400 sm:hidden">{tx.debit_account_number} → {tx.credit_account_number || '–'}</span>
                            </TableCell>
                            <TableCell className="hidden sm:table-cell text-gray-600 dark:text-gray-400" title={tx.debit_account_name ?? ''}>{tx.debit_account_number || '–'}</TableCell>
                            <TableCell className="hidden sm:table-cell text-gray-600 dark:text-gray-400" title={tx.credit_account_name ?? ''}>{tx.credit_account_number || '–'}</TableCell>
                            <TableCell className="text-right tabular-nums text-gray-900 dark:text-gray-100">{tx.amount_chf == null || tx.amount_chf === '' ? '–' : formatChf(tx.amount_chf)}</TableCell>
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
              <div className="rounded-lg border-2 border-gray-300 bg-white p-4 dark:border-gray-600 dark:bg-gray-800">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{t('netResult')}</span>
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
              <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                <div className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('lastSync')}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">{imports[0] ? formatDateTimeCompactZurich(imports[0].imported_at) : '–'}</div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('autoSyncNote')}</div>
                <SyncNowButton />
              </div>
              {imports.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">{t('noSyncs')}</div>
              ) : (
                <section>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('syncHistory')}</h3>
                  <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                          <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colWhen')}</TableHead>
                          <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colType')}</TableHead>
                          <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colBy')}</TableHead>
                          <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colRows')}</TableHead>
                          <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colPeriod')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {imports.slice(0, 30).map((im) => (
                          <TableRow key={im.id} className="border-gray-200 dark:border-gray-700">
                            <TableCell className="whitespace-nowrap text-gray-900 dark:text-gray-100">{formatDateTimeCompactZurich(im.imported_at)}</TableCell>
                            <TableCell className="text-gray-700 dark:text-gray-300">{importTypeLabel(im.import_type)}</TableCell>
                            <TableCell className="hidden sm:table-cell whitespace-normal break-words text-gray-600 dark:text-gray-400">{im.imported_by_name || '–'}</TableCell>
                            <TableCell className="text-right tabular-nums text-gray-900 dark:text-gray-100">{im.row_count ?? '–'}</TableCell>
                            <TableCell className="hidden sm:table-cell text-gray-600 dark:text-gray-400">{im.fiscal_year_label || '–'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              )}
            </div>
          )}

          <p className="text-xs text-gray-400 dark:text-gray-500">{t('mirrorNote')}</p>
        </>
      )}
    </div>
  )
}

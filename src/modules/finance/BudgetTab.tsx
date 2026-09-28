import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { useFinanceBudget, saveBudgetLine, formatChf, toNum } from '../../hooks/useFinance'
import { downloadCsv } from './financeExport'
import ReportExportMenu from './ReportExportMenu'
import type { FinanceReport } from './reportExport'

export interface BudgetRow { id: string | number; number: string; name: string; type: string | null; bal: number }

/** Budget vs actual per income/expense account — fills finance_budget_lines.
 *  `rows` are the P&L accounts (with actual `bal`) from FinancePage. */
export default function BudgetTab({ rows, fiscalYearId, fiscalYearLabel }: {
  rows: BudgetRow[]; fiscalYearId: string; fiscalYearLabel: string
}) {
  const { t, i18n } = useTranslation('finance')
  const { data: budgetRaw, isLoading: budgetLoading, isError: budgetError, isPlaceholderData: budgetStale, refetch } =
    useFinanceBudget(fiscalYearId, !!fiscalYearId)
  const [edit, setEdit] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  // `budgetOf()` falls back to 0 for an account with no line, so a not-yet-loaded
  // budget is indistinguishable from "budgeted nothing": every cell paints empty and
  // every variance paints the FULL actual (green income / red expense) before the
  // real figures land. Hold the budget + variance cells until the lines are here.
  //  - `budgetRaw === undefined` covers the frame right after `enabled` flips true,
  //    where react-query still reports isLoading=false (same gotcha as FinancePage's
  //    boot flag).
  //  - `isPlaceholderData` is load-bearing: src/lib/query.tsx defaults to
  //    keepPreviousData, so switching fiscal year serves the PREVIOUS year's budget
  //    lines against this year's actuals — stale but entirely plausible.
  //  - `!budgetError` is the escape hatch: on a failed fetch `data` stays undefined
  //    forever, and a gate without it would strand the inputs behind a permanent
  //    skeleton. On error we fall through to the old behaviour.
  //  - a disabled query (no fiscal year) is not "pending" — there is nothing to load.
  const budgetPending = !!fiscalYearId && !budgetError && (budgetLoading || budgetStale || budgetRaw === undefined)

  const budgetByAccount = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of budgetRaw ?? []) m.set(String(b.account), toNum(b.amount_budgeted))
    return m
  }, [budgetRaw])

  const income = rows.filter((r) => r.type === 'income')
  const expense = rows.filter((r) => r.type === 'expense')
  const budgetOf = (id: string | number) => budgetByAccount.get(String(id)) ?? 0
  // Keyed per fiscal year: `edit` outlives a save and would otherwise override the
  // next year's freshly loaded budget with last year's typed string — and commit it.
  const editKey = (id: string | number) => `${fiscalYearId}:${id}`
  const variance = (r: BudgetRow) => r.type === 'expense' ? budgetOf(r.id) - r.bal : r.bal - budgetOf(r.id) // positive = favourable

  async function save(r: BudgetRow, raw: string) {
    // The `val === budgetOf(r.id)` no-op guard below is only meaningful once the
    // stored lines are here — against a not-yet-loaded baseline of 0 the same blur
    // is either a silent no-op or an overwrite of a real budget.
    if (budgetPending) return
    const val = Math.round(Number(raw.replace(',', '.')) * 100) / 100
    if (!Number.isFinite(val) || val === budgetOf(r.id)) return
    setSavingId(String(r.id))
    try {
      await saveBudgetLine({ fiscal_year: Number(fiscalYearId), account: Number(r.id), amount_budgeted: val })
      await refetch()
    } finally { setSavingId(null) }
  }

  function exportCsv() {
    if (budgetPending) return
    // Export headers always English regardless of UI locale (export convention).
    const tEn = i18n.getFixedT('en', 'finance')
    const line = (r: BudgetRow) => [r.number, r.name, toNum(budgetOf(r.id)).toFixed(2), r.bal.toFixed(2), variance(r).toFixed(2)]
    downloadCsv(`budget-${fiscalYearLabel || fiscalYearId}`, [tEn('colAccount'), tEn('budgetColName'), tEn('budgetColBudget'), tEn('budgetColActual'), tEn('budgetColVariance')],
      [...income.map(line), ...expense.map(line)])
  }
  const budgetReport = (): FinanceReport => {
    const line = (r: BudgetRow) => ({ cells: [`${r.number} · ${r.name}`, budgetOf(r.id), r.bal, variance(r)] })
    return {
      title: t('tabBudget'), org: 'KSC Wiedikon', period: fiscalYearLabel || fiscalYearId,
      columns: [{ label: t('colAccount'), type: 'text' }, { label: t('budgetColBudget'), type: 'money' }, { label: t('budgetColActual'), type: 'money' }, { label: t('budgetColVariance'), type: 'money' }],
      sections: [{ heading: t('income'), rows: income.map(line) }, { heading: t('expense'), rows: expense.map(line) }],
    }
  }

  const section = (title: string, list: BudgetRow[]) => (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h3>
      </div>
      <div className="rounded-2xl border border-hairline bg-card shadow-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colAccount')}</TableHead>
              <TableHead className="text-right">{t('budgetColBudget')}</TableHead>
              <TableHead className="text-right">{t('budgetColActual')}</TableHead>
              <TableHead className="hidden sm:table-cell text-right">{t('budgetColVariance')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((r) => {
              const v = variance(r)
              return (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-normal break-words text-foreground/85">
                    <span className="tabular-nums text-muted-foreground/80">{r.number}</span> {r.name}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {savingId === String(r.id) && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/80" />}
                      {budgetPending ? (
                        // Not rendering the input is the point: an element that does not
                        // exist cannot be focused, typed into, or blur-commit a figure the
                        // treasurer only typed because the cell looked empty.
                        <div aria-hidden className="h-9 w-24 animate-pulse rounded-md bg-stone-200/80 sm:h-8 dark:bg-muted" />
                      ) : (
                        <input
                          inputMode="decimal"
                          value={edit[editKey(r.id)] ?? (budgetOf(r.id) ? String(budgetOf(r.id)) : '')}
                          onChange={(e) => setEdit((p) => ({ ...p, [editKey(r.id)]: e.target.value }))}
                          onBlur={(e) => save(r, e.target.value)}
                          placeholder="0.00"
                          className="h-9 w-24 rounded-lg border border-input bg-card px-2 text-right text-sm tabular-nums sm:h-8 dark:bg-gray-800 text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-foreground">{formatChf(r.bal)}</TableCell>
                  <TableCell className="hidden sm:table-cell text-right tabular-nums">
                    {budgetPending
                      ? <div aria-hidden className="ml-auto h-4 w-20 animate-pulse rounded bg-stone-200/80 dark:bg-muted" />
                      : <span className={v >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{formatChf(v)}</span>}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 text-xs text-muted-foreground">{t('budgetHint', { year: fiscalYearLabel })}</p>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" onClick={exportCsv} disabled={budgetPending}>
            <Download className="h-4 w-4" />{t('exportCsv')}
          </Button>
          {/* A PDF/XLSX built in the zero-budget frame outlives the frame — same button,
              disabled, rather than a menu that would export the wrong figures. */}
          {budgetPending ? (
            <Button type="button" variant="outline" disabled>
              <Download className="h-4 w-4" />{t('export')}
            </Button>
          ) : (
            <ReportExportMenu build={budgetReport} filename={`budget-${fiscalYearLabel || fiscalYearId}`} />
          )}
        </div>
      </div>
      {income.length > 0 && section(t('income'), income)}
      {expense.length > 0 && section(t('expense'), expense)}
      {income.length === 0 && expense.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">{t('noData')}</p>
      )}
      <p className="text-xs text-muted-foreground/80">{t('budgetVarianceNote')}</p>
    </div>
  )
}

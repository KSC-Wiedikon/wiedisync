import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Loader2 } from 'lucide-react'
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
  const { data: budgetRaw, refetch } = useFinanceBudget(fiscalYearId, !!fiscalYearId)
  const [edit, setEdit] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  const budgetByAccount = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of budgetRaw ?? []) m.set(String(b.account), toNum(b.amount_budgeted))
    return m
  }, [budgetRaw])

  const income = rows.filter((r) => r.type === 'income')
  const expense = rows.filter((r) => r.type === 'expense')
  const budgetOf = (id: string | number) => budgetByAccount.get(String(id)) ?? 0
  const variance = (r: BudgetRow) => r.type === 'expense' ? budgetOf(r.id) - r.bal : r.bal - budgetOf(r.id) // positive = favourable

  async function save(r: BudgetRow, raw: string) {
    const val = Math.round(Number(raw.replace(',', '.')) * 100) / 100
    if (!Number.isFinite(val) || val === budgetOf(r.id)) return
    setSavingId(String(r.id))
    try {
      await saveBudgetLine({ fiscal_year: Number(fiscalYearId), account: Number(r.id), amount_budgeted: val })
      await refetch()
    } finally { setSavingId(null) }
  }

  function exportCsv() {
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
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{title}</h3>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <Table>
          <TableHeader>
            <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
              <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colAccount')}</TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('budgetColBudget')}</TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('budgetColActual')}</TableHead>
              <TableHead className="hidden sm:table-cell text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('budgetColVariance')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((r) => {
              const v = variance(r)
              return (
                <TableRow key={r.id} className="border-gray-200 dark:border-gray-700">
                  <TableCell className="whitespace-normal break-words text-gray-700 dark:text-gray-300">
                    <span className="tabular-nums text-gray-400">{r.number}</span> {r.name}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {savingId === String(r.id) && <Loader2 className="h-3 w-3 animate-spin text-gray-400" />}
                      <input
                        inputMode="decimal"
                        value={edit[String(r.id)] ?? (budgetOf(r.id) ? String(budgetOf(r.id)) : '')}
                        onChange={(e) => setEdit((p) => ({ ...p, [String(r.id)]: e.target.value }))}
                        onBlur={(e) => save(r, e.target.value)}
                        placeholder="0.00"
                        className="w-24 rounded-md border border-gray-200 bg-transparent px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-gray-900 dark:text-gray-100">{formatChf(r.bal)}</TableCell>
                  <TableCell className={`hidden sm:table-cell text-right tabular-nums ${v >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{formatChf(v)}</TableCell>
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">{t('budgetHint', { year: fiscalYearLabel })}</p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">
            <Download className="h-4 w-4" />{t('exportCsv')}
          </button>
          <ReportExportMenu build={budgetReport} filename={`budget-${fiscalYearLabel || fiscalYearId}`} />
        </div>
      </div>
      {income.length > 0 && section(t('income'), income)}
      {expense.length > 0 && section(t('expense'), expense)}
      {income.length === 0 && expense.length === 0 && (
        <p className="rounded-lg border border-dashed border-gray-300 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">{t('noData')}</p>
      )}
      <p className="text-xs text-gray-400 dark:text-gray-500">{t('budgetVarianceNote')}</p>
    </div>
  )
}

// src/modules/admin/components/seasonHealth/FindingTable.tsx
//
// The rows behind one check, rendered generically from the row keys: `*_id`
// columns become links, first/last names merge into one Name cell, `team`
// is a TeamChip, dates go Swiss, booleans go ✓/✗. The page shows the runner's
// capped rows; Export fetches `?check=KEY` for the full list (English headers).
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
import TeamChip from '../../../../components/TeamChip'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../../../components/ui/table'
import { kscwApi } from '../../../../lib/api'
import { toXlsx, downloadBlob } from '../../utils/exportResults'
import {
  cellValue, classifyCell, columnsOf, exportColumnsOf, findingRowKey, humanize, rowLinks, rowsForTab,
  type CheckRow, type HealthCheck, type SeasonTab,
} from '../../utils/seasonHealth'

const LINK = 'text-foreground underline-offset-2 hover:underline'

// yes/no labels come from the parent: one hook per table, not one per cell.
function Cell({ row, column, yes, no }: { row: CheckRow; column: string; yes: string; no: string }) {
  const view = classifyCell(column, cellValue(row, column))
  const links = rowLinks(row)

  // Which entity a text-ish column links to: the name → member, the team →
  // team page, a game's date (or an event's title) → the admin explorer.
  const target = column === 'name' ? links.member
    : column === 'date' ? (links.game ?? links.training)
      : column === 'title' ? links.event
        : undefined

  let inner: ReactNode
  switch (view.kind) {
    case 'empty':
      inner = <span className="text-muted-foreground">—</span>
      break
    case 'name': {
      const last = typeof row.last_name === 'string' ? row.last_name : ''
      const first = typeof row.first_name === 'string' ? row.first_name : ''
      inner = (
        <>
          <span className="block sm:inline">{last}</span>
          <span className="block text-muted-foreground sm:ml-1 sm:inline sm:text-foreground">{first}</span>
        </>
      )
      break
    }
    case 'team':
      inner = <TeamChip team={view.text} size="sm" />
      break
    case 'boolean':
      inner = view.value
        ? <span className="text-green-600 dark:text-green-400" aria-label={yes}>✓</span>
        : <span className="font-medium text-red-600 dark:text-red-400" aria-label={no}>✗</span>
      break
    default:
      inner = view.text
  }

  if (view.kind === 'team' && links.team) {
    inner = <Link to={links.team} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{inner}</Link>
  } else if (target && view.kind !== 'boolean' && view.kind !== 'empty') {
    inner = <Link to={target} className={`${LINK} ${view.kind === 'name' ? 'font-medium' : ''}`}>{inner}</Link>
  }

  const cls = view.kind === 'name'
    ? 'leading-tight'
    : view.kind === 'boolean'
      ? 'text-center'
      : view.kind === 'number' || view.kind === 'date' || view.kind === 'time' || view.kind === 'timestamp'
        ? 'tabular-nums whitespace-nowrap'
        : ''
  return <TableCell className={`py-2.5 pr-3 ${cls}`}>{inner}</TableCell>
}

export default function FindingTable({ check, rows, total, tab }: {
  check: HealthCheck
  rows: CheckRow[]
  /** Findings in this tab — may exceed rows.length when the runner capped them. */
  total: number
  tab: SeasonTab
}) {
  const { t, i18n } = useTranslation('seasonHealth')
  const [exporting, setExporting] = useState(false)
  const columns = useMemo(() => columnsOf(rows), [rows])
  const truncated = rows.length < total

  async function handleExport() {
    setExporting(true)
    try {
      const resp = await kscwApi<{ season: string; check: HealthCheck }>(
        `/admin/season-health?check=${encodeURIComponent(check.key)}`)
      const all = rowsForTab(check, resp.check?.rows ?? [], tab)
      const keys = exportColumnsOf(all)
      const tEn = i18n.getFixedT('en', 'seasonHealth')
      const header = keys.map((k) => tEn(`col_${k}`, { defaultValue: humanize(k) }))
      const data = all.map((r) => keys.map((k) => (r[k] === undefined ? null : r[k])))
      const blob = await toXlsx(header, data)
      downloadBlob(blob, `season-health_${check.key}_${tab}_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch {
      toast.error(t('exportFailed'))
    } finally {
      setExporting(false)
    }
  }

  const headerLabel = (key: string) => t(`col_${key}`, { defaultValue: humanize(key) })
  const yes = t('yes')
  const no = t('no')

  return (
    <div className="px-4 pb-3">
      {rows.length > 0 && (
        <Table className="text-sm">
          <TableHeader>
            <TableRow className="border-b border-border text-left text-muted-foreground hover:bg-transparent">
              {columns.map((c) => (
                <TableHead key={c} className="py-2 pr-3 font-medium">{headerLabel(c)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={findingRowKey(row, i)} className="h-11 border-b border-border/50 hover:bg-muted/30">
                {columns.map((c) => <Cell key={c} row={row} column={c} yes={yes} no={no} />)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {truncated
            ? t('truncated', { shown: rows.length, total })
            : t('shownOf', { shown: rows.length, total })}
        </p>
        <Button
          type="button" variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-0"
          onClick={handleExport} disabled={exporting || total === 0} aria-busy={exporting}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          {t('export')}
        </Button>
      </div>
    </div>
  )
}

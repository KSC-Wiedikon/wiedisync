import React from 'react'
import { useTranslation } from 'react-i18next'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { formatDateZurich, formatTimeZurich } from '../utils/dateHelpers'
import type { PlayerStats } from '../modules/trainings/useAttendanceStats'

interface AttendanceTableProps {
  stats: PlayerStats[]
  /** Optional drilldown: when provided, rows are clickable. */
  onPlayerClick?: (memberId: string) => void
  /** Currently expanded player id (only used when onPlayerClick + renderDrilldown are set). */
  expandedPlayerId?: string | null
  /** Renderer for the drilldown body — placed inline below the row on desktop, in a sheet on mobile (sheet handled by caller). */
  renderDrilldown?: (memberId: string) => React.ReactNode
  /** i18n namespace to read column labels from (default: 'trainings'). */
  namespace?: string
  /** Activities-count column label key (default: 'trainingsCol'). */
  countColKey?: string
}

const trendColors: Record<string, string> = {
  present: 'bg-green-500',
  absent: 'bg-red-500',
}

/** Attendance-rate badge colours, with dark-mode variants. */
function rateBadgeClass(pct: number): string {
  if (pct >= 80) return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
  if (pct >= 50) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
  return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
}

const COL_COUNT = 7

export default function AttendanceTable({
  stats,
  onPlayerClick,
  expandedPlayerId,
  renderDrilldown,
  namespace = 'trainings',
  countColKey = 'trainingsCol',
}: AttendanceTableProps) {
  const { t } = useTranslation(namespace)
  // Trend-dot tooltips ('present'/'absent') live in the common namespace.
  const { t: tc } = useTranslation('common')
  const isClickable = !!onPlayerClick

  return (
    <div className="overflow-hidden rounded-lg border bg-white dark:border-gray-700 dark:bg-gray-800">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600 dark:bg-gray-900 dark:text-gray-400">
            <TableHead className="min-w-[140px]">{t('playerCol')}</TableHead>
            <TableHead className="hidden text-center sm:table-cell">{t('numberCol')}</TableHead>
            <TableHead className="text-center">{t(countColKey)}</TableHead>
            <TableHead className="text-center">{t('presentCol')}</TableHead>
            <TableHead className="text-center">{t('absentCol')}</TableHead>
            <TableHead className="text-center">{t('rateCol')}</TableHead>
            <TableHead className="hidden sm:table-cell">{t('trendCol')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats.map((player) => {
            const expanded = expandedPlayerId === player.memberId
            return (
              <React.Fragment key={player.memberId}>
                <TableRow
                  onClick={isClickable ? () => onPlayerClick!(player.memberId) : undefined}
                  aria-expanded={renderDrilldown ? expanded : undefined}
                  className={cn('[&>td]:h-11', isClickable && 'cursor-pointer', expanded && 'bg-muted/50')}
                >
                  <TableCell className="font-medium text-gray-900 dark:text-gray-100">
                    {player.memberName || '—'}
                    {/* Last-response timestamp only shown on mobile (the Trend
                        column that carries this context is hidden there). */}
                    {player.lastResponseAt && (
                      <span className="mt-0.5 block text-[11px] font-normal text-gray-400 dark:text-gray-500 sm:hidden">
                        {formatDateZurich(player.lastResponseAt)} {formatTimeZurich(player.lastResponseAt)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-center text-gray-600 dark:text-gray-400 sm:table-cell">
                    {player.jerseyNumber || '—'}
                  </TableCell>
                  <TableCell className="text-center text-gray-600 dark:text-gray-400">{player.total}</TableCell>
                  <TableCell className="text-center text-green-600 dark:text-green-400">{player.present}</TableCell>
                  <TableCell className="text-center text-red-600 dark:text-red-400">{player.absent}</TableCell>
                  <TableCell className="text-center">
                    <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-bold', rateBadgeClass(player.percentage))}>
                      {player.percentage}%
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex gap-1">
                      {player.trend.map((status, i) => (
                        <div
                          key={i}
                          className={cn('h-3 w-3 rounded-full', trendColors[status] ?? 'bg-gray-300 dark:bg-gray-600')}
                          title={tc(status, { defaultValue: status })}
                        />
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
                {expanded && renderDrilldown && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={COL_COUNT} className="bg-gray-50 dark:bg-gray-900">
                      {renderDrilldown(player.memberId)}
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

import { useMemo } from 'react'
import CalendarGrid from '../../components/CalendarGrid'
import GameChip from './GameChip'
import DayOverflowPopover from './DayOverflowPopover'
import AbsenceBadge from './AbsenceBadge'
import CrossTeamBadge from './CrossTeamBadge'
import type { CalendarEntry } from '../../types/calendar'
import type { Game } from '../../types'
import type { AbsentMember } from './utils/absencesByDate'
import type { CrossTeamConflict } from './hooks/useCrossTeamConflicts'
import { toDateKey, getSeasonMonths, getSeasonYear, formatDate } from '../../utils/dateUtils'

interface CalendarViewProps {
  entries: CalendarEntry[]
  closedDates: Set<string>
  month: Date
  onMonthChange: (month: Date) => void
  onGameClick?: (game: Game) => void
  onEmptyDayClick?: (date: Date) => void
  /** date key (yyyy-MM-dd) -> members unavailable for games that day. */
  absencesByDate?: Map<string, AbsentMember[]>
  /** date key (yyyy-MM-dd) -> roster-sharing teams playing that day. */
  crossTeamByDate?: Map<string, CrossTeamConflict[]>
}

export default function CalendarView({ entries, closedDates, month, onMonthChange, onGameClick, onEmptyDayClick, absencesByDate, crossTeamByDate }: CalendarViewProps) {
  // seasonMonths drives the season-month pill strip below. We intentionally
  // stopped passing min/maxMonth to CalendarGrid so the prev/next arrows can
  // cross season boundaries freely.
  const seasonYear = getSeasonYear(month)
  const seasonMonths = getSeasonMonths(seasonYear)

  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>()
    for (const entry of entries) {
      const key = toDateKey(entry.date)
      const existing = map.get(key) ?? []
      existing.push(entry)
      map.set(key, existing)
    }
    return map
  }, [entries])

  const highlightedDates = useMemo(() => {
    const dates = new Set<string>()
    for (const entry of entries) {
      if (entry.date.getDay() === 6) {
        dates.add(toDateKey(entry.date))
      }
    }
    return dates
  }, [entries])

  return (
    <div className="space-y-4">
      {/* Season month quick navigation */}
      <div className="flex flex-wrap gap-1">
        {seasonMonths.map((m) => {
          const isActive = m.getMonth() === month.getMonth() && m.getFullYear() === month.getFullYear()
          return (
            <button
              key={m.toISOString()}
              onClick={() => onMonthChange(m)}
              className={`rounded px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-2 sm:py-1 sm:text-xs ${
                isActive
                  ? 'bg-gold-400 text-brand-900'
                  : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:text-gray-300'
              }`}
            >
              {formatDate(m, 'MMM')}
            </button>
          )
        })}
      </div>

      <CalendarGrid
        month={month}
        onMonthChange={onMonthChange}
        itemsByDate={itemsByDate}
        closedDates={closedDates}
        highlightedDates={highlightedDates}
        onEmptyDayClick={onEmptyDayClick}
        renderDayContent={(date, items) => {
          const visible = items.slice(0, 3)
          const hidden = items.slice(3)
          const absent = absencesByDate?.get(toDateKey(date)) ?? []
          const crossTeam = crossTeamByDate?.get(toDateKey(date)) ?? []

          return (
            <>
              {(absent.length > 0 || crossTeam.length > 0) && (
                <div className="flex justify-end gap-1">
                  {crossTeam.length > 0 && <CrossTeamBadge conflicts={crossTeam} />}
                  {absent.length > 0 && <AbsenceBadge absent={absent} />}
                </div>
              )}
              {visible.map((entry) => (
                <GameChip
                  key={entry.id}
                  game={entry.source as Game}
                  teamName={entry.teamNames[0] ?? '?'}
                  onClick={onGameClick}
                />
              ))}
              {hidden.length > 0 && (
                <DayOverflowPopover
                  games={hidden.map((e) => e.source as Game)}
                  teamNames={hidden.map((e) => e.teamNames[0] ?? '?')}
                  count={hidden.length}
                  onGameClick={onGameClick}
                />
              )}
            </>
          )
        }}
      />
    </div>
  )
}

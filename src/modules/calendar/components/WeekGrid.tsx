import { useMemo, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { CalendarEntry } from '../../../types/calendar'
import {
  startOfWeek,
  endOfWeek,
  addWeeks,
  eachDayOfInterval,
  isSameDay,
  toDateKey,
  dayHeaders,
} from '../../../utils/dateUtils'
import { formatDateCompactZurich } from '../../../utils/dateHelpers'
import { blockClasses } from '../entryStyle'
import {
  HOUR_HEIGHT,
  TOP_PAD,
  minutesToOffset,
  layoutOverlaps,
  computeTimeRange,
  buildHourLabels,
  type PositionedEvent,
} from '../weekGridLayout'

/* ── component ───────────────────────────────────────────── */

interface WeekGridProps {
  entries: CalendarEntry[]
  closedDates: Set<string>
  weekStart: Date
  onWeekChange: (weekStart: Date) => void
  onEntryClick?: (entry: CalendarEntry) => void
}

export default function WeekGrid({
  entries,
  closedDates,
  weekStart,
  onWeekChange,
  onEntryClick,
}: WeekGridProps) {
  const { t } = useTranslation('calendar')
  const scrollRef = useRef<HTMLDivElement>(null)
  const today = new Date()
  // Memoised as one unit (same shape as MobileWeekGrid's `days`): `weekDays` is
  // a dependency of the `timeRange` memo below, and a fresh array literal on
  // every render can't be used as one.
  const { weekMonday, weekSunday, weekDays } = useMemo(() => {
    const monday = startOfWeek(weekStart)
    const sunday = endOfWeek(weekStart)
    return { weekMonday: monday, weekSunday: sunday, weekDays: eachDayOfInterval(monday, sunday) }
  }, [weekStart])

  // Compute time range for the whole week, tightened to actual entries
  const timeRange = useMemo(() => computeTimeRange(weekDays, entries), [weekDays, entries])
  const totalHours = (timeRange.endMin - timeRange.startMin) / 60
  const totalHeight = totalHours * HOUR_HEIGHT + TOP_PAD

  // Generate hour labels
  const hourLabels = useMemo(() => buildHourLabels(timeRange), [timeRange])

  // Scroll to first hour. No dependency array on purpose: `weekDays` used to be
  // a fresh array on every render, so this ran after every render — keeping it
  // dependency-less preserves that exactly now that `weekDays` is memoised.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  })

  // Separate all-day/multi-day from timed
  const { allDayEntries, timedByDay } = useMemo(() => {
    const allDay: CalendarEntry[] = []
    const byDay: Map<string, CalendarEntry[]> = new Map()

    for (const e of entries) {
      if (e.allDay || e.endDate) {
        allDay.push(e)
      } else {
        const key = toDateKey(e.date)
        const arr = byDay.get(key) ?? []
        arr.push(e)
        byDay.set(key, arr)
      }
    }
    return { allDayEntries: allDay, timedByDay: byDay }
  }, [entries])

  // Compute positioned events for each day
  const positionedByDay = useMemo(() => {
    const result: Map<string, PositionedEvent[]> = new Map()
    for (const [key, dayEntries] of timedByDay) {
      result.set(key, layoutOverlaps(dayEntries, timeRange.startMin, 18))
    }
    return result
  }, [timedByDay, timeRange])

  // Current time position
  const now = new Date()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const nowOffset = minutesToOffset(nowMinutes, timeRange.startMin)
  const showNowLine = nowMinutes >= timeRange.startMin && nowMinutes <= timeRange.endMin

  const weekLabel = `${formatDateCompactZurich(weekMonday)} – ${formatDateCompactZurich(weekSunday)}`

  return (
    <div className="flex flex-1 flex-col">
      {/* Week header */}
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => onWeekChange(addWeeks(weekMonday, -1))}
          className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-900 sm:text-lg dark:text-gray-100">{weekLabel}</h2>
          <button
            onClick={() => onWeekChange(startOfWeek(new Date()))}
            className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            {t('common:today')}
          </button>
        </div>
        <button
          onClick={() => onWeekChange(addWeeks(weekMonday, 1))}
          className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-[3rem_repeat(7,1fr)] border-b border-gray-200 dark:border-gray-700">
        <div /> {/* gutter */}
        {weekDays.map((date, i) => {
          const isToday = isSameDay(date, today)
          return (
            <div key={i} className="flex flex-col items-center py-1.5">
              <span className="text-[10px] font-medium text-gray-600 dark:text-gray-400">
                {dayHeaders()[i]}
              </span>
              <span
                className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${
                  isToday
                    ? 'bg-gold-400 text-brand-900'
                    : 'text-gray-900 dark:text-gray-100'
                }`}
              >
                {date.getDate()}
              </span>
            </div>
          )
        })}
      </div>

      {/* All-day section */}
      {allDayEntries.length > 0 && (
        <div className="grid grid-cols-[3rem_repeat(7,1fr)] border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-center text-[10px] text-gray-400">
            {t('common:allDay')}
          </div>
          {weekDays.map((date, ci) => {
            const key = toDateKey(date)
            const dayAllDay = allDayEntries.filter((e) => {
              const eEnd = e.endDate ? toDateKey(e.endDate) : toDateKey(e.date)
              return toDateKey(e.date) <= key && eEnd >= key
            })
            return (
              <div key={ci} className="space-y-px border-l border-gray-200 px-0.5 py-1 dark:border-gray-700">
                {dayAllDay.slice(0, 2).map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onEntryClick?.(e)}
                    className={`block w-full truncate rounded px-1 text-[10px] font-medium leading-[16px] transition-opacity hover:opacity-80 ${blockClasses(e)}`}
                  >
                    {e.title}
                  </button>
                ))}
                {dayAllDay.length > 2 && (
                  <div className="text-[9px] text-gray-400">+{dayAllDay.length - 2}</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Time grid (scrollable) */}
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-y-auto"
        style={{ maxHeight: 'calc(100vh - 20rem)' }}
      >
        <div className="grid grid-cols-[3rem_repeat(7,1fr)]" style={{ height: totalHeight }}>
          {/* Hour labels */}
          <div className="relative">
            {hourLabels.map((hl) => (
              <div
                key={hl.minutes}
                className="absolute right-1 text-[10px] text-gray-400"
                style={{ top: minutesToOffset(hl.minutes, timeRange.startMin) - 6 }}
              >
                {hl.label}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDays.map((date, ci) => {
            const key = toDateKey(date)
            const isToday = isSameDay(date, today)
            const isClosed = closedDates.has(key)
            const positioned = positionedByDay.get(key) ?? []

            return (
              <div
                key={ci}
                className={`relative border-l border-gray-200 dark:border-gray-700 ${
                  isClosed ? 'bg-red-50/30 dark:bg-red-950/10' : ''
                }`}
              >
                {/* Hour lines */}
                {hourLabels.map((hl) => (
                  <div
                    key={hl.minutes}
                    className="absolute inset-x-0 border-t border-gray-100 dark:border-gray-700/50"
                    style={{ top: minutesToOffset(hl.minutes, timeRange.startMin) }}
                  />
                ))}

                {/* Current time line */}
                {isToday && showNowLine && (
                  <div
                    className="absolute inset-x-0 z-10 border-t-2 border-red-500"
                    style={{ top: nowOffset }}
                  >
                    <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
                  </div>
                )}

                {/* Events */}
                {positioned.map((pe) => (
                  <button
                    key={pe.entry.id}
                    type="button"
                    onClick={() => onEntryClick?.(pe.entry)}
                    className={`absolute overflow-hidden rounded px-1 text-[10px] leading-tight transition-opacity hover:opacity-80 lg:text-xs ${blockClasses(pe.entry)}`}
                    style={{
                      top: pe.top,
                      height: pe.height,
                      left: `${pe.left * 100}%`,
                      width: `calc(${pe.width * 100}% - 2px)`,
                    }}
                  >
                    <div className="truncate font-medium">
                      {pe.entry.startTime}
                    </div>
                    <div className="hidden truncate lg:block">
                      {pe.entry.title}
                    </div>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

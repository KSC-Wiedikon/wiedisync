import { useMemo, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import IconButton from '@/components/IconButton'
import type { CalendarEntry } from '../../../types/calendar'
import {
  isSameDay,
  toDateKey,
  formatDate,
} from '../../../utils/dateUtils'
import { formatDateCompactZurich } from '../../../utils/dateHelpers'
import { addDays } from 'date-fns'
import { blockClasses, cancelledClasses } from '../entryStyle'
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

interface MobileWeekGridProps {
  entries: CalendarEntry[]
  closedDates: Set<string>
  dayStart: Date
  onDayChange: (dayStart: Date) => void
  onEntryClick?: (entry: CalendarEntry) => void
}

export default function MobileWeekGrid({
  entries,
  closedDates,
  dayStart,
  onDayChange,
  onEntryClick,
}: MobileWeekGridProps) {
  const { t } = useTranslation('calendar')
  const scrollRef = useRef<HTMLDivElement>(null)
  const today = new Date()

  // 3 visible days
  const days = useMemo(() => [dayStart, addDays(dayStart, 1), addDays(dayStart, 2)], [dayStart])

  // Compute time range based on visible days, tightened to actual entries
  const timeRange = useMemo(() => computeTimeRange(days, entries), [days, entries])
  const totalHours = (timeRange.endMin - timeRange.startMin) / 60
  const totalHeight = totalHours * HOUR_HEIGHT + TOP_PAD

  // Generate hour labels (every full hour within range)
  const hourLabels = useMemo(() => buildHourLabels(timeRange), [timeRange])

  // Scroll to top (start of range) on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [days])

  // Separate all-day from timed
  const { allDayByDay, timedByDay } = useMemo(() => {
    const allDay = new Map<string, CalendarEntry[]>()
    const timed = new Map<string, CalendarEntry[]>()

    for (const e of entries) {
      for (const day of days) {
        const key = toDateKey(day)
        const eEnd = e.endDate ? toDateKey(e.endDate) : toDateKey(e.date)

        if (toDateKey(e.date) > key || eEnd < key) continue

        if (e.allDay || e.endDate) {
          const arr = allDay.get(key) ?? []
          arr.push(e)
          allDay.set(key, arr)
        } else if (isSameDay(e.date, day)) {
          const arr = timed.get(key) ?? []
          arr.push(e)
          timed.set(key, arr)
        }
      }
    }
    return { allDayByDay: allDay, timedByDay: timed }
  }, [entries, days])

  // Positioned events
  const positionedByDay = useMemo(() => {
    const result = new Map<string, PositionedEvent[]>()
    for (const [key, dayEntries] of timedByDay) {
      result.set(key, layoutOverlaps(dayEntries, timeRange.startMin, 20))
    }
    return result
  }, [timedByDay, timeRange])

  // Current time
  const now = new Date()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const nowOffset = minutesToOffset(nowMinutes, timeRange.startMin)
  const showNowLine = nowMinutes >= timeRange.startMin && nowMinutes <= timeRange.endMin

  return (
    <div className="flex flex-1 flex-col">
      {/* Navigation header */}
      <div className="mb-2 flex items-center justify-between">
        <IconButton label={t('prevDays')} onClick={() => onDayChange(addDays(dayStart, -3))} className="shrink-0">
          <ChevronLeft className="!size-5" />
        </IconButton>
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="min-w-0 text-sm font-semibold text-gray-900 dark:text-gray-100">
            {formatDateCompactZurich(days[0])} – {formatDateCompactZurich(days[2])}
          </h2>
          <Button size="sm" variant="outline" onClick={() => onDayChange(today)} className="shrink-0">
            {t('common:today')}
          </Button>
        </div>
        <IconButton label={t('nextDays')} onClick={() => onDayChange(addDays(dayStart, 3))} className="shrink-0">
          <ChevronRight className="!size-5" />
        </IconButton>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-[3rem_repeat(3,1fr)] border-b border-gray-200 dark:border-gray-700">
        <div />
        {days.map((date, i) => {
          const isToday = isSameDay(date, today)
          return (
            <div key={i} className="flex flex-col items-center py-1">
              <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
                {formatDate(date, 'EEE')}
              </span>
              <span
                className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${
                  isToday ? 'bg-gold-400 text-brand-900' : 'text-gray-900 dark:text-gray-100'
                }`}
              >
                {date.getDate()}
              </span>
            </div>
          )
        })}
      </div>

      {/* All-day section */}
      {(() => {
        const hasAllDay = days.some((d) => (allDayByDay.get(toDateKey(d)) ?? []).length > 0)
        if (!hasAllDay) return null
        return (
          <div className="grid grid-cols-[3rem_repeat(3,1fr)] border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-center text-[9px] text-gray-400">
              {t('common:allDay')}
            </div>
            {days.map((date, ci) => {
              const key = toDateKey(date)
              const dayAllDay = allDayByDay.get(key) ?? []
              return (
                <div key={ci} className="space-y-px border-l border-gray-200 px-0.5 py-1 dark:border-gray-700">
                  {dayAllDay.slice(0, 2).map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => onEntryClick?.(e)}
                      title={e.title}
                      className={`block w-full truncate rounded px-1 text-[9px] font-medium leading-[14px] ${blockClasses(e)} ${cancelledClasses(e)}`}
                    >
                      {e.title}
                    </button>
                  ))}
                  {dayAllDay.length > 2 && (
                    <div className="text-[8px] text-gray-400">+{dayAllDay.length - 2}</div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })()}

      {/* Time grid */}
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-y-auto"
        style={{ maxHeight: 'calc(100vh - 18rem)' }}
      >
        <div className="grid grid-cols-[3rem_repeat(3,1fr)]" style={{ height: totalHeight }}>
          {/* Hour labels */}
          <div className="relative border-r border-gray-200 dark:border-gray-700">
            {hourLabels.map((hl) => (
              <div
                key={hl.minutes}
                className="absolute right-1 text-[10px] leading-none text-gray-400"
                style={{ top: Math.max(0, minutesToOffset(hl.minutes, timeRange.startMin) - 5) }}
              >
                {hl.label}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((date, ci) => {
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

                {/* Now line */}
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
                    className={`absolute overflow-hidden rounded px-1 py-0.5 text-[10px] leading-tight ${blockClasses(pe.entry)} ${cancelledClasses(pe.entry)}`}
                    style={{
                      top: pe.top + 1,
                      height: pe.height - 2,
                      left: `calc(${pe.left * 100}% + 1px)`,
                      width: `calc(${pe.width * 100}% - 3px)`,
                    }}
                  >
                    <div title={pe.entry.startTime ?? undefined} className="truncate font-medium">{pe.entry.startTime}</div>
                    <div title={pe.entry.title} className="truncate">{pe.entry.title}</div>
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

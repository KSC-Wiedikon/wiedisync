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
  formatDate,
  DAY_HEADERS,
} from '../../../utils/dateUtils'
import { getDay } from 'date-fns'

/* ── colours ─────────────────────────────────────────────── */

const barColors: Record<string, { bg: string; text: string; darkBg: string; darkText: string }> = {
  'game-home': { bg: 'bg-brand-200', text: 'text-brand-900', darkBg: 'dark:bg-brand-800', darkText: 'dark:text-brand-100' },
  'game-away': { bg: 'bg-amber-200', text: 'text-amber-900', darkBg: 'dark:bg-amber-800', darkText: 'dark:text-amber-100' },
  game:        { bg: 'bg-brand-200', text: 'text-brand-900', darkBg: 'dark:bg-brand-800', darkText: 'dark:text-brand-100' },
  training:    { bg: 'bg-green-200', text: 'text-green-900', darkBg: 'dark:bg-green-800', darkText: 'dark:text-green-100' },
  closure:     { bg: 'bg-red-200', text: 'text-red-900', darkBg: 'dark:bg-red-800', darkText: 'dark:text-red-100' },
  event:       { bg: 'bg-purple-200', text: 'text-purple-900', darkBg: 'dark:bg-purple-800', darkText: 'dark:text-purple-100' },
  hall:        { bg: 'bg-cyan-200', text: 'text-cyan-900', darkBg: 'dark:bg-cyan-800', darkText: 'dark:text-cyan-100' },
  absence:     { bg: 'bg-gray-900', text: 'text-white', darkBg: 'dark:bg-gray-100', darkText: 'dark:text-gray-900' },
  'scorer-duty': { bg: 'bg-indigo-200', text: 'text-indigo-900', darkBg: 'dark:bg-indigo-800', darkText: 'dark:text-indigo-100' },
}

function colorKey(e: CalendarEntry): string {
  if (e.type === 'game' && e.gameType) return `game-${e.gameType}`
  return e.type
}

function blockClasses(e: CalendarEntry): string {
  const c = barColors[colorKey(e)] ?? barColors.game
  return `${c.bg} ${c.text} ${c.darkBg} ${c.darkText}`
}

/* ── time helpers ─────────────────────────────────────────── */

const HOUR_HEIGHT = 48 // px per hour
const TOP_PAD = 12     // px padding above first hour line

/** Get time range for a day: Mon-Fri 17:00-22:00, Sat-Sun 10:30-20:30 */
function getDayTimeRange(date: Date): { startMin: number; endMin: number } {
  const dow = getDay(date) // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) {
    return { startMin: 10 * 60 + 30, endMin: 20 * 60 + 30 } // 10:30–20:30
  }
  return { startMin: 17 * 60, endMin: 22 * 60 } // 17:00–22:00
}

/** Compute the widest time range across multiple days */
function getVisibleRange(days: Date[]): { startMin: number; endMin: number } {
  let min = Infinity
  let max = -Infinity
  for (const d of days) {
    const r = getDayTimeRange(d)
    if (r.startMin < min) min = r.startMin
    if (r.endMin > max) max = r.endMin
  }
  return { startMin: min, endMin: max }
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + (m || 0)
}

function minutesToOffset(minutes: number, rangeStartMin: number): number {
  return TOP_PAD + ((minutes - rangeStartMin) / 60) * HOUR_HEIGHT
}

function formatHour(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${String(h).padStart(2, '0')}:00` : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/* ── overlap layout ──────────────────────────────────────── */

interface PositionedEvent {
  entry: CalendarEntry
  top: number
  height: number
  left: number   // fraction 0-1
  width: number  // fraction 0-1
}

function layoutOverlaps(entries: CalendarEntry[], rangeStartMin: number): PositionedEvent[] {
  if (entries.length === 0) return []

  const items = entries
    .filter((e) => e.startTime)
    .map((e) => {
      const startMin = timeToMinutes(e.startTime!)
      const endMin = e.endTime ? timeToMinutes(e.endTime) : startMin + 60
      return { entry: e, startMin, endMin }
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)

  // Assign columns using greedy algorithm
  const columns: typeof items[number][][] = []

  for (const item of items) {
    let placed = false
    for (const col of columns) {
      if (col[col.length - 1].endMin <= item.startMin) {
        col.push(item)
        placed = true
        break
      }
    }
    if (!placed) {
      columns.push([item])
    }
  }

  const totalCols = columns.length
  const result: PositionedEvent[] = []

  for (let colIdx = 0; colIdx < columns.length; colIdx++) {
    for (const item of columns[colIdx]) {
      result.push({
        entry: item.entry,
        top: minutesToOffset(item.startMin, rangeStartMin),
        height: Math.max(((item.endMin - item.startMin) / 60) * HOUR_HEIGHT, 18),
        left: colIdx / totalCols,
        width: 1 / totalCols,
      })
    }
  }

  return result
}

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
  const weekMonday = startOfWeek(weekStart)
  const weekSunday = endOfWeek(weekStart)
  const weekDays = eachDayOfInterval(weekMonday, weekSunday)

  // Compute time range for the whole week, tightened to actual entries
  const timeRange = useMemo(() => {
    const base = getVisibleRange(weekDays)
    let earliestMin = Infinity
    let latestMin = -Infinity
    for (const e of entries) {
      if (e.allDay || e.endDate || !e.startTime) continue
      for (const day of weekDays) {
        if (isSameDay(e.date, day)) {
          const sm = timeToMinutes(e.startTime)
          earliestMin = Math.min(earliestMin, sm)
          latestMin = Math.max(latestMin, e.endTime ? timeToMinutes(e.endTime) : sm + 60)
        }
      }
    }
    if (earliestMin === Infinity) return base
    const smartStart = Math.floor((earliestMin - 30) / 60) * 60
    const smartEnd = Math.max(latestMin, base.endMin)
    return {
      startMin: Math.max(smartStart, 0),
      endMin: Math.ceil(smartEnd / 60) * 60,
    }
  }, [weekDays, entries])
  const totalHours = (timeRange.endMin - timeRange.startMin) / 60
  const totalHeight = totalHours * HOUR_HEIGHT + TOP_PAD

  // Generate hour labels
  const hourLabels = useMemo(() => {
    const labels: { minutes: number; label: string }[] = []
    const firstHour = Math.ceil(timeRange.startMin / 60) * 60
    for (let m = firstHour; m <= timeRange.endMin; m += 60) {
      labels.push({ minutes: m, label: formatHour(m) })
    }
    return labels
  }, [timeRange])

  // Scroll to first hour on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [weekDays])

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
      result.set(key, layoutOverlaps(dayEntries, timeRange.startMin))
    }
    return result
  }, [timedByDay, timeRange])

  // Current time position
  const now = new Date()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const nowOffset = minutesToOffset(nowMinutes, timeRange.startMin)
  const showNowLine = nowMinutes >= timeRange.startMin && nowMinutes <= timeRange.endMin

  const weekLabel = `${formatDate(weekMonday, 'MMM d')} – ${formatDate(weekSunday, 'MMM d, yyyy')}`

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
                {DAY_HEADERS[i]}
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

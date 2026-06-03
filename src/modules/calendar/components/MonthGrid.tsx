import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { CalendarEntry } from '../../../types/calendar'
import { relId } from '../../../utils/relations'
import { CalendarOff, TrafficCone, CircleX, Star } from 'lucide-react'
import BasketballIcon from '../../../components/BasketballIcon'
import VolleyballIcon from '../../../components/VolleyballIcon'
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  isSameMonth,
  isSameDay,
  toDateKey,
  formatDate,
  DAY_HEADERS,
} from '../../../utils/dateUtils'

/* ── type icons (lucide-react, colored via currentColor) ─── */

const ICON_CLASS = 'inline-block h-3.5 w-3.5 shrink-0'

const TypeIcon = ({ type, sport, className = '' }: { type: string; sport?: 'volleyball' | 'basketball'; className?: string }) => {
  if (type === 'training') {
    return <TrafficCone className={`${ICON_CLASS} ${className}`} strokeWidth={2.5} />
  }
  if (type === 'closure') {
    return <CircleX className={`${ICON_CLASS} ${className}`} strokeWidth={2.5} />
  }
  if (type === 'game' || type === 'game-home' || type === 'game-away') {
    return sport === 'basketball'
      ? <BasketballIcon className={`${ICON_CLASS} ${className}`} />
      : <VolleyballIcon className={`${ICON_CLASS} ${className}`} />
  }
  if (type === 'event') {
    return <Star className={`${ICON_CLASS} ${className}`} fill="currentColor" strokeWidth={2} />
  }
  if (type === 'absence') {
    return <CalendarOff className={`${ICON_CLASS} ${className}`} strokeWidth={2.5} />
  }
  if (type === 'hall') {
    return <BasketballIcon className={ICON_CLASS} filled />
  }
  // Fallback dot
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full bg-current ${className}`} />
}

/* ── colour helpers ──────────────────────────────────────── */

const barColors: Record<string, { bg: string; text: string; darkBg: string; darkText: string }> = {
  'game-home': { bg: 'bg-brand-200', text: 'text-brand-900', darkBg: 'dark:bg-brand-800', darkText: 'dark:text-brand-100' },
  'game-away': { bg: 'bg-amber-200', text: 'text-amber-900', darkBg: 'dark:bg-amber-800', darkText: 'dark:text-amber-100' },
  game:        { bg: 'bg-brand-200', text: 'text-brand-900', darkBg: 'dark:bg-brand-800', darkText: 'dark:text-brand-100' },
  training:    { bg: 'bg-green-200', text: 'text-green-900', darkBg: 'dark:bg-green-800', darkText: 'dark:text-green-100' },
  closure:     { bg: 'bg-red-200', text: 'text-red-900', darkBg: 'dark:bg-red-800', darkText: 'dark:text-red-100' },
  event:       { bg: 'bg-purple-200', text: 'text-purple-900', darkBg: 'dark:bg-purple-800', darkText: 'dark:text-purple-100' },
  hall:        { bg: 'bg-cyan-200', text: 'text-cyan-900', darkBg: 'dark:bg-cyan-800', darkText: 'dark:text-cyan-100' },
  absence:     { bg: 'bg-gray-900', text: 'text-white', darkBg: 'dark:bg-gray-100', darkText: 'dark:text-gray-900' },
  blue:        { bg: 'bg-blue-200', text: 'text-blue-900', darkBg: 'dark:bg-blue-800', darkText: 'dark:text-blue-100' },
}

function colorKey(e: CalendarEntry): string {
  if (e.type === 'game' && e.gameType) return `game-${e.gameType}`
  return e.type
}

/** Palette key for colouring — honours an entry's `colorOverride`. The icon
 *  shape still follows `colorKey()`/`type`, so only the colour changes. */
function paintKey(e: CalendarEntry): string {
  return e.colorOverride ?? colorKey(e)
}

const dotColors: Record<string, string> = {
  'game-home': 'bg-brand-500',
  'game-away': 'bg-amber-500',
  game: 'bg-brand-500',
  training: 'bg-green-500',
  closure: 'bg-red-500',
  event: 'bg-purple-500',
  hall: 'bg-cyan-500',
  absence: 'bg-gray-900 dark:bg-gray-100',
  blue: 'bg-blue-500',
}

/* ── spanning bar layout algorithm ───────────────────────── */

interface BarSegment {
  entry: CalendarEntry
  lane: number
  startCol: number   // 0-based column within the week-row (0=Mon … 6=Sun)
  span: number       // number of columns to span
  continues: boolean // continues into next week
  continued: boolean // continuation from prev week
}

/**
 * For a given week (array of 7 Dates), compute bar segments for multi-day/all-day events.
 * Returns timed (single-day, non-all-day) entries separately.
 */
function layoutWeek(
  weekDays: Date[],
  entries: CalendarEntry[],
): { bars: BarSegment[]; timedByCol: CalendarEntry[][]; absencesByCol: CalendarEntry[][] } {
  const weekStartKey = toDateKey(weekDays[0])
  const weekEndKey = toDateKey(weekDays[6])

  // Separate multi-day/all-day from timed single-day entries
  const spanning: CalendarEntry[] = []
  const timedByCol: CalendarEntry[][] = Array.from({ length: 7 }, () => [])
  // Collect absences per column (handled separately — merged into one row)
  const absencesByCol: CalendarEntry[][] = Array.from({ length: 7 }, () => [])

  for (const e of entries) {
    const entryEndKey = e.endDate ? toDateKey(e.endDate) : toDateKey(e.date)
    const entryStartKey = toDateKey(e.date)

    // Does this entry touch this week at all?
    if (entryStartKey > weekEndKey || entryEndKey < weekStartKey) continue

    // Absences are collected per-column, not laid out as spanning bars
    if (e.type === 'absence') {
      const startCol = entryStartKey <= weekStartKey ? 0 : weekDays.findIndex((d) => toDateKey(d) === entryStartKey)
      const endCol = entryEndKey >= weekEndKey ? 6 : weekDays.findIndex((d) => toDateKey(d) === entryEndKey)
      for (let c = Math.max(0, startCol); c <= Math.min(6, endCol); c++) {
        absencesByCol[c].push(e)
      }
      continue
    }

    if (e.allDay || e.endDate) {
      spanning.push(e)
    } else {
      // Single-day timed entry → find which column
      const col = weekDays.findIndex((d) => isSameDay(d, e.date))
      if (col >= 0) timedByCol[col].push(e)
    }
  }

  // Sort spanning entries by start date (earlier first), then by length (longer first)
  spanning.sort((a, b) => {
    const cmp = toDateKey(a.date).localeCompare(toDateKey(b.date))
    if (cmp !== 0) return cmp
    const aLen = a.endDate ? toDateKey(a.endDate).localeCompare(toDateKey(a.date)) : 0
    const bLen = b.endDate ? toDateKey(b.endDate).localeCompare(toDateKey(b.date)) : 0
    return bLen - aLen // longer first
  })

  // Assign lanes (greedy)
  const lanes: string[][] = [] // lanes[lane][col] = entryId or empty
  const bars: BarSegment[] = []

  for (const e of spanning) {
    const eStartKey = toDateKey(e.date)
    const eEndKey = e.endDate ? toDateKey(e.endDate) : eStartKey

    // Clamp to this week
    const startCol = eStartKey <= weekStartKey ? 0 : weekDays.findIndex((d) => toDateKey(d) === eStartKey)
    const endCol = eEndKey >= weekEndKey ? 6 : weekDays.findIndex((d) => toDateKey(d) === eEndKey)
    if (startCol < 0 || endCol < 0) continue

    const span = endCol - startCol + 1

    // Find first lane that's free for this range
    let lane = -1
    for (let l = 0; l < lanes.length; l++) {
      let free = true
      for (let c = startCol; c <= endCol; c++) {
        if (lanes[l][c]) { free = false; break }
      }
      if (free) { lane = l; break }
    }
    if (lane === -1) {
      lane = lanes.length
      lanes.push(Array(7).fill(''))
    }

    for (let c = startCol; c <= endCol; c++) {
      lanes[lane][c] = e.id
    }

    bars.push({
      entry: e,
      lane,
      startCol,
      span,
      continues: eEndKey > weekEndKey,
      continued: eStartKey < weekStartKey,
    })
  }

  return { bars, timedByCol, absencesByCol }
}

/* ── component ───────────────────────────────────────────── */

interface MonthGridProps {
  entries: CalendarEntry[]
  closedDates: Set<string>
  month: Date
  onMonthChange: (month: Date) => void
  onEntryClick?: (entry: CalendarEntry) => void
  onOverflowClick?: (entries: CalendarEntry[], date: Date) => void
  /** Tailwind classes for closed (school-holiday) day cells. Defaults to a faint tint. */
  closedClassName?: string
}

export default function MonthGrid({
  entries,
  closedDates,
  month,
  onMonthChange,
  onEntryClick,
  onOverflowClick,
  closedClassName = 'bg-red-50/40 dark:bg-red-950/20',
}: MonthGridProps) {
  const { t } = useTranslation()
  const today = new Date()
  const monthStart = startOfMonth(month)
  const monthEnd = endOfMonth(month)
  const gridStart = startOfWeek(monthStart)
  const gridEnd = endOfWeek(monthEnd)
  const allDays = eachDayOfInterval(gridStart, gridEnd)

  // Split days into week-rows of 7
  const weekRows = useMemo(() => {
    const rows: Date[][] = []
    for (let i = 0; i < allDays.length; i += 7) {
      rows.push(allDays.slice(i, i + 7))
    }
    return rows
  }, [allDays])

  // Pre-compute layout for each week
  const weekLayouts = useMemo(
    () => weekRows.map((week) => layoutWeek(week, entries)),
    [weekRows, entries],
  )

  const MAX_VISIBLE_BARS = 2
  const MAX_VISIBLE_TIMED = 5

  return (
    <div className="flex flex-1 flex-col">
      {/* Month header */}
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => onMonthChange(addMonths(month, -1))}
          aria-label={t('prevMonth')}
          className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {formatDate(month, 'MMMM yyyy')}
          </h2>
          <button
            onClick={() => onMonthChange(startOfMonth(new Date()))}
            className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            {t('today')}
          </button>
        </div>
        <button
          onClick={() => onMonthChange(addMonths(month, 1))}
          aria-label={t('nextMonth')}
          className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700">
        {DAY_HEADERS.map((d) => (
          <div key={d} className="py-1.5 text-center text-xs font-medium text-gray-600 dark:text-gray-400">
            {d}
          </div>
        ))}
      </div>

      {/* Week rows */}
      <div className="flex flex-1 flex-col border-l border-gray-200 dark:border-gray-700">
        {weekRows.map((week, wi) => {
          const { bars, timedByCol, absencesByCol } = weekLayouts[wi]
          const hasAnyAbsence = absencesByCol.some((a) => a.length > 0)
          const BAR_H = 18
          const barAreaHeight = hasAnyAbsence ? BAR_H : 0

          return (
            <div key={wi} className="relative flex flex-1 flex-col">
              {/* Day cells row */}
              <div className="grid flex-1 grid-cols-7">
                {week.map((date, ci) => {
                  const key = toDateKey(date)
                  const inMonth = isSameMonth(date, month)
                  const isToday = isSameDay(date, today)
                  const isClosed = closedDates.has(key)
                  const timed = timedByCol[ci]

                  // Non-absence spanning entries covering this day
                  const cellBars = bars.filter(
                    (b) => ci >= b.startCol && ci < b.startCol + b.span,
                  )
                  const visibleBars = cellBars.filter((b) => b.lane < MAX_VISIBLE_BARS)
                  const hiddenBars = cellBars.filter((b) => b.lane >= MAX_VISIBLE_BARS).length

                  const visibleTimed = timed.slice(0, MAX_VISIBLE_TIMED)
                  const hiddenTimed = Math.max(0, timed.length - MAX_VISIBLE_TIMED)
                  const overflow = hiddenBars + hiddenTimed

                  // Pick the first visible all-day entry for full-cell background
                  const bgBar = visibleBars[0] ?? null
                  const bgColor = bgBar ? barColors[paintKey(bgBar.entry)] : null

                  return (
                    <div
                      key={key}
                      className={`relative flex min-h-[3rem] flex-col border-b border-r border-gray-200 p-0.5 sm:min-h-[4rem] lg:min-h-[5rem] lg:p-1 dark:border-gray-700 ${
                        bgColor
                          ? `${bgColor.bg} ${bgColor.darkBg}`
                          : !inMonth
                            ? 'bg-gray-50 dark:bg-gray-900'
                            : isClosed
                              ? closedClassName
                              : 'bg-white dark:bg-gray-800'
                      }`}
                      onClick={bgBar ? () => onEntryClick?.(bgBar.entry) : undefined}
                      role={bgBar ? 'button' : undefined}
                    >
                      {/* Date number */}
                      <div className="relative z-20 flex items-start">
                        <span
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                            isToday
                              ? 'bg-gold-400 font-bold text-brand-900'
                              : bgColor
                                ? `${bgColor.text} ${bgColor.darkText}`
                                : !inMonth
                                  ? 'text-gray-300 dark:text-gray-600'
                                  : 'text-gray-700 dark:text-gray-300'
                          }`}
                        >
                          {date.getDate()}
                        </span>
                      </div>

                      {/* Reserve space for absence bar overlays */}
                      {barAreaHeight > 0 && <div style={{ height: barAreaHeight }} />}

                      {/* Other all-day event labels (vertically centered) */}
                      {visibleBars.length > 0 && (
                        <div className="flex flex-1 flex-col items-center justify-center">
                          {visibleBars.map((bar) => {
                            // Only show label on the first column of the span
                            if (ci !== bar.startCol) return null
                            const c = barColors[paintKey(bar.entry)]
                            return (
                              <div key={bar.entry.id} className={`truncate text-center text-[10px] font-semibold leading-tight lg:text-xs ${c.text} ${c.darkText}`}>
                                {bar.entry.title}
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* Timed events */}
                      {inMonth && (visibleTimed.length + overflow > 0) && (
                        <div className="mt-auto space-y-px overflow-hidden">
                          {visibleTimed.map((entry) => {
                            const entryColor = barColors[paintKey(entry)]
                            const useChip = !bgColor && (entry.type === 'event' || entry.type === 'game')
                            return (
                            <button
                              key={entry.id}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onEntryClick?.(entry)
                              }}
                              className={`flex w-full items-center gap-0.5 truncate rounded px-0.5 text-left text-[10px] font-medium leading-snug transition-opacity hover:opacity-80 lg:text-xs ${
                                bgColor
                                  ? `${bgColor.text} ${bgColor.darkText}`
                                  : useChip
                                    ? `${entryColor.bg} ${entryColor.darkBg} ${entryColor.text} ${entryColor.darkText}`
                                    : 'text-gray-800 dark:text-gray-200'
                              }`}
                            >
                              <TypeIcon type={colorKey(entry)} sport={entry.sport} className={dotColors[paintKey(entry)].replace('bg-', 'text-')} />
                              {entry.startTime && (
                                <span className="font-medium">{entry.startTime}</span>
                              )}
                              {entry.type === 'game' && entry.gameType ? (
                                <>
                                  <span className={`hidden lg:inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm text-[8px] font-bold leading-none text-white ${entry.gameType === 'home' ? 'bg-brand-500' : 'bg-amber-500'}`}>
                                    {entry.gameType === 'home' ? 'H' : 'A'}
                                  </span>
                                  {entry.teamNames[0] ? <span className="hidden lg:inline truncate">{entry.teamNames[0]}</span> : null}
                                </>
                              ) : (
                                <span className="hidden lg:inline truncate">{entry.title}</span>
                              )}
                            </button>
                            )
                          })}
                          {overflow > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                const allForDay = entries.filter((en) => {
                                  const enEnd = en.endDate ?? en.date
                                  return toDateKey(en.date) <= key && toDateKey(enEnd) >= key
                                })
                                onOverflowClick?.(allForDay, date)
                              }}
                              className={`rounded px-1 text-[10px] font-medium hover:bg-gray-100 lg:text-xs dark:hover:bg-gray-700 ${
                                bgColor ? `${bgColor.text} ${bgColor.darkText}` : 'text-gray-500 dark:text-gray-400'
                              }`}
                            >
                              +{overflow} more
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Absence bar overlay — merged spans that break only when count changes */}
              {hasAnyAbsence && (() => {
                // A member can have BOTH a one-off absence and a weekly unavailability on
                // the same day — they should count and render as ONE person. Key by member,
                // and prefer the one-off absence entry for the single-entry click (absence
                // overrides unavailability).
                const memberKey = (e: CalendarEntry): string => {
                  const src = e.source as { member?: unknown } | null | undefined
                  const id = src && typeof src === 'object' && 'member' in src ? relId(src.member) : ''
                  return id || e.id
                }
                const isWeekly = (e: CalendarEntry): boolean =>
                  (e.source as { type?: string } | null | undefined)?.type === 'weekly'
                const pickPrimary = (col: CalendarEntry[]): CalendarEntry =>
                  col.find((a) => !isWeekly(a)) ?? col[0]
                // Build merged segments: adjacent columns with the same set of absence rows → one span
                const segments: { startCol: number; span: number; count: number; idsKey: string; primary: CalendarEntry; allAbsences: CalendarEntry[] }[] = []
                for (let ci = 0; ci < 7; ci++) {
                  const col = absencesByCol[ci]
                  if (col.length === 0) continue
                  const ids = col.map((a) => a.id).sort().join(',')
                  const prev = segments[segments.length - 1]
                  if (prev && prev.startCol + prev.span === ci && prev.idsKey === ids) {
                    prev.span++
                    // Accumulate all unique absences across the span
                    for (const a of col) {
                      if (!prev.allAbsences.find((e) => e.id === a.id)) prev.allAbsences.push(a)
                    }
                  } else {
                    segments.push({ startCol: ci, span: 1, count: new Set(col.map(memberKey)).size, idsKey: ids, primary: pickPrimary(col), allAbsences: [...col] })
                  }
                }
                const c = barColors.absence
                return (
                  <div className="pointer-events-none absolute inset-x-0 top-[28px] z-10 grid grid-cols-7" style={{ height: BAR_H }}>
                    {segments.map((seg) => {
                      const label = seg.count === 1
                        ? seg.primary.title.replace(/^Absence · /, '')
                        : `${seg.count} absent`
                      return (
                        <button
                          key={seg.startCol}
                          type="button"
                          className={`pointer-events-auto flex items-center gap-0.5 truncate rounded px-1 text-[10px] font-medium leading-none transition-opacity hover:opacity-80 lg:text-xs ${c.bg} ${c.text} ${c.darkBg} ${c.darkText}`}
                          style={{
                            gridColumn: `${seg.startCol + 1} / span ${seg.span}`,
                            height: BAR_H - 2,
                            marginTop: 1,
                            marginLeft: 2,
                            marginRight: 2,
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (seg.count === 1) {
                              onEntryClick?.(seg.primary)
                            } else {
                              onOverflowClick?.(seg.allAbsences, week[seg.startCol])
                            }
                          }}
                        >
                          <TypeIcon type="absence" className="text-current" />
                          <span className="truncate">{label}</span>
                        </button>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          )
        })}
      </div>
    </div>
  )
}

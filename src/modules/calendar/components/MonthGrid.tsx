import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { CalendarEntry } from '../../../types/calendar'
import { relId } from '../../../utils/relations'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { dotColors, monthTints, colorKey, paintKey, cancelledClasses } from '../entryStyle'
import CalendarTypeIcon from './CalendarTypeIcon'
import { trimBBTeamName } from '../../../utils/teamColors'
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
  dayHeaders,
} from '../../../utils/dateUtils'

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
 * Returns the per-day entry list (timed entries plus birthdays) separately.
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

    // Birthdays stay all-day in the data model (date-only; the iCal export needs
    // VALUE=DATE), but as a spanning bar one would become the cell's background
    // and repaint the whole day pink. Listed with the day's entries instead.
    if (e.type === 'birthday') {
      const col = weekDays.findIndex((d) => isSameDay(d, e.date))
      if (col >= 0) timedByCol[col].push(e)
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

  // Birthdays lead the day, above the timed entries (the absence bar sits above
  // both). Stable, so the incoming order of everything else is untouched.
  for (const col of timedByCol) {
    col.sort((a, b) => Number(b.type === 'birthday') - Number(a.type === 'birthday'))
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

/* ── absence row: merged spans that break only when the set changes ── */

interface AbsenceSegment {
  startCol: number
  span: number
  count: number
  idsKey: string
  primary: CalendarEntry
  allAbsences: CalendarEntry[]
}

function mergeAbsences(absencesByCol: CalendarEntry[][]): AbsenceSegment[] {
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

  const segments: AbsenceSegment[] = []
  for (let ci = 0; ci < 7; ci++) {
    const col = absencesByCol[ci]
    if (col.length === 0) continue
    const ids = col.map((a) => a.id).sort().join(',')
    const prev = segments[segments.length - 1]
    if (prev && prev.startCol + prev.span === ci && prev.idsKey === ids) {
      prev.span++
      for (const a of col) {
        if (!prev.allAbsences.find((e) => e.id === a.id)) prev.allAbsences.push(a)
      }
    } else {
      segments.push({ startCol: ci, span: 1, count: new Set(col.map(memberKey)).size, idsKey: ids, primary: pickPrimary(col), allAbsences: [...col] })
    }
  }
  return segments
}

const MAX_VISIBLE_BARS = 2
const MAX_VISIBLE_TIMED = 4
/** Height of one spanning-bar lane (absences + all-day events), incl. 2px gap. */
const LANE_H = 20
/** Offset of the first lane from the top of a week row: cell padding + date number. */
const LANES_TOP = 30

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
  /** Optional date → reason map; surfaced as the closed-day cell tooltip. */
  closedReasons?: Map<string, string>
}

export default function MonthGrid({
  entries,
  closedDates,
  month,
  onMonthChange,
  onEntryClick,
  onOverflowClick,
  closedClassName = 'bg-red-50/40 dark:bg-red-950/20',
  closedReasons,
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

  const navBtn =
    'inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'

  return (
    <div className="flex flex-1 flex-col">
      {/* Month header */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          {formatDate(month, 'MMMM yyyy')}
        </h2>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onMonthChange(startOfMonth(new Date()))}
            className="inline-flex h-9 items-center rounded-md border border-gray-200 px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {t('today')}
          </button>
          <button onClick={() => onMonthChange(addMonths(month, -1))} aria-label={t('prevMonth')} className={navBtn}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={() => onMonthChange(addMonths(month, 1))} aria-label={t('nextMonth')} className={navBtn}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60">
          {dayHeaders().map((d) => (
            <div key={d} className="py-2 text-center text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {d}
            </div>
          ))}
        </div>

        {/* Week rows */}
        <div className="flex flex-1 flex-col">
          {weekRows.map((week, wi) => {
            const { bars, timedByCol, absencesByCol } = weekLayouts[wi]
            const absenceSegs = mergeAbsences(absencesByCol)
            const absenceRows = absenceSegs.length > 0 ? 1 : 0
            const barLanes = Math.min(MAX_VISIBLE_BARS, bars.reduce((m, b) => Math.max(m, b.lane + 1), 0))
            const laneAreaHeight = (absenceRows + barLanes) * LANE_H

            return (
              <div
                key={wi}
                className={`relative flex flex-1 flex-col ${wi < weekRows.length - 1 ? 'border-b border-gray-200 dark:border-gray-700' : ''}`}
              >
                {/* Day cells row */}
                <div className="grid flex-1 grid-cols-7">
                  {week.map((date, ci) => {
                    const key = toDateKey(date)
                    const inMonth = isSameMonth(date, month)
                    const isToday = isSameDay(date, today)
                    const isClosed = closedDates.has(key)
                    const timed = timedByCol[ci]

                    const hiddenBars = bars.filter(
                      (b) => b.lane >= MAX_VISIBLE_BARS && ci >= b.startCol && ci < b.startCol + b.span,
                    ).length
                    const visibleTimed = timed.slice(0, MAX_VISIBLE_TIMED)
                    const hiddenTimed = Math.max(0, timed.length - MAX_VISIBLE_TIMED)
                    const overflow = hiddenBars + hiddenTimed

                    return (
                      <div
                        key={key}
                        className={`relative flex min-h-[5.5rem] min-w-0 flex-col p-1 lg:min-h-[7rem] ${
                          ci < 6 ? 'border-r border-gray-200 dark:border-gray-700' : ''
                        } ${
                          !inMonth
                            ? 'bg-gray-50/70 dark:bg-gray-900/60'
                            : isClosed
                              ? closedClassName
                              : 'bg-white dark:bg-gray-800'
                        }`}
                        title={isClosed ? closedReasons?.get(key) : undefined}
                      >
                        {/* Date number */}
                        <div className="flex h-6 shrink-0 items-center">
                          <span
                            className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums ${
                              isToday
                                ? 'bg-primary font-semibold text-primary-foreground'
                                : !inMonth
                                  ? 'text-gray-400 dark:text-gray-600'
                                  : 'font-medium text-gray-700 dark:text-gray-300'
                            }`}
                          >
                            {date.getDate()}
                          </span>
                        </div>

                        {/* Reserve space for the spanning lanes painted by the overlay */}
                        {laneAreaHeight > 0 && <div className="shrink-0" style={{ height: laneAreaHeight + 2 }} />}

                        {inMonth && (visibleTimed.length + overflow > 0) && (
                          <div className="mt-0.5 flex min-h-0 flex-col gap-0.5 overflow-hidden">
                            {visibleTimed.map((entry) => {
                              const isChip = entry.type === 'event' || entry.type === 'game'
                              const tint = monthTints[paintKey(entry)] ?? monthTints.event
                              const iconColor = (dotColors[paintKey(entry)] ?? '').replace('bg-', 'text-')
                              return (
                                <button
                                  key={entry.id}
                                  type="button"
                                  // Cancelled entries carry the reason on hover — the
                                  // cell itself has no room for it, and the strike
                                  // alone doesn't say why.
                                  title={entry.cancelled
                                    ? [t('calendar:cancelled'), entry.description].filter(Boolean).join(' · ')
                                    : entry.title}
                                  onClick={() => onEntryClick?.(entry)}
                                  className={`flex h-5 w-full shrink-0 items-center gap-1.5 overflow-hidden rounded px-1.5 text-left text-[11px] leading-none transition-colors lg:h-[22px] lg:text-xs ${
                                    isChip
                                      ? `border-l-2 font-medium hover:brightness-95 dark:hover:brightness-110 ${tint}`
                                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/60'
                                  } ${cancelledClasses(entry)}`}
                                >
                                  {!isChip && (
                                    <CalendarTypeIcon type={colorKey(entry)} sport={entry.sport} size="sm" className={iconColor} />
                                  )}
                                  {entry.startTime && (
                                    <span className={`shrink-0 tabular-nums ${isChip ? 'font-semibold' : 'text-gray-500 dark:text-gray-400'}`}>
                                      {entry.startTime}
                                    </span>
                                  )}
                                  {entry.type === 'game' && entry.gameType ? (
                                    <>
                                      <span className="hidden shrink-0 text-[10px] font-bold opacity-60 lg:inline">
                                        {entry.gameType === 'home' ? 'H' : 'A'}
                                      </span>
                                      {(entry.teamNames[0] || entry.opponent) ? (
                                        <span className="hidden truncate lg:inline">
                                          {entry.teamNames[0] ? trimBBTeamName(entry.teamNames[0]) : ''}{entry.opponent ? ` vs ${entry.opponent}` : ''}
                                        </span>
                                      ) : null}
                                    </>
                                  ) : (
                                    // A birthday has no time to show, so below `lg` the row
                                    // would be a bare cake — keep its name at every width.
                                    <span className={`truncate ${entry.type === 'birthday' ? '' : 'hidden lg:inline'}`}>
                                      {entry.title}
                                    </span>
                                  )}
                                </button>
                              )
                            })}
                            {overflow > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const allForDay = entries.filter((en) => {
                                    const enEnd = en.endDate ?? en.date
                                    return toDateKey(en.date) <= key && toDateKey(enEnd) >= key
                                  })
                                  onOverflowClick?.(allForDay, date)
                                }}
                                className="shrink-0 self-start rounded px-1.5 py-0.5 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 lg:text-xs dark:text-gray-400 dark:hover:bg-gray-700/60 dark:hover:text-gray-100"
                              >
                                {t('calendar:moreCount', { count: overflow })}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Spanning lanes: absences first, then all-day / multi-day events */}
                {laneAreaHeight > 0 && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 grid grid-cols-7"
                    style={{ top: LANES_TOP, gridAutoRows: `${LANE_H}px` }}
                  >
                    {absenceSegs.map((seg) => {
                      const label = seg.count === 1
                        ? seg.primary.title.replace(/^Absence · /, '')
                        : t('calendar:absentCount', { count: seg.count })
                      return (
                        <button
                          key={`abs-${seg.startCol}`}
                          type="button"
                          title={label}
                          className={`pointer-events-auto mx-1 flex items-center gap-1 overflow-hidden rounded border border-dashed px-1.5 text-[11px] font-medium leading-none transition-colors hover:brightness-95 lg:text-xs dark:hover:brightness-110 ${monthTints.absence}`}
                          style={{ gridColumn: `${seg.startCol + 1} / span ${seg.span}`, gridRow: 1, height: LANE_H - 3 }}
                          onClick={() => {
                            if (seg.count === 1) onEntryClick?.(seg.primary)
                            else onOverflowClick?.(seg.allAbsences, week[seg.startCol])
                          }}
                        >
                          <CalendarTypeIcon type="absence" size="sm" className="opacity-70" />
                          <span className="truncate">{label}</span>
                        </button>
                      )
                    })}
                    {bars.filter((b) => b.lane < MAX_VISIBLE_BARS).map((bar) => {
                      const tint = monthTints[paintKey(bar.entry)] ?? monthTints.event
                      return (
                        <button
                          key={`bar-${bar.entry.id}`}
                          type="button"
                          title={bar.entry.title}
                          className={`pointer-events-auto flex items-center overflow-hidden px-1.5 text-[11px] font-semibold leading-none transition-colors hover:brightness-95 lg:text-xs dark:hover:brightness-110 ${tint} ${
                            bar.continued ? 'ml-0 rounded-l-none' : 'ml-1 rounded-l border-l-2'
                          } ${bar.continues ? 'mr-0 rounded-r-none' : 'mr-1 rounded-r'} ${cancelledClasses(bar.entry)}`}
                          style={{ gridColumn: `${bar.startCol + 1} / span ${bar.span}`, gridRow: absenceRows + bar.lane + 1, height: LANE_H - 3 }}
                          onClick={() => onEntryClick?.(bar.entry)}
                        >
                          <span className="truncate">{bar.entry.title}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

import { getDay } from 'date-fns'
import type { CalendarEntry } from '../../types/calendar'
import { isSameDay } from '../../utils/dateUtils'

/**
 * Shared week/day time-grid layout math.
 *
 * `WeekGrid` (7-day, desktop) and `MobileWeekGrid` (3-day) render the same
 * timed-event grid with identical geometry — the only behavioural difference
 * is the minimum event height (18 vs 20 px), passed to `layoutOverlaps`.
 */

/** px per hour in the week/day time grids. */
export const HOUR_HEIGHT = 48
/** px padding above the first hour line. */
export const TOP_PAD = 12

/** Time range for a day: Mon–Fri 17:00–22:00, Sat/Sun 10:30–20:30. */
export function getDayTimeRange(date: Date): { startMin: number; endMin: number } {
  const dow = getDay(date) // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) {
    return { startMin: 10 * 60 + 30, endMin: 20 * 60 + 30 } // 10:30–20:30
  }
  return { startMin: 17 * 60, endMin: 22 * 60 } // 17:00–22:00
}

/** Compute the widest time range across multiple days. */
export function getVisibleRange(days: Date[]): { startMin: number; endMin: number } {
  let min = Infinity
  let max = -Infinity
  for (const d of days) {
    const r = getDayTimeRange(d)
    if (r.startMin < min) min = r.startMin
    if (r.endMin > max) max = r.endMin
  }
  return { startMin: min, endMin: max }
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + (m || 0)
}

export function minutesToOffset(minutes: number, rangeStartMin: number): number {
  return TOP_PAD + ((minutes - rangeStartMin) / 60) * HOUR_HEIGHT
}

export function formatHour(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${String(h).padStart(2, '0')}:00` : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/* ── overlap layout ──────────────────────────────────────── */

export interface PositionedEvent {
  entry: CalendarEntry
  top: number
  height: number
  left: number   // fraction 0-1
  width: number  // fraction 0-1
}

/**
 * Greedy column layout for overlapping timed events.
 * `minHeight` clamps very short events (18px desktop, 20px mobile).
 */
export function layoutOverlaps(
  entries: CalendarEntry[],
  rangeStartMin: number,
  minHeight: number,
): PositionedEvent[] {
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
        height: Math.max(((item.endMin - item.startMin) / 60) * HOUR_HEIGHT, minHeight),
        left: colIdx / totalCols,
        width: 1 / totalCols,
      })
    }
  }

  return result
}

/** Compute the visible time range for a set of days, tightened to actual entries. */
export function computeTimeRange(
  days: Date[],
  entries: CalendarEntry[],
): { startMin: number; endMin: number } {
  const base = getVisibleRange(days)
  let earliestMin = Infinity
  let latestMin = -Infinity
  for (const e of entries) {
    if (e.allDay || e.endDate || !e.startTime) continue
    for (const day of days) {
      if (isSameDay(e.date, day)) {
        const sm = timeToMinutes(e.startTime)
        earliestMin = Math.min(earliestMin, sm)
        latestMin = Math.max(latestMin, e.endTime ? timeToMinutes(e.endTime) : sm + 60)
      }
    }
  }
  if (earliestMin === Infinity) return base
  // Start 30min before earliest event, floored to nearest hour
  const smartStart = Math.floor((earliestMin - 30) / 60) * 60
  // End at latest event end or day-range end, whichever is later
  const smartEnd = Math.max(latestMin, base.endMin)
  return {
    startMin: Math.max(smartStart, 0),
    endMin: Math.ceil(smartEnd / 60) * 60, // ceil to nearest hour
  }
}

/** Generate hour labels (every full hour within the range). */
export function buildHourLabels(
  range: { startMin: number; endMin: number },
): { minutes: number; label: string }[] {
  const labels: { minutes: number; label: string }[] = []
  const firstHour = Math.ceil(range.startMin / 60) * 60
  for (let m = firstHour; m <= range.endMin; m += 60) {
    labels.push({ minutes: m, label: formatHour(m) })
  }
  return labels
}

import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { CalendarEntry } from '../../../types/calendar'
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
import { dotColors, colorKey, cancelledClasses } from '../entryStyle'

/** Synthetic-entry id prefix for a collapsed multi-absence row (non-clickable). */
const ABSENCE_GROUP_PREFIX = 'absence-group:'

/**
 * Collapse 2+ absences on a day into a single "Absence: A, B, C" row (names are
 * carried in each absence's `title` as "Absence · Name"). A single absence is
 * left untouched (still opens its detail on tap).
 */
function collapseAbsences(entries: CalendarEntry[], label: string, dayKey: string): CalendarEntry[] {
  const absences = entries.filter((e) => e.type === 'absence')
  if (absences.length <= 1) return entries
  const names = absences
    .map((a) => { const i = a.title.indexOf(' · '); return i >= 0 ? a.title.slice(i + 3) : '' })
    .filter(Boolean)
  const combined: CalendarEntry = {
    ...absences[0],
    id: `${ABSENCE_GROUP_PREFIX}${dayKey}`,
    title: names.length ? `${label}: ${names.join(', ')}` : label,
  }
  let inserted = false
  const result: CalendarEntry[] = []
  for (const e of entries) {
    if (e.type === 'absence') { if (!inserted) { result.push(combined); inserted = true } }
    else result.push(e)
  }
  return result
}

/* ── component ───────────────────────────────────────────── */

interface MobileMonthViewProps {
  entries: CalendarEntry[]
  closedDates: Set<string>
  month: Date
  onMonthChange: (month: Date) => void
  onEntryClick?: (entry: CalendarEntry) => void
}

export default function MobileMonthView({
  entries,
  closedDates,
  month,
  onMonthChange,
  onEntryClick,
}: MobileMonthViewProps) {
  const { t } = useTranslation('calendar')
  const today = new Date()
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  const monthStart = startOfMonth(month)
  const monthEnd = endOfMonth(month)
  const gridStart = startOfWeek(monthStart)
  const gridEnd = endOfWeek(monthEnd)
  const allDays = eachDayOfInterval(gridStart, gridEnd)

  // Group entries by date key (including multi-day entries on each day they span)
  const entriesByDate = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>()
    for (const entry of entries) {
      const start = toDateKey(entry.date)

      // For multi-day entries, add to each day in range
      if (entry.endDate) {
        const days = eachDayOfInterval(entry.date, entry.endDate)
        for (const day of days) {
          const key = toDateKey(day)
          const arr = map.get(key) ?? []
          arr.push(entry)
          map.set(key, arr)
        }
      } else {
        const arr = map.get(start) ?? []
        arr.push(entry)
        map.set(start, arr)
      }
    }
    return map
  }, [entries])

  // Unique dot colors for a day (max 3)
  function getDotsForDay(dateKey: string): string[] {
    const dayEntries = entriesByDate.get(dateKey) ?? []
    const uniqueColors = new Set<string>()
    for (const e of dayEntries) {
      uniqueColors.add(dotColors[colorKey(e)] ?? 'bg-gray-400')
      if (uniqueColors.size >= 3) break
    }
    return [...uniqueColors]
  }

  // Entries for selected day
  const selectedEntries = selectedDay ? (entriesByDate.get(selectedDay) ?? []) : []
  const displayEntries = selectedDay ? collapseAbsences(selectedEntries, t('typeAbsence'), selectedDay) : selectedEntries

  function handleDayTap(dateKey: string) {
    if (selectedDay === dateKey) {
      setSelectedDay(null)
    } else {
      setSelectedDay(dateKey)
    }
  }

  return (
    <div className="flex flex-col">
      {/* Month header */}
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={() => onMonthChange(addMonths(month, -1))}
          className="min-h-[44px] min-w-[44px] rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {formatDate(month, 'MMMM yyyy')}
          </h2>
          <button
            onClick={() => onMonthChange(startOfMonth(new Date()))}
            className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            {t('common:today')}
          </button>
        </div>
        <button
          onClick={() => onMonthChange(addMonths(month, 1))}
          className="min-h-[44px] min-w-[44px] rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7">
        {dayHeaders().map((d) => (
          <div key={d} className="py-1 text-center text-[10px] font-medium text-gray-600 dark:text-gray-400">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid — compact */}
      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        {allDays.map((date) => {
          const key = toDateKey(date)
          const inMonth = isSameMonth(date, month)
          const isToday = isSameDay(date, today)
          const isClosed = closedDates.has(key)
          const isSelected = selectedDay === key
          const dots = inMonth ? getDotsForDay(key) : []

          return (
            <button
              key={key}
              type="button"
              onClick={() => inMonth && handleDayTap(key)}
              className={`flex h-11 flex-col items-center justify-center border-b border-r border-gray-100 dark:border-gray-700 ${
                !inMonth
                  ? 'bg-gray-50 dark:bg-gray-900'
                  : isClosed
                    ? 'bg-red-50/40 dark:bg-red-950/20'
                    : isSelected
                      ? 'bg-gray-100 dark:bg-gray-700'
                      : ''
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                  isToday
                    ? 'bg-gold-400 font-bold text-brand-900'
                    : !inMonth
                      ? 'text-gray-300 dark:text-gray-600'
                      : 'text-gray-800 dark:text-gray-200'
                }`}
              >
                {date.getDate()}
              </span>
              {/* Dots */}
              {dots.length > 0 && (
                <div className="mt-0.5 flex gap-0.5">
                  {dots.map((color, i) => (
                    <span key={i} className={`h-1 w-1 rounded-full ${color}`} />
                  ))}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Expanded day panel */}
      {selectedDay && selectedEntries.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300">
              {formatDate(new Date(selectedDay + 'T00:00:00'), 'EEEE, d. MMMM')}
            </h3>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {displayEntries.map((entry) => {
              const grouped = entry.id.startsWith(ABSENCE_GROUP_PREFIX)
              const body = (
                <>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotColors[colorKey(entry)]}`} />
                  <div className={`min-w-0 flex-1 ${cancelledClasses(entry)}`}>
                    <p className={`text-sm font-medium text-gray-900 dark:text-gray-100 ${grouped ? 'break-words' : 'truncate'}`}>
                      {entry.title}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {entry.allDay
                        ? t('common:allDay')
                        : entry.startTime
                          ? entry.endTime
                            ? `${entry.startTime} – ${entry.endTime}`
                            : entry.startTime
                          : ''}
                      {entry.location ? ` · ${entry.location}` : ''}
                    </p>
                  </div>
                </>
              )
              // Collapsed multi-absence row is informational (no single detail to open).
              return grouped ? (
                <div key={entry.id} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left">
                  {body}
                </div>
              ) : (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onEntryClick?.(entry)}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left active:bg-gray-50 dark:active:bg-gray-700"
                >
                  {body}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty state for selected day with no entries */}
      {selectedDay && selectedEntries.length === 0 && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-white p-4 text-center text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-800">
          {t('noEntries')}
        </div>
      )}
    </div>
  )
}

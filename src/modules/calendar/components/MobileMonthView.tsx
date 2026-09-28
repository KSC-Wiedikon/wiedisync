import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import IconButton from '@/components/IconButton'
import TruncatedText from '@/components/TruncatedText'
import { ActivityRow, DateRail, RowList } from '@/components/ActivityRow'
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
      uniqueColors.add(dotColors[colorKey(e)] ?? 'bg-muted-foreground')
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
      <div className="mb-2 flex items-center justify-between gap-2">
        <IconButton label={t('common:prevMonth')} onClick={() => onMonthChange(addMonths(month, -1))} className="text-muted-foreground">
          <ChevronLeft className="!size-5" />
        </IconButton>
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">
            {formatDate(month, 'MMMM yyyy')}
          </h2>
          <Button variant="secondary" size="sm" onClick={() => onMonthChange(startOfMonth(new Date()))} className="shrink-0">
            {t('common:today')}
          </Button>
        </div>
        <IconButton label={t('common:nextMonth')} onClick={() => onMonthChange(addMonths(month, 1))} className="text-muted-foreground">
          <ChevronRight className="!size-5" />
        </IconButton>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7">
        {dayHeaders().map((d) => (
          <div key={d} className="py-1 text-center text-[10px] font-medium text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid — compact */}
      <div className="grid grid-cols-7 overflow-hidden rounded-2xl border border-hairline bg-card shadow-card">
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
              className={`flex h-11 flex-col items-center justify-center border-b border-r border-border/60 ${
                !inMonth
                  ? 'bg-surface-sunken'
                  : isClosed
                    ? 'bg-red-50/40 dark:bg-red-950/20'
                    : isSelected
                      ? 'bg-stone-100 dark:bg-gray-700'
                      : ''
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                  isToday
                    ? 'bg-gold-400 font-bold text-brand-900'
                    : !inMonth
                      ? 'text-muted-foreground/50'
                      : 'text-foreground'
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
        <div className="mt-2 overflow-hidden rounded-2xl border border-hairline bg-card shadow-card">
          <div className="border-b border-border/60 bg-surface-sunken px-3 py-2">
            <h3 className="text-xs font-semibold text-foreground/85">
              {formatDate(new Date(selectedDay + 'T00:00:00'), 'EEEE, d. MMMM')}
            </h3>
          </div>
          {/* Shared row vocabulary: time on the rail, title WRAPS (primary
              text), location truncates with a title. */}
          <RowList className="px-1">
            {displayEntries.map((entry) => {
              const grouped = entry.id.startsWith(ABSENCE_GROUP_PREFIX)
              return (
                <ActivityRow
                  key={entry.id}
                  rail={
                    <DateRail
                      main={entry.startTime || '–'}
                      sub={entry.allDay ? t('common:allDay') : entry.endTime ? `– ${entry.endTime}` : undefined}
                    />
                  }
                  // Collapsed multi-absence row is informational (no single detail to open).
                  onClick={grouped ? undefined : () => onEntryClick?.(entry)}
                  title={
                    <div className={`flex min-w-0 items-start gap-2 ${cancelledClasses(entry)}`}>
                      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotColors[colorKey(entry)]}`} />
                      <p className="min-w-0 break-words text-sm font-medium leading-snug text-foreground">
                        {entry.title}
                      </p>
                    </div>
                  }
                >
                  {entry.location && (
                    <TruncatedText
                      text={entry.location}
                      className={`mt-0.5 text-xs text-muted-foreground ${cancelledClasses(entry)}`}
                    />
                  )}
                </ActivityRow>
              )
            })}
          </RowList>
        </div>
      )}

      {/* Empty state for selected day with no entries */}
      {selectedDay && selectedEntries.length === 0 && (
        <div className="mt-2 rounded-2xl border border-hairline bg-card p-4 shadow-card text-center text-sm text-muted-foreground/80">
          {t('noEntries')}
        </div>
      )}
    </div>
  )
}

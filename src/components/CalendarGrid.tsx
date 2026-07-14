import type { ReactNode, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  formatDate,
  toDateKey,
  dayHeaders,
} from '../utils/dateUtils'

interface CalendarGridProps<T> {
  month: Date
  onMonthChange: (month: Date) => void
  itemsByDate: Map<string, T[]>
  renderDayContent: (date: Date, items: T[]) => ReactNode
  closedDates?: Set<string>
  /** Short label shown on closed days (e.g. "Hall closure"). Opt-in. */
  closedLabel?: string
  /** date key -> closure reason, shown in small text under the closed label. */
  closureReasons?: Map<string, string>
  /**
   * Club-wide scheduling blackouts: date key -> reason. Rendered in a stronger red
   * than a hall closure — a closed hall is a venue fact, a block is a club decision
   * that no game may be played that day, so the two must stay visually distinct.
   */
  blockedDates?: Map<string, string>
  /** Short label shown on blocked days (e.g. "Blocked"). Opt-in. */
  blockedLabel?: string
  highlightedDates?: Set<string>
  /** Tailwind classes for a highlighted day cell. Defaults to a soft amber. */
  highlightClassName?: string
  /** Short label rendered beside the day number on highlighted days (opt-in). */
  highlightLabel?: string
  /** Date keys outside the season window — rendered black with `outOfSeasonLabel`. Opt-in. */
  outOfSeasonDates?: Set<string>
  /** Short label shown on out-of-season days (e.g. "Season not open"). */
  outOfSeasonLabel?: string
  minMonth?: Date
  maxMonth?: Date
  /**
   * When set, a "+" button appears on empty day cells (in-month, not past)
   * and fires with the clicked date. Useful for quick-add flows.
   */
  onEmptyDayClick?: (date: Date) => void
  /** Accessible label for the empty-day "+" quick-add button. Defaults to a
   * generic "Add" — pass a context-specific label (e.g. "Add manual game"). */
  addLabel?: string
  /**
   * When set, in-month day cells become clickable and fire with the date +
   * that day's items. Useful for opening a day-detail view.
   */
  onDayClick?: (date: Date, items: T[]) => void
}

export default function CalendarGrid<T>({
  month,
  onMonthChange,
  itemsByDate,
  renderDayContent,
  closedDates,
  closedLabel,
  closureReasons,
  blockedDates,
  blockedLabel,
  highlightedDates,
  highlightClassName = 'bg-amber-50 dark:bg-amber-950',
  highlightLabel,
  outOfSeasonDates,
  outOfSeasonLabel,
  minMonth,
  maxMonth,
  onEmptyDayClick,
  addLabel,
  onDayClick,
}: CalendarGridProps<T>) {
  const { t } = useTranslation()
  const monthStart = startOfMonth(month)
  const monthEnd = endOfMonth(month)
  const gridStart = startOfWeek(monthStart)
  const gridEnd = endOfWeek(monthEnd)
  const days = eachDayOfInterval(gridStart, gridEnd)

  const today = new Date()
  const canGoPrev = !minMonth || addMonths(month, -1) >= startOfMonth(minMonth)
  const canGoNext = !maxMonth || addMonths(month, 1) <= startOfMonth(maxMonth)

  return (
    <div className="flex flex-1 flex-col">
      {/* Month header */}
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => onMonthChange(addMonths(month, -1))}
          disabled={!canGoPrev}
          aria-label={t('prevMonth')}
          className="rounded-lg p-2.5 text-gray-600 hover:bg-gray-100 disabled:text-gray-300 disabled:hover:bg-transparent sm:p-2 dark:text-gray-400 dark:hover:bg-gray-700"
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
          disabled={!canGoNext}
          aria-label={t('nextMonth')}
          className="rounded-lg p-2.5 text-gray-600 hover:bg-gray-100 disabled:text-gray-300 disabled:hover:bg-transparent sm:p-2 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700">
        {dayHeaders().map((d) => (
          <div
            key={d}
            className="py-2 text-center text-xs font-medium text-gray-500 sm:text-sm dark:text-gray-400"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid flex-1 grid-cols-7 border-l border-gray-200 dark:border-gray-700" style={{ gridAutoRows: '1fr' }}>
        {days.map((date) => {
          const key = toDateKey(date)
          const inMonth = isSameMonth(date, month)
          const isToday = isSameDay(date, today)
          const items = itemsByDate.get(key) ?? []
          const isClosed = closedDates?.has(key) ?? false
          const isBlocked = blockedDates?.has(key) ?? false
          const blockedReason = blockedDates?.get(key) || ''
          const isHighlighted = highlightedDates?.has(key) ?? false
          const isOutOfSeason = outOfSeasonDates?.has(key) ?? false
          const clickable = !!onDayClick && inMonth && !isOutOfSeason

          return (
            <div
              key={key}
              {...(clickable
                ? {
                    role: 'button',
                    tabIndex: 0,
                    onClick: () => onDayClick!(date, items),
                    onKeyDown: (e: ReactKeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDayClick!(date, items) }
                    },
                  }
                : {})}
              className={`group relative min-h-[3rem] border-b border-r border-gray-200 p-0.5 sm:min-h-[5rem] sm:p-1 lg:min-h-[6.5rem] lg:p-2 dark:border-gray-700 ${
                clickable ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50' : ''
              } ${
                isToday ? 'ring-2 ring-inset ring-gold-400 dark:ring-gold-500' : ''
              } ${
                !inMonth ? 'bg-gray-50 dark:bg-gray-900' : isOutOfSeason ? 'bg-black' : isHighlighted ? highlightClassName : 'bg-white dark:bg-gray-800'
              }`}
            >
              {/* Closure overlay (red — visible in both light and dark mode) */}
              {isClosed && (
                <div className="pointer-events-none absolute inset-0 bg-red-50 opacity-50 dark:bg-red-900 dark:opacity-40" />
              )}

              {/* Blocked overlay — deliberately stronger than a hall closure, and
                  drawn after it so a day that is both reads as blocked. */}
              {isBlocked && (
                <div className="pointer-events-none absolute inset-0 bg-red-300/60 dark:bg-red-800/60" />
              )}

              {/* Day number (+ optional highlight label, e.g. "Spielsamstag") */}
              <div className="mb-0.5 flex items-center justify-between gap-1 sm:mb-1">
                <span
                  className={`text-xs font-medium sm:text-sm ${
                    isToday
                      ? 'font-bold text-gold-600 dark:text-gold-400'
                      : !inMonth
                        ? 'text-gray-300 dark:text-gray-600'
                        : isOutOfSeason
                          ? 'text-white/60'
                          : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {date.getDate()}
                </span>
                {isHighlighted && inMonth && !isOutOfSeason && highlightLabel && (
                  <span
                    title={highlightLabel}
                    className="min-w-0 truncate rounded bg-gold-400/25 px-1 text-[9px] font-semibold uppercase tracking-wide text-gold-700 dark:bg-gold-400/20 dark:text-gold-300"
                  >
                    {highlightLabel}
                  </span>
                )}
              </div>

              {/* Out-of-season label (e.g. "Season not open") — black-day overlay */}
              {isOutOfSeason && inMonth && outOfSeasonLabel && (
                <div className="truncate text-[9px] font-semibold uppercase tracking-wide text-white/70" title={outOfSeasonLabel}>
                  {outOfSeasonLabel}
                </div>
              )}

              {/* Closure label + reason (small) */}
              {isClosed && inMonth && closedLabel && (
                <div className="relative mb-0.5 leading-tight">
                  <div className="truncate text-[9px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
                    {closedLabel}
                  </div>
                  {closureReasons?.get(key) && (
                    <div className="truncate text-[9px] text-red-600/80 dark:text-red-300/70" title={closureReasons.get(key)}>
                      {closureReasons.get(key)}
                    </div>
                  )}
                </div>
              )}

              {/* Blocked label + reason (e.g. "Blocked" / "U20 Tournament") */}
              {isBlocked && inMonth && blockedLabel && (
                <div className="relative mb-0.5 leading-tight">
                  <div className="truncate text-[9px] font-bold uppercase tracking-wide text-red-800 dark:text-red-100">
                    {blockedLabel}
                  </div>
                  {blockedReason && (
                    <div className="truncate text-[9px] text-red-800/80 dark:text-red-100/80" title={blockedReason}>
                      {blockedReason}
                    </div>
                  )}
                </div>
              )}

              {/* Content */}
              {inMonth && (
                <div className="space-y-0.5 overflow-hidden">
                  {renderDayContent(date, items)}
                </div>
              )}

              {/* Empty-day "+" affordance (in-month, no items, not past) */}
              {inMonth
                && onEmptyDayClick
                && items.length === 0
                && date >= new Date(today.getFullYear(), today.getMonth(), today.getDate()) && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onEmptyDayClick(date) }}
                  aria-label={addLabel ?? t('add')}
                  className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-gold-400 text-brand-900 text-base font-bold shadow opacity-0 transition-opacity hover:bg-gold-500 group-hover:opacity-100 focus-visible:opacity-100 sm:h-5 sm:w-5 sm:text-sm"
                >
                  +
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

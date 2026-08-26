import type { CalendarEntry } from '../../../types/calendar'
import { useIsMobile } from '../../../hooks/useMediaQuery'
import MonthGrid from './MonthGrid'
import MobileMonthView from './MobileMonthView'

/**
 * The month view, picking the right grid for the viewport.
 *
 * The desktop/mobile split is a hard component swap at 639px (`useIsMobile`), not a
 * responsive stylesheet — there is no tablet branch, so the 640–1023px band gets
 * `MonthGrid` with its chip titles hidden behind `lg:`.
 *
 * ⚠ `MobileMonthView` takes only the five props forwarded to it. `onOverflowClick`,
 * `closedClassName` and `closedReasons` are silently ignored on a phone — it renders
 * a full day list on tap instead of a "+N more" affordance, and collapses multiple
 * absences per day itself. Passing them is not a bug; expecting them to have an
 * effect below 639px is.
 */
export default function MonthSurface({
  entries,
  closedDates,
  month,
  onMonthChange,
  onEntryClick,
  onOverflowClick,
  closedClassName,
  closedReasons,
}: {
  entries: CalendarEntry[]
  closedDates: Set<string>
  month: Date
  onMonthChange: (month: Date) => void
  onEntryClick?: (entry: CalendarEntry) => void
  onOverflowClick?: (entries: CalendarEntry[], date: Date) => void
  closedClassName?: string
  closedReasons?: Map<string, string>
}) {
  const isMobile = useIsMobile()

  return isMobile ? (
    <MobileMonthView
      entries={entries}
      closedDates={closedDates}
      month={month}
      onMonthChange={onMonthChange}
      onEntryClick={onEntryClick}
    />
  ) : (
    <MonthGrid
      entries={entries}
      closedDates={closedDates}
      month={month}
      onMonthChange={onMonthChange}
      onEntryClick={onEntryClick}
      onOverflowClick={onOverflowClick}
      closedClassName={closedClassName}
      closedReasons={closedReasons}
    />
  )
}

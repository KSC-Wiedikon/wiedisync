import { startOfMonth, endOfMonth, startOfWeek, endOfWeek } from '../../utils/dateUtils'

/**
 * The date range a month grid actually PAINTS — not the month, the grid.
 *
 * A month view shows leading days of the previous month and trailing days of the
 * next one, so fetching `startOfMonth`..`endOfMonth` leaves those cells blank even
 * though they are on screen. Weeks start Monday (dateUtils pins `weekStartsOn: 1`),
 * so the result always spans whole weeks — 28, 35 or 42 days.
 *
 * This is the visible range only. `useCalendarData` widens it to quarter boundaries
 * itself so month-to-month navigation reuses one cached query rather than refetching
 * per month; do not pre-widen it here.
 *
 * Its own module because `CalendarPage` and `TeamCalendar` both need it and
 * react-refresh forbids a component module from also exporting a plain function.
 */
export function monthGridRange(month: Date): { rangeStart: Date; rangeEnd: Date } {
  return {
    rangeStart: startOfWeek(startOfMonth(month)),
    rangeEnd: endOfWeek(endOfMonth(month)),
  }
}

import { formatWeekdayZurich } from '../../../utils/dateHelpers'

/**
 * Small muted weekday label (locale-short, e.g. "Di.") for a date input's value.
 * Renders nothing for an empty/invalid date. Dropped next to scheduling date
 * inputs so the operator sees which weekday the picked date falls on. Pass a
 * className to position it (e.g. `mt-0.5 block` to sit below the input).
 */
export default function WeekdayHint({ date, className = '' }: { date: string | null | undefined; className?: string }) {
  const wd = formatWeekdayZurich(date)
  if (!wd) return null
  return <span className={`text-xs font-medium text-gray-400 dark:text-gray-500 ${className}`}>{wd}</span>
}

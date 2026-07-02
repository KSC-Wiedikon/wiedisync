import {
  format,
  startOfMonth as fnsStartOfMonth,
  endOfMonth as fnsEndOfMonth,
  startOfWeek as fnsStartOfWeek,
  endOfWeek as fnsEndOfWeek,
  addMonths as fnsAddMonths,
  addWeeks as fnsAddWeeks,
  eachDayOfInterval as fnsEachDayOfInterval,
  isSameDay as fnsIsSameDay,
  isSameMonth as fnsIsSameMonth,
  isWithinInterval as fnsIsWithinInterval,
  parseISO,
  getDay as fnsGetDay,
} from 'date-fns'
import { enUS } from 'date-fns/locale'
import { de } from 'date-fns/locale/de'
import { fr } from 'date-fns/locale/fr'
import { it } from 'date-fns/locale/it'
import type { Locale } from 'date-fns'

export function parseDate(isoString: string): Date {
  return parseISO(isoString)
}

/** Format a Date with a date-fns pattern (enUS locale). Named `formatDatePattern`
 *  to avoid the collision with dateHelpers' `formatDate(str, locale?)` (Intl,
 *  de-CH, dd.mm.yyyy) — importing the wrong one silently changes the output. */
export function formatDatePattern(date: Date, pattern: string): string {
  return format(date, pattern, { locale: enUS })
}

/** @deprecated Use {@link formatDatePattern}. Kept as an alias so existing
 *  importers keep working; new code should prefer the unambiguous name to avoid
 *  clashing with dateHelpers' `formatDate`. */
export const formatDate = formatDatePattern

export function startOfMonth(date: Date): Date {
  return fnsStartOfMonth(date)
}

export function endOfMonth(date: Date): Date {
  return fnsEndOfMonth(date)
}

/** Monday-start week (Swiss convention) */
export function startOfWeek(date: Date): Date {
  return fnsStartOfWeek(date, { weekStartsOn: 1 })
}

export function endOfWeek(date: Date): Date {
  return fnsEndOfWeek(date, { weekStartsOn: 1 })
}

export function addMonths(date: Date, n: number): Date {
  return fnsAddMonths(date, n)
}

export function addWeeks(date: Date, n: number): Date {
  return fnsAddWeeks(date, n)
}

export function eachDayOfInterval(start: Date, end: Date): Date[] {
  return fnsEachDayOfInterval({ start, end })
}

export function isSameDay(a: Date, b: Date): boolean {
  return fnsIsSameDay(a, b)
}

export function isSameMonth(a: Date, b: Date): boolean {
  return fnsIsSameMonth(a, b)
}

export function isWithinInterval(date: Date, start: Date, end: Date): boolean {
  return fnsIsWithinInterval(date, { start, end })
}

/** Format to "YYYY-MM-DD" for use as Map keys */
export function toDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

/** 0=Mon..6=Sun (ISO convention, not JS default) */
export function getISODay(date: Date): number {
  const day = fnsGetDay(date)
  return day === 0 ? 6 : day - 1
}

/** Season months: Sep of startYear through May of startYear+1 */
export function getSeasonMonths(startYear: number): Date[] {
  const months: Date[] = []
  for (let m = 8; m <= 11; m++) {
    months.push(new Date(startYear, m, 1))
  }
  for (let m = 0; m <= 4; m++) {
    months.push(new Date(startYear + 1, m, 1))
  }
  return months
}

/** Get the season start year for a given date (Sep–May season) */
export function getSeasonYear(date: Date): number {
  const month = date.getMonth()
  return month >= 8 ? date.getFullYear() : date.getFullYear() - 1
}

/** Day-of-week headers (Monday-start) */
export const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Get date-fns locale from language code.
 *  `gsw` (Swiss German) has no date-fns locale data — map it to `de`. */
export function getLocale(lang: string): Locale {
  const lng = (lang || '').toLowerCase()
  if (lng.startsWith('de') || lng.startsWith('gsw')) return de
  if (lng.startsWith('fr')) return fr
  if (lng.startsWith('it')) return it
  return enUS
}

/** Format a date with locale awareness */
export function formatDateLocale(date: Date, pattern: string, lang: string): string {
  return format(date, pattern, { locale: getLocale(lang) })
}

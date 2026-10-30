import { formatDateZurich, formatTimeZurich, formatWeekdayZurich, toZurichDateString } from './dateHelpers'

/**
 * Free-text search over lists (events, games): every word typed must appear somewhere
 * in the item's text — accent-, case- and order-blind, so "zurich 11.12" finds an event
 * at «Zürich» on 11.12.2026.
 */
export function normalizeSearch(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function matchesSearch(query: string, parts: Array<string | number | null | undefined>): boolean {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = normalizeSearch(parts.filter((p) => p != null && p !== '').join(' \n '))
  return words.every((w) => haystack.includes(w))
}

/** Everything someone might type for a date: 11.12.2026, 11.12., 11.12, 2026-12-11, Fr / Fri. */
export function dateSearchText(input: string | null | undefined): string {
  if (!input) return ''
  const full = formatDateZurich(input) // dd.mm.yyyy
  const dayMonth = full.slice(0, 6) // dd.mm.
  return [
    full, dayMonth, dayMonth.replace(/\.$/, ''), toZurichDateString(input),
    formatWeekdayZurich(input), formatWeekdayZurich(input, 'de-CH'), formatWeekdayZurich(input, 'en-GB'),
  ].join(' ')
}

/** "14:00" for a time or an ISO instant; '' when there is none. */
export function timeSearchText(input: string | null | undefined): string {
  return input ? formatTimeZurich(input) : ''
}

/** Visible text of an HTML description. */
export function htmlToSearchText(html: string | null | undefined): string {
  return String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
}

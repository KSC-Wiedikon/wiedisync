import type { Team } from '../../types'
import { currentLocale, toZurichDateString } from '../../utils/dateHelpers'

/** Directus M2M junction row shape for events_teams (teams_id may be expanded). */
type TeamJunction = { teams_id?: Team | number | string }

/**
 * Extract Team objects from a Directus M2M junction array (events_teams[].teams_id).
 * Handles [{ teams_id: Team }], [{ teams_id: number }], [Team] or [string].
 */
export function asTeams(teams: unknown[] | null | undefined): Team[] {
  if (!Array.isArray(teams) || teams.length === 0) return []
  return teams
    .map((t) => (t as TeamJunction)?.teams_id ?? t)
    .filter((t): t is Team => t != null && typeof t === 'object' && 'name' in t)
}

/** Resolve a team ID string from a raw value or an events_teams junction row. */
export function teamId(val: unknown): string {
  if (!val) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'number') return String(val)
  const obj = (val as TeamJunction).teams_id ?? val
  return typeof obj === 'object' ? String((obj as { id?: unknown }).id ?? '') : String(obj ?? '')
}

/** True when a string contains HTML tags (vs. plain text). */
export function isHtml(str: string): boolean {
  return /<[a-z][\s\S]*>/i.test(str)
}

/** True when two ISO datetime strings fall on the same calendar day. */
export function isSameDay(a: string | null | undefined, b: string | null | undefined): boolean {
  return a?.split('T')[0] === b?.split('T')[0]
}

/**
 * Day/month parts (Europe/Zurich) for an event date badge. End parts are only
 * computed for multi-day events (single-day events leave them empty).
 */
export function getEventDateBadgeParts(
  startISO: string | null | undefined,
  endISO: string | null | undefined,
) {
  const startZh = toZurichDateString(startISO)
  const endZh = toZurichDateString(endISO)
  const isMultiDay = !!endZh && endZh !== startZh
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', day: 'numeric' })
  const monthFmt = new Intl.DateTimeFormat(currentLocale(), { timeZone: 'Europe/Zurich', month: 'short' })
  const startDay = dayFmt.format(new Date(startISO as string))
  const startMonth = monthFmt.format(new Date(startISO as string))
  const endDay = isMultiDay ? dayFmt.format(new Date(endISO as string)) : ''
  const endMonth = isMultiDay ? monthFmt.format(new Date(endISO as string)) : ''
  return { isMultiDay, startDay, startMonth, endDay, endMonth }
}

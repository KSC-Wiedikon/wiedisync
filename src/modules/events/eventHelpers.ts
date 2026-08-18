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

/**
 * Every guest tier, for `invite_guests: false`. Events ask one yes/no question
 * where a training picks tiers, so the roster modal's per-tier prop is fed the
 * whole ladder. Module-level constant, not an inline literal: a fresh array on
 * every render re-runs the modal's `excludedSet` memo each time.
 */
export const ALL_GUEST_LEVELS = [1, 2, 3]

/** Resolve a member ID string from a raw value or an events_members junction row. */
export function invitedMemberId(val: unknown): string {
  if (!val) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'number') return String(val)
  const obj = (val as { members_id?: unknown }).members_id ?? val
  return typeof obj === 'object' ? String((obj as { id?: unknown }).id ?? '') : String(obj ?? '')
}

/**
 * Is the current member shut out of this event by its `invite_guests` switch
 * (migration 324)?
 *
 * "Guest" here is `member_teams.guest_level > 0` — trains with the team, may not
 * play its league games. NOT `participations.guest_count` (+1s) and NOT the
 * public signup door.
 *
 * The question is asked per MEMBER, not per roster row, and mirrors the
 * `assertGuestMayRsvp` event branch in kscw-hooks — keep the two in step:
 *  - `invite_guests` unset or true → nobody is excluded (the default).
 *  - Not on any invited team → came in by role, direct invite, or the event is
 *    club-wide. Not a roster question, so never excluded.
 *  - Core (`guest_level = 0`) on at least one invited team → invited.
 *  - Personally invited via `events_members` → invited; a named invite outranks
 *    the team-level switch.
 *  - Guest on every invited team they belong to → excluded.
 */
export function isGuestExcludedFromEvent(
  event: { invite_guests?: boolean; teams?: unknown[] | null; invited_members?: unknown[] | null },
  ctx: { memberId?: string | number | null; memberTeamIds: string[]; getGuestLevel: (teamId: string) => number },
): boolean {
  if (event.invite_guests !== false) return false
  const myInvitedTeams = (event.teams ?? [])
    .map((t) => teamId(t))
    .filter((id) => id && ctx.memberTeamIds.includes(id))
  if (myInvitedTeams.length === 0) return false
  if (myInvitedTeams.some((id) => ctx.getGuestLevel(id) === 0)) return false
  if (ctx.memberId != null) {
    const invited = (event.invited_members ?? []).map((m) => invitedMemberId(m))
    if (invited.includes(String(ctx.memberId))) return false
  }
  return true
}

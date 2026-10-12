// directus/extensions/kscw-endpoints/src/sport-scope.js
//
// Server-side sport confinement for the custom endpoints (security finding M7,
// owner decision 2026-10-12: "sport data only").
//
// A caller whose `members.role` makes them sport-confined (exactly one of
// vb_admin / bb_admin and neither admin nor superuser — which, since migrations
// 402/403, also covers every board member below full admin) may act on SPORT
// DATA — members, rosters, games, trainings, events, registrations, per-member
// rows — only inside their own section. Board work (finance, forms,
// announcements, households, audit log, scheduling, news, sponsors, halls)
// stays club-wide and never calls in here.
//
// ⚠ The RULE is not here. It lives in member-sport.js (`sportAdminScope`,
// `sportScopeAllows`, `sportFromParts`, `resolveMemberSports`) and this file only
// adapts it to what a route holds — a role blob, a list of team ids, a list of
// member ids — so that no route grows its own copy of "which sport is this".
// Anything unknowable resolves to 'both' and is ALLOWED, for the reason in that
// file's header.

import { resolveMemberSports, sportAdminScope, sportFromParts, sportScopeAllows } from './member-sport.js'

/** `members.role` (JSON text, array, or junk) → string[]. */
export function parseRoles(raw) {
  if (Array.isArray(raw)) return raw.map(String)
  if (!raw) return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/**
 * The section a caller is confined to, or null when unconfined. A Directus
 * admin_access session is never confined; everything else is member-sport.js's
 * `sportAdminScope` — so a full admin, a dual sport admin and a non-admin all
 * answer null, and callers must still decide separately whether the caller is
 * staff at all.
 *
 * @returns {'volleyball'|'basketball'|null}
 */
export function callerSportScope(roles, { directusAdmin = false } = {}) {
  if (directusAdmin) return null
  return sportAdminScope(parseRoles(roles))
}

/**
 * One answer for a set of raw `teams.sport` values: a single sport, or 'both'
 * when there are none (a club-wide event), they are mixed, or they are unset.
 */
export function sportOfTeams(teamSports) {
  return sportFromParts({ teamSports: teamSports || [] })
}

/** A registration's sport, from its membership_type. Passive / unset → 'both'. */
export function registrationSport(membershipType) {
  return membershipType === 'volleyball' || membershipType === 'basketball' ? membershipType : 'both'
}

const uniqueIds = (ids) => [...new Set((ids || []).filter((v) => v !== null && v !== undefined && v !== ''))]

/** May `scope` act on something attached to these teams? No teams ⇒ 'both' ⇒ yes. */
export async function scopeAllowsTeams(db, scope, teamIds) {
  if (!scope) return true
  const ids = uniqueIds(teamIds)
  if (ids.length === 0) return true
  const rows = await db('teams').whereIn('id', ids).select('sport')
  return sportScopeAllows(scope, sportOfTeams(rows.map((r) => r.sport)))
}

/** May `scope` see each of these members? Answers a Set of String(id) that pass. */
export async function membersInScope(db, scope, memberIds) {
  const ids = uniqueIds(memberIds)
  if (!scope) return new Set(ids.map(String))
  if (ids.length === 0) return new Set()
  const sports = await resolveMemberSports(db, ids)
  return new Set(ids.map(String).filter((id) => sportScopeAllows(scope, sports.get(id) ?? 'both')))
}

/** May `scope` act on this one member? */
export async function scopeAllowsMember(db, scope, memberId) {
  if (!scope) return true
  if (memberId === null || memberId === undefined) return true
  return (await membersInScope(db, scope, [memberId])).has(String(memberId))
}

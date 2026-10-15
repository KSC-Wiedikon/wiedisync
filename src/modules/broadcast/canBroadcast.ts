import type { BroadcastActivity } from './types'

/**
 * Minimal member shape used by `canBroadcast`. Mirrors the data already exposed
 * on `useAuth().user` + the team-scoped derived fields (`coachTeamIds`,
 * `teamResponsibleIds`).
 */
export interface MemberLike {
  id: number | string
  role?: string[] | null
  /** Team IDs the member coaches (mirror `useAuth().coachTeamIds`). */
  isCoachOf?: Array<number | string>
  /** Team IDs the member is responsible for (mirror `useAuth().teamResponsibleIds`). */
  isResponsibleOf?: Array<number | string>
}

export interface ActivityWithTeam extends BroadcastActivity {
  /** Owning team for game/training. Undefined for club-wide events. */
  teamId?: number | string
}

/**
 * Pure predicate — does this member have the right to send a broadcast for this activity?
 *
 * Mirrors the backend authorization in `POST /activities/:type/:id/broadcast`:
 *   - `admin` / `superuser` / `board`              → true for any activity
 *   - `vb_admin` (sport='volleyball') / `bb_admin` (sport='basketball') → true for matching sport
 *   - For game/training: coach or team-responsible of `activity.teamId` → true
 *   - For event: team-coach pathway DOES NOT apply (events are not team-scoped here)
 *   - Otherwise false (also false for null member or missing role array).
 */
export function canBroadcast(activity: ActivityWithTeam, member: MemberLike | null): boolean {
  if (!member || !Array.isArray(member.role)) return false
  const roles = member.role

  // Global admin pathways — work for any activity type.
  if (roles.includes('admin') || roles.includes('superuser') || roles.includes('board')) {
    return true
  }

  // Sport-admin pathway (only when activity has a known sport).
  if (activity.sport === 'volleyball' && roles.includes('vb_admin')) return true
  if (activity.sport === 'basketball' && roles.includes('bb_admin')) return true

  // Team-coach / team-responsible pathway — game/training only.
  if (activity.type === 'event') return false
  if (activity.teamId == null) return false

  const teamKey = String(activity.teamId)
  const isCoachIds = (member.isCoachOf ?? []).map(String)
  const isRespIds = (member.isResponsibleOf ?? []).map(String)
  return isCoachIds.includes(teamKey) || isRespIds.includes(teamKey)
}

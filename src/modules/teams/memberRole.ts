/**
 * Leadership-role helpers for a team roster (pure, no React).
 *
 * Live apart from `MemberRow.tsx` so that file only exports components —
 * react-refresh/only-export-components (Fast Refresh) requires a module to
 * export either components or non-components, not both.
 */

import { flattenMemberIds } from '../../utils/relations'
import type { Team } from '../../types'

export function getMemberRole(memberId: string | number, team?: Team | null): string | null {
  if (!team) return null
  const id = String(memberId)
  if (flattenMemberIds(team.coach).includes(id)) return 'coach'
  if (flattenMemberIds(team.captain).includes(id)) return 'captain'
  if (flattenMemberIds(team.team_responsible).includes(id)) return 'team_responsible'
  return null
}

export type StaffCode = 'C' | 'AC' | 'AC1' | 'AC2' | 'TR'

/**
 * Short code for a staff member, shown in the roster's # column where a player
 * has a jersey number. The team's Einsatzliste officials (volleyball team
 * settings) decide C / AC1 / AC2. A coach not named there is C while no head
 * coach is named, AC once one is; a team responsible is TR.
 */
export function getStaffCode(memberId: string | number, team?: Team | null): StaffCode | null {
  if (!team) return null
  const id = String(memberId)
  const officials = team.features_enabled?.nomination_officials ?? {}
  const named = (v: string | null | undefined) => v != null && v !== '' && String(v) === id
  if (named(officials.coach)) return 'C'
  if (named(officials.assistant_coach_1)) return 'AC1'
  if (named(officials.assistant_coach_2)) return 'AC2'
  if (flattenMemberIds(team.coach).includes(id)) return officials.coach ? 'AC' : 'C'
  if (flattenMemberIds(team.team_responsible).includes(id)) return 'TR'
  return null
}

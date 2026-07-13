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

import { useMemo } from 'react'
import { useCollection } from '../lib/query'
import { useMultiTeamMembers } from './useTeamMembers'
import type { Member } from '../types'
import { asObj, relId } from '../utils/relations'

export type PickerStaffRole = 'coach' | 'team_responsible'

type PickerMember = Pick<Member, 'id' | 'first_name' | 'last_name' | 'nickname' | 'kscw_membership_active'>

interface StaffLinkRow {
  members_id: PickerMember | string | number | null
}

const STAFF_FIELDS = [
  'members_id.id', 'members_id.first_name', 'members_id.last_name',
  'members_id.nickname', 'members_id.kscw_membership_active',
]

/**
 * Members a coach / team responsible may pick in a team-scoped form (absence,
 * weekly unavailability): the player roster of `teamIds` (`member_teams`, via
 * `useMultiTeamMembers`) UNION those teams' coaches + team responsibles.
 *
 * Staff never get a `member_teams` row, so a roster-only picker left a
 * staff-only coach unable to pick themselves (the default — their own id —
 * rendered as an empty select) or a co-coach. `useMultiTeamMembers` itself
 * stays players-only on purpose: roster views depend on that.
 *
 * Staff are read through single-level junction filters (`teams_id _in`) — never
 * a deep `members` filter, which trips the M2M-filter-vs-policy silent-empty
 * trap. Both junctions and the expanded member name fields are club-wide
 * readable for logged-in members.
 *
 * Returns active members only, sorted by last name, plus `staffRoleById` so a
 * caller can label staff entries ("(Coach)"). A member who is both coach and
 * team responsible is labelled coach.
 */
export function useTeamPickerMembers(teamIds: string[]) {
  const safeIds = teamIds.map((id) => relId(id)).filter(Boolean)
  const enabled = safeIds.length > 0
  const { members: playerRows } = useMultiTeamMembers(safeIds)
  const filter = enabled ? { teams_id: { _in: safeIds } } : { id: { _eq: -1 } }
  const { data: coachRows } = useCollection<StaffLinkRow>('teams_coaches', {
    filter,
    fields: STAFF_FIELDS,
    all: true,
    enabled,
  })
  const { data: trRows } = useCollection<StaffLinkRow>('teams_responsibles', {
    filter,
    fields: STAFF_FIELDS,
    all: true,
    enabled,
  })

  return useMemo(() => {
    const byId = new Map<string, Member>()
    const staffRoleById = new Map<string, PickerStaffRole>()
    for (const mt of playerRows) {
      const m = asObj<Member>(mt.member)
      if (m) byId.set(String(m.id), m)
    }
    const addStaff = (rows: StaffLinkRow[] | undefined, role: PickerStaffRole) => {
      if (!enabled) return
      for (const row of rows ?? []) {
        const m = asObj<PickerMember>(row.members_id)
        if (!m?.id) continue
        const id = String(m.id)
        if (!byId.has(id)) byId.set(id, m as Member)
        if (!staffRoleById.has(id)) staffRoleById.set(id, role)
      }
    }
    // Coaches first so a coach who is also TR is labelled coach.
    addStaff(coachRows, 'coach')
    addStaff(trRows, 'team_responsible')
    const members = [...byId.values()]
      .filter((m) => m.kscw_membership_active !== false)
      .sort((a, b) => (a.last_name ?? '').localeCompare(b.last_name ?? ''))
    return { members, staffRoleById }
  }, [playerRows, coachRows, trRows, enabled])
}

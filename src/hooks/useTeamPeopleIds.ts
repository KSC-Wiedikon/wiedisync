import { useMemo } from 'react'
import type { MemberTeam } from '../types'
import { useCollection } from '../lib/query'

/** One `teams_coaches` / `teams_responsibles` junction row. */
export interface StaffJunctionRow {
  members_id: string | number | null
  teams_id: string | number | null
}

/**
 * Team id → the member ids of everyone ON that team: the player roster
 * (`member_teams`) UNION its staff (`teams_coaches` + `teams_responsibles`).
 *
 * ⚠ This is the frontend mirror of `teamPeopleSql()` in
 * `kscw-endpoints/src/activity-roster-sql.js`, and it exists for the same
 * reason: coaches and team responsibles NEVER get a `member_teams` row (see the
 * member_teams role model), so any map built from that table alone silently
 * means "players only". In the duty pickers that meant a staff-only coach could
 * not be given — or take — their own team's Schreiber/Täfeler duty: the person
 * dropdown, scoped to the duty team, simply had no such option (surfaced
 * 2026-09-02 on D3, whose coach is not on its roster).
 *
 * Both junctions count as staff, exactly like `AuthProvider.coachTeamIds`,
 * which unions them too.
 */
export function buildTeamPeopleIds(
  memberTeams: MemberTeam[],
  staffRows: StaffJunctionRow[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  const add = (teamId: unknown, memberId: unknown) => {
    // Junction rows with a null FK shouldn't exist, but `String(null)` = "null"
    // would pollute the map with a phantom team.
    if (teamId == null || memberId == null) return
    const tid = String(teamId)
    let set = map.get(tid)
    if (!set) { set = new Set(); map.set(tid, set) }
    set.add(String(memberId))
  }
  for (const mt of memberTeams) add(mt.team, mt.member)
  for (const s of staffRows) add(s.teams_id, s.members_id)
  return map
}

/**
 * `buildTeamPeopleIds` with the two staff junctions fetched for you. Pass the
 * `member_teams` rows the caller already holds (every duty surface reads them
 * for `guest_level` anyway).
 *
 * The junctions are club-wide readable for every logged-in member (see
 * `MEMBER_READ_ALL` in setup-permissions.mjs), so no policy gate applies here.
 * They are fetched unfiltered: rows pointing at archived teams are harmless
 * because callers only ever look up ids of active teams.
 */
export function useTeamPeopleIds(memberTeams: MemberTeam[], enabled = true) {
  const { data: coachRows, isLoading: coachesLoading } = useCollection<StaffJunctionRow>('teams_coaches', {
    fields: ['members_id', 'teams_id'],
    all: true,
    enabled,
  })
  const { data: trRows, isLoading: trLoading } = useCollection<StaffJunctionRow>('teams_responsibles', {
    fields: ['members_id', 'teams_id'],
    all: true,
    enabled,
  })

  const teamPeopleIds = useMemo(
    () => buildTeamPeopleIds(memberTeams, [...(coachRows ?? []), ...(trRows ?? [])]),
    [memberTeams, coachRows, trRows],
  )

  return { teamPeopleIds, staffLoading: coachesLoading || trLoading }
}

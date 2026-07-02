import { fetchAllItems } from '../lib/api'
import type { Absence, Member, MemberTeam, Team } from '../types'
import { asObj, relId, flattenMemberIds } from '../utils/relations'

export type AbsenceWithMember = Absence & { member: Member | string }

/** A team (within the viewed scope) a member belongs to — used to label/group
 *  absences by team when more than one team is in view. */
export type MemberTeamRef = { id: string; name: string; sport?: 'volleyball' | 'basketball' }

export interface TeamAbsencesData {
  absences: AbsenceWithMember[]
  /** member id → expanded member record (for the "available" list). */
  memberMap: Record<string, Member>
  /** member id → teams (within scope) the member belongs to. */
  memberTeams: Record<string, MemberTeamRef[]>
}

/**
 * Fetch the absences (+ member/team context) for a set of teams over a window.
 *
 * Pure data-fetch shared by the `useTeamAbsences` hook (calendar / day modal)
 * and the game-schedule export, so the absent players shown in the export are
 * exactly the ones the calendar shows. Membership is gathered from
 * `member_teams` PLUS each team's coaches / responsibles — the latter MUST be
 * read via `coach.members_id` / `team_responsible.members_id`, since the bare
 * M2M aliases are junction-row IDs, not member IDs (ghost-roster bug, 2026-05-12).
 */
export async function fetchTeamAbsences(
  teamIds: string[],
  startDate: string,
  endDate: string,
): Promise<TeamAbsencesData> {
  if (teamIds.length === 0) return { absences: [], memberMap: {}, memberTeams: {} }

  // Players from member_teams. Expand team name/sport so absences can be
  // labelled/grouped by team in multi-team views.
  const memberTeamRows = await fetchAllItems<MemberTeam>('member_teams', {
    filter: { team: { _in: teamIds } },
    fields: ['member', 'team.id', 'team.name', 'team.sport'],
  })
  const memberIdSet = new Set(memberTeamRows.map((mt) => mt.member))

  // member id → its teams within scope (deduped by team id).
  const teamsByMember: Record<string, MemberTeamRef[]> = {}
  const addTeamRef = (memberId: string, ref: MemberTeamRef) => {
    if (!memberId || !ref.id) return
    const arr = (teamsByMember[memberId] ??= [])
    if (!arr.some((x) => x.id === ref.id)) arr.push(ref)
  }
  for (const mt of memberTeamRows) {
    const teamObj = asObj<Team>(mt.team)
    addTeamRef(String(relId(mt.member)), {
      id: String(relId(mt.team)),
      name: teamObj?.name ?? '',
      sport: teamObj?.sport,
    })
  }

  // Coaches + team responsibles may have no member_teams record. CRITICAL: must
  // request `coach.members_id` + `team_responsible.members_id` — without the
  // expansion Directus returns the M2M junction row IDs (teams_coaches.id) which
  // look like member IDs but aren't (ghost roster bug, 2026-05-12).
  const validTeamIds = teamIds.filter((id) => id != null && id !== '' && id !== 'null' && id !== 'undefined')
  if (validTeamIds.length > 0) {
    // Single batched fetch (was N serial fetchItem round-trips). Still expands
    // `coach.members_id` / `team_responsible.members_id` — bare M2M aliases are
    // junction-row IDs, not member IDs (ghost-roster bug, 2026-05-12).
    let teams: Record<string, unknown>[] = []
    try {
      teams = await fetchAllItems<Record<string, unknown>>('teams', {
        filter: { id: { _in: validTeamIds } },
        fields: ['id', 'name', 'sport', 'coach.members_id', 'team_responsible.members_id'],
      })
    } catch {
      // team batch fetch failed — continue without coach/TR expansion
    }
    for (const team of teams) {
      const teamRef: MemberTeamRef = {
        id: String(relId(team.id)),
        name: (team.name as string) ?? '',
        sport: team.sport as MemberTeamRef['sport'],
      }
      const coachIds = flattenMemberIds(team.coach)
      const trIds = flattenMemberIds(team.team_responsible)
      for (const id of [...coachIds, ...trIds]) {
        if (id) {
          memberIdSet.add(id)
          addTeamRef(String(id), teamRef)
        }
      }
    }
  }

  const memberIds = [...memberIdSet]
  if (memberIds.length === 0) return { absences: [], memberMap: {}, memberTeams: teamsByMember }

  const absences = await fetchAllItems<AbsenceWithMember>('absences', {
    filter: {
      _and: [
        { member: { _in: memberIds } },
        { end_date: { _gte: startDate } },
        { start_date: { _lte: endDate } },
      ],
    },
    fields: ['*', 'member.*'],
    sort: ['start_date'],
  })

  // Member map from the absence expands, then backfill any team member with no
  // absence row (so the calendar's "available" list is complete).
  const memberMap: Record<string, Member> = {}
  for (const a of absences) {
    const memberObj = asObj<Member>(a.member)
    if (memberObj) memberMap[memberObj.id] = memberObj
  }
  const knownIds = new Set(Object.keys(memberMap))
  const missingIds = memberIds.filter((id) => !knownIds.has(id))
  if (missingIds.length > 0) {
    const members = await fetchAllItems<Member>('members', { filter: { id: { _in: missingIds } } })
    for (const m of members) memberMap[m.id] = m
  }

  return { absences, memberMap, memberTeams: teamsByMember }
}

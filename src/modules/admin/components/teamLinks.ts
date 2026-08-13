// src/modules/admin/components/teamLinks.ts
//
// The three ways a member can be attached to a team, in one place.
//
//   player            → member_teams          (the roster; per season)
//   coach             → teams_coaches
//   team responsible  → teams_responsibles
//
// They are three separate junction collections because they are three separate
// facts. The same person can be a player on H2, coach of DU18 and the
// responsible contact for H3 at once, and — the part that has bitten this
// codebase before — coaching a team must NOT put somebody on its roster. A
// coach with a `member_teams` row shows up in the squad, in RSVP counts, in the
// scorer duty pool and in the ClubDesk player group as though they played.
//
// This module exists so the member detail and the bulk-edit modal write all
// three the same way — before it, only the roster was editable from a member
// and coach/TR were reachable only from a team. The grid's Teams view keeps its
// own team-centric add/remove (it asks "who staffs THIS team", the mirror
// question), and `ManageStaffModal` on the team page is the third surface; all
// three write the same rows.
//
// ⚠ Junction column names are NOT uniform and cannot be guessed:
// `member_teams` uses `member` / `team` (it is a real collection with its own
// columns — season, guest_level), while the two staff junctions were generated
// by the Directus M2M wizard and use `members_id` / `teams_id`. Reading them
// through the wrong pair returns undefined and silently writes an orphan row.

import type { CacheShape, MemberTeamRow, StaffRow } from './explorerHelpers'
import { buildMemberTeamsMap, buildStaffMap } from './explorerHelpers'
import { COACH_VIRTUAL_KEY, TEAMS_VIRTUAL_KEY, TR_VIRTUAL_KEY } from './memberFieldSchema'

export type TeamLinkKey =
  | typeof TEAMS_VIRTUAL_KEY
  | typeof COACH_VIRTUAL_KEY
  | typeof TR_VIRTUAL_KEY

/** A junction row reduced to what every caller needs: its PK and its team. */
export interface LinkRow {
  id: string
  team: string
}

export interface TeamLinkKind {
  key: TeamLinkKey
  collection: 'member_teams' | 'teams_coaches' | 'teams_responsibles'
  /** i18n key for the relation's name, in the `admin` namespace. */
  labelKey: string
  /** Team ids this member is linked to, from the explorer cache. */
  idsOf: (cache: CacheShape, memberId: string) => string[]
  /** This member's junction rows — needed to DELETE by primary key. */
  rowsOf: (cache: CacheShape, memberId: string) => LinkRow[]
  /**
   * The create payload. `season` is only meaningful for the roster; the two
   * staff junctions have no season column and ignore it.
   */
  createPayload: (memberId: string, teamId: string, season: string) => Record<string, unknown>
  /** Fold a freshly created row into the cache. */
  applyAdd: (
    prev: CacheShape,
    created: { id: string; member: string; team: string; season: string; guestLevel: number },
  ) => CacheShape
  /** Drop a deleted row from the cache. */
  applyRemove: (prev: CacheShape, rowId: string) => CacheShape
}

/**
 * ⚠ The roster is the only one of the three that is per SEASON, and the season
 * stamped on a new row must be the TARGET TEAM's own, never the wall clock. A
 * team belongs to exactly one season by construction; `getCurrentSeason()`
 * disagrees with it for all of May (the picker offers next season from 1 May)
 * and between the Jun-1 cutover and the manually-run rollover. A mis-stamped row
 * is then skipped by the rollover's clone and silently orphaned. Callers resolve
 * the season from the team and pass it in.
 */
const PLAYER: TeamLinkKind = {
  key: TEAMS_VIRTUAL_KEY,
  collection: 'member_teams',
  labelKey: 'explorerFieldPlayer',
  idsOf: (cache, memberId) => cache.memberTeams.get(memberId) ?? [],
  rowsOf: (cache, memberId) =>
    cache.memberTeamRows.filter((r) => r.member === memberId).map((r) => ({ id: r.id, team: r.team })),
  createPayload: (memberId, teamId, season) => ({ member: memberId, team: teamId, season }),
  applyAdd: (prev, created) => {
    const row: MemberTeamRow = {
      id: created.id,
      member: created.member,
      team: created.team,
      guest_level: created.guestLevel,
      season: created.season,
    }
    const memberTeamRows = [...prev.memberTeamRows, row]
    return { ...prev, memberTeamRows, memberTeams: buildMemberTeamsMap(memberTeamRows) }
  },
  applyRemove: (prev, rowId) => {
    const memberTeamRows = prev.memberTeamRows.filter((r) => r.id !== rowId)
    return { ...prev, memberTeamRows, memberTeams: buildMemberTeamsMap(memberTeamRows) }
  },
}

const COACH: TeamLinkKind = {
  key: COACH_VIRTUAL_KEY,
  collection: 'teams_coaches',
  labelKey: 'explorerFieldCoach',
  idsOf: (cache, memberId) => cache.memberCoachTeams.get(memberId) ?? [],
  rowsOf: (cache, memberId) =>
    cache.coachRows.filter((r) => r.member === memberId).map((r) => ({ id: r.id, team: r.team })),
  // ⚠ members_id / teams_id — the M2M wizard's names, not member / team.
  createPayload: (memberId, teamId) => ({ members_id: memberId, teams_id: teamId }),
  applyAdd: (prev, created) => {
    const row: StaffRow = { id: created.id, member: created.member, team: created.team }
    const coachRows = [...prev.coachRows, row]
    return { ...prev, coachRows, memberCoachTeams: buildStaffMap(coachRows) }
  },
  applyRemove: (prev, rowId) => {
    const coachRows = prev.coachRows.filter((r) => r.id !== rowId)
    return { ...prev, coachRows, memberCoachTeams: buildStaffMap(coachRows) }
  },
}

const TEAM_RESPONSIBLE: TeamLinkKind = {
  key: TR_VIRTUAL_KEY,
  collection: 'teams_responsibles',
  labelKey: 'explorerFieldTeamResponsible',
  idsOf: (cache, memberId) => cache.memberTrTeams.get(memberId) ?? [],
  rowsOf: (cache, memberId) =>
    cache.trRows.filter((r) => r.member === memberId).map((r) => ({ id: r.id, team: r.team })),
  createPayload: (memberId, teamId) => ({ members_id: memberId, teams_id: teamId }),
  applyAdd: (prev, created) => {
    const row: StaffRow = { id: created.id, member: created.member, team: created.team }
    const trRows = [...prev.trRows, row]
    return { ...prev, trRows, memberTrTeams: buildStaffMap(trRows) }
  },
  applyRemove: (prev, rowId) => {
    const trRows = prev.trRows.filter((r) => r.id !== rowId)
    return { ...prev, trRows, memberTrTeams: buildStaffMap(trRows) }
  },
}

export const TEAM_LINK_KINDS: Readonly<Record<TeamLinkKey, TeamLinkKind>> = Object.freeze({
  [TEAMS_VIRTUAL_KEY]: PLAYER,
  [COACH_VIRTUAL_KEY]: COACH,
  [TR_VIRTUAL_KEY]: TEAM_RESPONSIBLE,
})

/** In the order the member detail renders them. */
export const TEAM_LINK_KIND_LIST: readonly TeamLinkKind[] = [PLAYER, COACH, TEAM_RESPONSIBLE]

export function teamLinkKind(key: string): TeamLinkKind | undefined {
  return TEAM_LINK_KINDS[key as TeamLinkKey]
}

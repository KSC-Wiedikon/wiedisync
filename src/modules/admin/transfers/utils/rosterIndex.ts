/**
 * The roster indexes `/admin/transfers` derives from `teams` + `member_teams`:
 * which sports a member plays, which volleyball teams they play for, and who is
 * exempt because every one of those teams is a U20 team.
 *
 * Pure and React-free. ⚠ The two member-facing derivations here need OPPOSITE
 * scopes — `sportsByMember` is ALL-SEASON and `teamNamesByMember` is
 * CURRENT-SEASON only — which is why the `teams` query that feeds them is
 * deliberately unfiltered on `active` and the split is made here instead.
 */

import { NO_TRANSFER_VB_TEAM_NAMES, SPORT } from '../constants'
import { relId } from '../../../../utils/relations'
import type { MemberTeam, Team } from '../../../../types'

/**
 * The three team lookups plus the active-team id set, from ONE unfiltered
 * `teams` read.
 *
 * Sport membership is derived from the member's teams. Teams are fetched
 * WITHOUT the `active` filter on purpose: a player parked on an archived team
 * still plays that sport, and dropping them would silently hide a transfer.
 * `active` is selected but deliberately NOT filtered on: the two derivations
 * below need opposite scopes. Sport must survive an archived team (above);
 * the displayed team NAMES must not (`indexTeamNamesByMember`).
 *
 * ⚠ `activeTeamIds`: the rollover CLONES a team into a new id and archives the
 * old row, and the member's `member_teams` row on the archived team is never
 * deleted — so an unguarded junction read is the union of every season the
 * member ever played. That is what made 68 volleyball members render a strictly
 * larger team set than they hold (a player on D1 showing "D1, D2"; one on D2
 * showing "D1, D2, DU23-1"). Gate on `teams.active`, never on
 * `member_teams.season`.
 */
export function indexTeams(teams: readonly Team[]): {
  teamIds: string[]
  sportByTeam: Map<string, Team['sport']>
  nameByTeam: Map<string, string>
  activeTeamIds: Set<string>
} {
  const teamIds: string[] = []
  const sportByTeam = new Map<string, Team['sport']>()
  const nameByTeam = new Map<string, string>()
  const activeTeamIds = new Set<string>()
  for (const tm of teams) {
    const id = String(tm.id)
    teamIds.push(id)
    sportByTeam.set(id, tm.sport)
    nameByTeam.set(id, tm.name ?? '')
    if (tm.active) activeTeamIds.add(id)
  }
  return { teamIds, sportByTeam, nameByTeam, activeTeamIds }
}

/**
 * memberId → the sports they play, from their team memberships.
 *
 * ⚠ GUESTS ARE EXCLUDED. A `member_teams` row with `guest_level > 0` is
 * somebody who trains with a team without being licensed by the club — they
 * hold no Swiss Volley / Swiss Basketball licence at all, so there is no
 * eligibility to establish, nothing to look up in VIS and no transfer anyone
 * owes. Leaving them in put people on a worklist that could never be worked.
 * Same rule the scorer assignment already applies to duty eligibility
 * (`buildScorerTeams` in AssignmentAlgorithm.ts).
 *
 * Guest memberships are kept in a SECOND map rather than discarded, so a
 * member dropped for being guest-only can be reported in the header instead of
 * silently vanishing — and so a member who is a full player on one team and a
 * guest on another still counts as a player.
 *
 * ⚠ ALL-SEASON on purpose (no `activeTeamIds` gate here) — see `indexTeams`.
 */
export function indexSportsByMember(
  junction: readonly MemberTeam[],
  sportByTeam: ReadonlyMap<string, Team['sport']>,
): {
  sportsByMember: Map<string, Set<Team['sport']>>
  guestSportsByMember: Map<string, Set<Team['sport']>>
} {
  const players = new Map<string, Set<Team['sport']>>()
  const guests = new Map<string, Set<Team['sport']>>()
  for (const j of junction) {
    const memberId = relId(j.member)
    const teamSport = sportByTeam.get(relId(j.team))
    if (!memberId || (teamSport !== 'volleyball' && teamSport !== 'basketball')) continue
    const target = (j.guest_level ?? 0) > 0 ? guests : players
    const set = target.get(memberId)
    if (set) set.add(teamSport)
    else target.set(memberId, new Set([teamSport]))
  }
  return { sportsByMember: players, guestSportsByMember: guests }
}

/**
 * memberId → their VOLLEYBALL PLAYER team names, for the member cell. Same
 * guest exclusion as `indexSportsByMember` (a guest membership is not the row's
 * reason to be on this page), and volleyball-scoped like the page itself: a
 * dual-sport member shows the teams the transfer in front of the admin is
 * about, not their basketball ones.
 *
 * Also the input to the U20 exemption below, which is why the "player, in
 * this sport" filtering lives in one place rather than two.
 *
 * ⚠ CURRENT-season only (`activeTeamIds`) — unlike `indexSportsByMember` above,
 * which is deliberately all-season. A member with no active volleyball team
 * therefore gets no names, and so is NOT U20-exempt below: the safe default
 * on a transfer worklist is to leave someone on it.
 */
export function indexTeamNamesByMember(
  junction: readonly MemberTeam[],
  sportByTeam: ReadonlyMap<string, Team['sport']>,
  nameByTeam: ReadonlyMap<string, string>,
  activeTeamIds: ReadonlySet<string>,
): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const j of junction) {
    const memberId = relId(j.member)
    const teamId = relId(j.team)
    if (!memberId || (j.guest_level ?? 0) > 0) continue
    if (!activeTeamIds.has(teamId)) continue
    if (sportByTeam.get(teamId) !== SPORT) continue
    const name = nameByTeam.get(teamId)
    if (!name) continue
    const list = map.get(memberId)
    if (list) { if (!list.includes(name)) list.push(name) }
    else map.set(memberId, [name])
  }
  for (const list of map.values()) list.sort((a, b) => a.localeCompare(b, 'de-CH'))
  return map
}

/**
 * Members exempt because EVERY volleyball team they play for is a U20 team —
 * see `NO_TRANSFER_VB_TEAM_NAMES`. Built from `indexTeamNamesByMember`, so it
 * inherits the same player-only, volleyball-only scope.
 *
 * ⚠ The exemption is per TEAM, not per person — which is what the `every` is
 * for: an HU20 player who also plays 2. Liga still needs the transfer for that
 * licence, so it only fires when EVERY volleyball team the member plays for is
 * on the list.
 *
 * A member whose team has no name at all is deliberately NOT exempt: the
 * absence of a name is not evidence of a junior team, and the safe default
 * here is to leave someone ON the worklist.
 */
export function u20OnlyMemberIds(
  teamNamesByMember: ReadonlyMap<string, string[]>,
): Set<string> {
  const set = new Set<string>()
  for (const [memberId, names] of teamNamesByMember) {
    if (names.length > 0 && names.every((n) => NO_TRANSFER_VB_TEAM_NAMES.has(n.trim()))) {
      set.add(memberId)
    }
  }
  return set
}

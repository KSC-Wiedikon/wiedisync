/**
 * How many HOME games does a basketball team need this season?
 *
 * User rule 2026-08-05: *"for games offered assume it's one game home, one game away"* — a
 * Hin- und Rückrunde. Each opponent in the final group is played twice, once at KWI and once
 * away, so **home games = (teams in the group) − 1**.
 *
 * This is the demand side of the slot planner: the generator says how many dates we *can*
 * offer, this says how many we *must* fill. The comparison is what tells the section whether
 * 10 Spielsamstage (11 in a crisis) are enough.
 *
 * ⚠ Deliberately returns `null` rather than a guess whenever the group is not final. Half of
 * `BB_GROUPS` holds the whole league as a provisional superset — `size − 1` there would claim
 * 48 home games for MU10 — and the Turnier formats do not play home-and-away at all. Lions D1
 * and Herren 1 file with ProBasket by 17.08.2026, so an invented number is worse than a blank.
 *
 * The per-group classification and its evidence live in `../data/bbGroupFormat.json`, shared
 * verbatim with the dry-run Excel exporter so the app and the sheet sent to the BB section can
 * never disagree.
 */
import { BB_GROUPS, KSCW_TEAM_GROUP } from '../data/basketballGroups'
import groupFormat from '../data/bbGroupFormat.json'

export type BbGroupStatus = 'championship' | 'provisional' | 'tournament'

/** Why no home-game count is available. `no_group` = the team is in no known ProBasket group. */
export type BbHomeGamesReason = 'provisional' | 'tournament' | 'no_group'

export interface BbHomeGames {
  /** Home games under Hin+Rück, or null when the format does not allow a trustworthy figure. */
  count: number | null
  /** Present only when `count` is null. */
  reason: BbHomeGamesReason | null
  /** The BB_GROUPS key, for display/debugging. Null when the team maps to no group. */
  groupCode: string | null
  /** Teams in the group as extracted — shown next to the count so an error is visible, not silent. */
  groupSize: number | null
}

const VALID_STATUSES: readonly string[] = ['championship', 'provisional', 'tournament']
const RAW: Record<string, { status: string; note?: string }> = groupFormat.groups

/**
 * Narrowed at load rather than cast: a typo'd status in the JSON degrades to `provisional`
 * (blank + a reason) instead of being asserted into the union. The fail-safe direction — the
 * only value that emits a number is `championship`, and nothing can reach it by accident.
 */
function narrow(status: string): BbGroupStatus {
  return VALID_STATUSES.includes(status) ? (status as BbGroupStatus) : 'provisional'
}

/** The season format for a BB_GROUPS key. Unknown keys are treated as provisional, never as final. */
export function groupStatusOf(groupCode: string | null | undefined): BbGroupStatus {
  if (!groupCode) return 'provisional'
  const raw = RAW[groupCode]?.status
  return raw ? narrow(raw) : 'provisional'
}

/**
 * Home games for a KSCW team, keyed by `teams.bb_source_id` (the same key `KSCW_TEAM_GROUP`,
 * `opponentsFor` and `sexForGroup` use).
 */
export function homeGamesFor(bbSourceId: string | number | null | undefined): BbHomeGames {
  const code = bbSourceId != null ? KSCW_TEAM_GROUP[String(bbSourceId)] : undefined
  const group = code ? BB_GROUPS[code] : undefined
  if (!code || !group) return { count: null, reason: 'no_group', groupCode: code ?? null, groupSize: null }

  const groupSize = group.teams.length
  const status = groupStatusOf(code)
  if (status !== 'championship') {
    return { count: null, reason: status === 'tournament' ? 'tournament' : 'provisional', groupCode: code, groupSize }
  }

  // A one-team group would give 0; treat anything under two teams as unusable rather than as "no
  // home games", which would read as a legitimate answer.
  if (groupSize < 2) return { count: null, reason: 'provisional', groupCode: code, groupSize }

  return { count: groupSize - 1, reason: null, groupCode: code, groupSize }
}

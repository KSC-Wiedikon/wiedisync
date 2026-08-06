/**
 * How many HOME games does a basketball team need this season?
 *
 * **home games = the workbook's `Anzahl Spiele` ÷ 2.**
 *
 * ⚠⚠ NOT `(group size − 1)`. That was the first implementation and it was wrong: the
 * ProBasket workbook states the games per team outright and they do not follow from the group
 * size — D1LRA lists 8 teams but 18 Spiele (a double round would be 14), D2LRA 10 teams but
 * 16, DU14 Regional 11 teams but 6. The arithmetic put Lions D1 at 7 when the real figure is
 * **9**, on one of the two teams that file with ProBasket by 17.08.2026. Source and the full
 * numbers: `../data/bbGroupFormat.json`.
 *
 * The user's framing — *"for games offered assume it's one game home, one game away"* — still
 * holds; it is what makes the split a half. It just does not license deriving the total from
 * how many teams are listed.
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
  /** Home games = gamesTotal / 2, or null when the workbook states no game count. */
  count: number | null
  /** Present only when `count` is null. */
  reason: BbHomeGamesReason | null
  /** The BB_GROUPS key, for display/debugging. Null when the team maps to no group. */
  groupCode: string | null
  /** Teams listed in the group. Context only — the count is NEVER derived from it. */
  groupSize: number | null
  /** The workbook's `Anzahl Spiele` (games per team, home + away). Null when unstated. */
  gamesTotal: number | null
  /** True when gamesTotal is odd, so the home/away split cannot be exact (count is floored). */
  approximate: boolean
}

const VALID_STATUSES: readonly string[] = ['championship', 'provisional', 'tournament']
const RAW: Record<string, { status: string; note?: string; gamesTotal?: number; modus?: string }> =
  groupFormat.groups

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
  const blank = (reason: BbHomeGamesReason, groupSize: number | null): BbHomeGames => ({
    count: null, reason, groupCode: code ?? null, groupSize, gamesTotal: null, approximate: false,
  })
  if (!code || !group) return blank('no_group', null)

  const groupSize = group.teams.length
  const status = groupStatusOf(code)
  const total = RAW[code]?.gamesTotal

  // The count comes from the workbook's stated Anzahl Spiele and from nothing else. No games
  // figure → no answer, whatever the group size happens to be.
  if (status !== 'championship' || typeof total !== 'number' || !Number.isFinite(total) || total < 2) {
    return blank(status === 'tournament' ? 'tournament' : 'provisional', groupSize)
  }

  return {
    count: Math.floor(total / 2),
    reason: null,
    groupCode: code,
    groupSize,
    gamesTotal: total,
    approximate: total % 2 !== 0,
  }
}

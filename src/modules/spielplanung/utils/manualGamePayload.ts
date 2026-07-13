import type { ManualGameInput } from '../../../types'

/**
 * `ManualGameInput` plus the per-game Einsatzliste override. Kept local to the
 * payload builder so `ManualGameInput` (also fed by the CSV import flow, which
 * never sets an override) stays unchanged. null = inherit the team default.
 */
export type ManualGamePayloadInput = ManualGameInput & {
  auto_nomination_list?: boolean | null
}

/**
 * Map a ManualGameInput from the modal/import flow to the flat `games` row
 * payload Directus expects. Handles:
 *   - generating a unique game_id (`manual_<uuid>`)
 *   - setting source + status + nulling svrz_push_status
 *   - deriving home_team / away_team from the chosen team name + opponent
 *   - routing hall vs away_hall_json based on type
 *
 * The caller MUST pass `kscwTeamName` separately since `games.home_team` and
 * `games.away_team` are text columns, not relations.
 */
export function buildManualGamePayload(
  input: ManualGamePayloadInput,
  kscwTeamName: string,
  season: string,
): Record<string, unknown> {
  const gameId = `manual_${crypto.randomUUID()}`
  const isHome = input.type === 'home'
  const home_team = isHome ? kscwTeamName : input.opponent
  const away_team = isHome ? input.opponent : kscwTeamName

  return {
    game_id: gameId,
    home_team,
    away_team,
    kscw_team: input.kscw_team,
    hall: isHome ? (input.hall ?? null) : null,
    additional_halls: isHome ? (input.additional_halls ?? null) : null,
    away_hall_json: !isHome ? (input.away_hall_json ?? null) : null,
    date: input.date,
    time: input.time,
    league: input.league ?? '',
    round: input.round ?? '',
    season,
    type: input.type,
    status: 'scheduled' as const,
    source: 'manual' as const,
    svrz_push_status: null,
    home_score: 0,
    away_score: 0,
    duty_confirmed: false,
    auto_confirm_rsvp: input.auto_confirm_rsvp ?? null,
    auto_nomination_list: input.auto_nomination_list ?? null,
  }
}

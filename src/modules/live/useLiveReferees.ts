import { useQuery } from '@tanstack/react-query'
import { readItem, readItems } from '@directus/sdk'
import { client } from '@/lib/api'
import { toZurichDateString } from '../../utils/dateHelpers'
import { LIVE_STALE_MS } from './liveNow'
import { matchGameByTeams, refereeNames, type LiveGameCandidate } from './liveGame'
import type { Envelope } from './types'

const GAME_FIELDS = ['id', 'home_team', 'away_team', 'referees_json']

/**
 * The referees of the game on a live board, for the spectator page. `/live` is
 * public, so everything here is an anonymous read — `games.referees_json` is in
 * the public field list (setup-permissions.mjs → PUBLIC_GAME_FIELDS).
 *
 * Which game, in order:
 *  1. the row's own `game_id` (a `game-<id>` row: phone scoring, or the hall board
 *     mirroring a fixture it knows);
 *  2. for a board's own channel, the game row that board mirrors right now
 *     (`source: 'board:<channel>'`);
 *  3. today's game whose two teams are the board's two teams (the board names are
 *     typed in the hall, but they are usually the fixture's names).
 * Nothing found → no referees line. Read once per game, not on every point.
 */
export function useLiveReferees(envelope: Envelope | null): string[] {
  const match = envelope?.match ?? null
  const channel = envelope?.channel ?? ''
  const teamA = match?.team_a_name ?? ''
  const teamB = match?.team_b_name ?? ''
  const { data } = useQuery({
    queryKey: ['live-referees', channel, envelope?.gameId ?? null, teamA, teamB],
    enabled: !!match,
    staleTime: 10 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<string[]> => {
      let gameId = envelope?.gameId ?? null
      if (gameId == null) {
        const mirror = await client.request<Array<{ game_id: number | string | null; date_updated: string | null }>>(
          readItems('live_scores', {
            filter: { source: { _eq: `board:${channel}` } },
            fields: ['game_id', 'date_updated'],
            sort: ['-date_updated'],
            limit: 1,
          } as never),
        ).catch(() => [])
        const row = mirror?.[0]
        const fresh = row?.date_updated && Date.now() - new Date(row.date_updated).getTime() <= LIVE_STALE_MS
        if (row?.game_id != null && fresh) gameId = Number(row.game_id)
      }
      if (gameId != null && Number.isFinite(gameId)) {
        const game = await client.request<LiveGameCandidate>(
          readItem('games', gameId, { fields: GAME_FIELDS } as never),
        ).catch(() => null)
        return refereeNames(game?.referees_json)
      }
      if (!teamA || !teamB) return []
      const today = toZurichDateString(new Date())
      const games = await client.request<LiveGameCandidate[]>(
        readItems('games', {
          filter: { date: { _eq: today } },
          fields: GAME_FIELDS,
          limit: 50,
        } as never),
      ).catch(() => [])
      return refereeNames(matchGameByTeams(games ?? [], teamA, teamB)?.referees_json)
    },
  })
  return data ?? []
}

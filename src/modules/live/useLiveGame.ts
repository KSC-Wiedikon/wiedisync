import { useQuery } from '@tanstack/react-query'
import { readItem, readItems } from '@directus/sdk'
import { client } from '@/lib/api'
import { toZurichDateString } from '../../utils/dateHelpers'
import { LIVE_STALE_MS } from './liveNow'
import { matchGameByTeams, sameTeams, type LiveGameCandidate } from './liveGame'
import type { Envelope } from './types'

const GAME_FIELDS = ['id', 'date', 'time', 'home_team', 'away_team', 'referees_json']

/**
 * The game on a live board, for the spectator page: its referees and scheduled time.
 * `/live` is public, so everything here is an anonymous read — these fields are in
 * the public field list (setup-permissions.mjs → PUBLIC_GAME_FIELDS).
 *
 * Which game, in order:
 *  1. the row's own `game_id` (a `game-<id>` row: phone scoring, or the hall board
 *     mirroring a fixture it knows);
 *  2. for a board's own channel, the game row that board mirrors right now
 *     (`source: 'board:<channel>'`), but only if it holds these two teams: the row
 *     of the previous match stays fresh for a while after the next one is on the board;
 *  3. today's game whose two teams are the board's two teams (the board names are
 *     typed in the hall, but they are usually the fixture's names).
 * Nothing found → null. Read once per game, not on every point.
 */
export function useLiveGame(envelope: Envelope | null): LiveGameCandidate | null {
  const match = envelope?.match ?? null
  const channel = envelope?.channel ?? ''
  const teamA = match?.team_a_name ?? ''
  const teamB = match?.team_b_name ?? ''
  const { data } = useQuery({
    queryKey: ['live-game', channel, envelope?.gameId ?? null, teamA, teamB],
    enabled: !!match,
    staleTime: 10 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<LiveGameCandidate | null> => {
      let gameId = envelope?.gameId ?? null
      if (gameId == null) {
        const mirror = await client.request<Array<{ game_id: number | string | null; team_a_name: string | null; team_b_name: string | null; date_updated: string | null }>>(
          readItems('live_scores', {
            filter: { source: { _eq: `board:${channel}` } },
            fields: ['game_id', 'team_a_name', 'team_b_name', 'date_updated'],
            sort: ['-date_updated'],
            limit: 1,
          } as never),
        ).catch(() => [])
        const row = mirror?.[0]
        const fresh = row?.date_updated && Date.now() - new Date(row.date_updated).getTime() <= LIVE_STALE_MS
        if (row?.game_id != null && fresh && sameTeams(teamA, teamB, row.team_a_name, row.team_b_name)) gameId = Number(row.game_id)
      }
      if (gameId != null && Number.isFinite(gameId)) {
        return client.request<LiveGameCandidate>(
          readItem('games', gameId, { fields: GAME_FIELDS } as never),
        ).catch(() => null)
      }
      if (!teamA || !teamB) return null
      const today = toZurichDateString(new Date())
      const games = await client.request<LiveGameCandidate[]>(
        readItems('games', {
          filter: { date: { _eq: today } },
          fields: GAME_FIELDS,
          limit: 50,
        } as never),
      ).catch(() => [])
      return matchGameByTeams(games ?? [], teamA, teamB)
    },
  })
  return data ?? null
}

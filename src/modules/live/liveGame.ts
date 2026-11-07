// Pure halves of useLiveGame — which fixture a live board shows, and whether it has
// started. Kept out of the hook so vitest's node environment can test them without the
// API client.

import { toZurichDateString } from '../../utils/dateHelpers'
import { LIVE_STALE_MS, writtenMs } from './liveNow'
import type { Envelope } from './types'

export interface LiveGameCandidate {
  id: number | string
  date?: string | null
  time?: string | null
  home_team: string | null
  away_team: string | null
  referees_json?: Array<{ name?: string | null }> | string | null
}

/** "KSC WIEDIKON D1" ≡ "KSC Wiedikon D1", "Rämi" ≡ "Rami" — board names are typed by hand. */
export function normaliseTeamName(name: string | null | undefined): string {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** The same two teams, in either order (the board's left side is not always the home team). */
export function sameTeams(a1: string | null | undefined, b1: string | null | undefined, a2: string | null | undefined, b2: string | null | undefined): boolean {
  const x1 = normaliseTeamName(a1)
  const y1 = normaliseTeamName(b1)
  const x2 = normaliseTeamName(a2)
  const y2 = normaliseTeamName(b2)
  if (!x1 || !y1) return false
  return (x1 === x2 && y1 === y2) || (x1 === y2 && y1 === x2)
}

/**
 * The game whose two teams are the board's two teams. Null unless exactly one game
 * matches — a guess between two fixtures would put the wrong referees on the page.
 */
export function matchGameByTeams<T extends LiveGameCandidate>(games: readonly T[], teamA: string, teamB: string): T | null {
  const hits = games.filter((g) => sameTeams(teamA, teamB, g.home_team, g.away_team))
  return hits.length === 1 ? hits[0] : null
}

/**
 * A match set up on the board but not started. The board has no warm-up state of its
 * own: from the moment the names go up it publishes 'live', and setup, warm-up and
 * "warm-up finished" all read the same, nothing played yet. The first point (or a
 * timeout) ends it. A row left like that from another day is not "next" any more; a row
 * can sit unchanged through a whole warm-up, so it is the day that counts, not
 * LIVE_STALE_MS.
 */
export function isUpNext(envelope: Envelope | null, now = new Date()): boolean {
  const m = envelope?.match
  if (!m || envelope?.status !== 'live') return false
  const played = m.points_a || m.points_b || m.sets_won_a || m.sets_won_b
    || m.timeouts_a || m.timeouts_b || m.subs_a || m.subs_b || m.fouls_a || m.fouls_b
    || m.set_results.length
  if (played) return false
  return !!envelope.updatedAt && toZurichDateString(new Date(envelope.updatedAt)) === toZurichDateString(now)
}

/**
 * When a match left 'live' stopped being written, or null while it is still being written.
 * Board switched off, no uplink, or a game row the board has moved on from: the page must not
 * keep calling that score live. Nothing played is isUpNext's case: a warm-up writes nothing.
 */
export function staleSince(envelope: Envelope | null, now = new Date()): number | null {
  if (!envelope?.match || envelope.status !== 'live' || isUpNext(envelope, now)) return null
  const at = writtenMs({ date_updated: envelope.updatedAt, ts: envelope.ts })
  return Number.isFinite(at) && now.getTime() - at > LIVE_STALE_MS ? at : null
}

/** "16:00" for a game today, else null: "(scheduled: 16:00)" says today. */
export function scheduledTimeToday(game: LiveGameCandidate | null | undefined, now = new Date()): string | null {
  if (!game?.time || game.date !== toZurichDateString(now)) return null
  return game.time.slice(0, 5)
}

/** `referees_json` ({name, id}[], filled by the Swiss Volley sync) → the names, in order. */
export function refereeNames(raw: LiveGameCandidate['referees_json']): string[] {
  let list: unknown = raw
  if (typeof list === 'string') {
    try { list = JSON.parse(list) } catch { return [] }
  }
  if (!Array.isArray(list)) return []
  return list
    .map((r) => (r && typeof r === 'object' ? String((r as { name?: unknown }).name ?? '').trim() : ''))
    .filter(Boolean)
}

// Pure halves of useLiveNow — which live row the banner and the nav advertise. Kept out of
// the hook so vitest's node environment can test it without the API client.

import type { LiveScoreRow } from './types'

/** A row nobody wrote for this long is a match left 'live' (board switched off, phone gone). */
export const LIVE_STALE_MS = 20 * 60 * 1000

/** A match set up longer ago than this and never started is not coming: a board left on, a phone gone. */
export const NEVER_STARTED_MS = 3 * 60 * 60 * 1000

export type NowRow = Pick<LiveScoreRow, 'channel' | 'status' | 'sport' | 'team_a_short' | 'team_b_short' | 'points_a' | 'points_b' | 'date_updated' | 'source'> & { ts?: LiveScoreRow['ts']; set_results?: LiveScoreRow['set_results'] }

/**
 * When the row was last written. Directus only stamps `date_updated` on an update, so a row
 * that was created and never written again has none: its `ts` (the writer's clock) says it.
 * Read as "just now", the board's one stray point kept a game row live all evening.
 */
export const writtenMs = (r: { date_updated?: string | null; ts?: LiveScoreRow['ts'] }) => {
  if (r.date_updated) return new Date(r.date_updated).getTime()
  const ts = Number(r.ts)
  return r.ts != null && Number.isFinite(ts) && ts > 0 ? ts : NaN
}

const setsOf = (r: { set_results?: unknown }) => (Array.isArray(r.set_results) ? r.set_results.length : 0)

/**
 * A row that says 'live' but is not a match: the board tapped after a game ended (a set count with
 * no set behind it, 07.11: 0:0, sets 0:1, for nobody), or set up hours ago and never started. It
 * reads as no match at all, so a match that is over stays over until a new one begins. A warm-up
 * still counts: it writes nothing for an hour, so it is the 3 hours that end it, not LIVE_STALE_MS.
 */
export function isLeftoverRow(r: Partial<LiveScoreRow>, now = Date.now()): boolean {
  if (r.status !== 'live') return false
  const n = (k: keyof LiveScoreRow) => Number(r[k]) || 0
  const played = n('points_a') || n('points_b') || n('timeouts_a') || n('timeouts_b') || n('subs_a') || n('subs_b') || n('fouls_a') || n('fouls_b') || setsOf(r)
  if (played) return false
  if (n('sets_won_a') || n('sets_won_b')) return true
  const at = writtenMs(r)
  return Number.isFinite(at) && now - at > NEVER_STARTED_MS
}

/**
 * The one live row to advertise, or null. Pure, for the tests.
 *  - 'final' is not live: a finished match sitting on the board all evening would
 *    otherwise keep advertising itself as something to watch.
 *  - Stale rows (LIVE_STALE_MS) are dropped. A row with no time at all is kept, as before.
 *  - Nothing to watch yet is not live: a set-up board or a warm-up, at 0:0 with no finished set.
 *  - A board that knows the fixture writes the same match twice — its own channel and the
 *    game's row with `source: 'board:<channel>'`. The board row is then dropped: the game
 *    row names the game and reads home/away.
 *  - Of what is left, the most recently written wins.
 */
export function pickLiveNow(rows: NowRow[] | null | undefined, now = Date.now()): NowRow | null {
  const live = (rows ?? []).filter((r) => {
    if (r.status !== 'live') return false
    if (!Number(r.points_a) && !Number(r.points_b) && !setsOf(r)) return false
    const at = writtenMs(r)
    return !Number.isFinite(at) || now - at <= LIVE_STALE_MS
  })
  const mirrored = new Set(
    live.map((r) => r.source ?? '').filter((s) => s.startsWith('board:')).map((s) => s.slice('board:'.length)),
  )
  const kept = live.filter((r) => !mirrored.has(r.channel))
  kept.sort((x, y) => (Number.isFinite(writtenMs(y)) ? writtenMs(y) : 0) - (Number.isFinite(writtenMs(x)) ? writtenMs(x) : 0))
  return kept[0] ?? null
}

/** `/live` for the hall board's own channel, `/live?channel=…` for any other. */
export function liveHref(channel: string): string {
  return !channel || channel === 'kscw' ? '/live' : `/live?channel=${encodeURIComponent(channel)}`
}

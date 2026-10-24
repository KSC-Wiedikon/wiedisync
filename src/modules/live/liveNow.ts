// Pure halves of useLiveNow — which live row the banner and the nav advertise. Kept out of
// the hook so vitest's node environment can test it without the API client.

import type { LiveScoreRow } from './types'

/** A row nobody wrote for this long is a match left 'live' (board switched off, phone gone). */
export const LIVE_STALE_MS = 20 * 60 * 1000

export type NowRow = Pick<LiveScoreRow, 'channel' | 'status' | 'sport' | 'team_a_short' | 'team_b_short' | 'points_a' | 'points_b' | 'date_updated' | 'source'>

const updatedMs = (r: NowRow) => (r.date_updated ? new Date(r.date_updated).getTime() : NaN)

/**
 * The one live row to advertise, or null. Pure, for the tests.
 *  - 'final' is not live: a finished match sitting on the board all evening would
 *    otherwise keep advertising itself as something to watch.
 *  - Stale rows (LIVE_STALE_MS) are dropped. A row without `date_updated` (written before
 *    Directus stamped it) is kept, as before.
 *  - A board that knows the fixture writes the same match twice — its own channel and the
 *    game's row with `source: 'board:<channel>'`. The board row is then dropped: the game
 *    row names the game and reads home/away.
 *  - Of what is left, the most recently written wins.
 */
export function pickLiveNow(rows: NowRow[] | null | undefined, now = Date.now()): NowRow | null {
  const live = (rows ?? []).filter((r) => {
    if (r.status !== 'live') return false
    const at = updatedMs(r)
    return !Number.isFinite(at) || now - at <= LIVE_STALE_MS
  })
  const mirrored = new Set(
    live.map((r) => r.source ?? '').filter((s) => s.startsWith('board:')).map((s) => s.slice('board:'.length)),
  )
  const kept = live.filter((r) => !mirrored.has(r.channel))
  kept.sort((x, y) => (Number.isFinite(updatedMs(y)) ? updatedMs(y) : 0) - (Number.isFinite(updatedMs(x)) ? updatedMs(x) : 0))
  return kept[0] ?? null
}

/** `/live` for the hall board's own channel, `/live?channel=…` for any other. */
export function liveHref(channel: string): string {
  return !channel || channel === 'kscw' ? '/live' : `/live?channel=${encodeURIComponent(channel)}`
}

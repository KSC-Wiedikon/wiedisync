import { useEffect, useState } from 'react'
import { readItems } from '@directus/sdk'
import { client } from '@/lib/api'
import { normaliseSport } from './scoreboard'
import { pickLiveNow, type NowRow } from './liveNow'
import type { LiveSport } from './types'

export { liveHref } from './liveNow'

/**
 * "Is a match being published live right now?" — for the discoverability banner and the
 * nav's Live item, which point people at /live from the pages they are already on.
 *
 * Every `live_scores` row counts, not only the hall board's `kscw`: a game scored from a
 * phone (`game-<id>`) is just as watchable. The link goes to that row's channel.
 *
 * Deliberately NOT the same thing as useLiveMatch:
 *  - it polls every 30s, not 3s. This answers a yes/no question that changes once or
 *    twice an evening; the 3s cadence is only justified on /live itself, where the score
 *    is the content.
 *  - it returns a headline, not a board, so nothing re-renders on every point.
 */
export interface LiveNow {
  live: boolean
  sport: LiveSport
  /** e.g. "KSCW 23 : 21 ZUL" — empty until the first read resolves. */
  headline: string
  /** The row's channel, for `/live?channel=…` ('kscw' = the hall board). */
  channel: string
}

const POLL_MS = 30_000
export function useLiveNow(): LiveNow {
  const [state, setState] = useState<LiveNow>({ live: false, sport: 'volleyball', headline: '', channel: 'kscw' })

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      try {
        const rows = await client.request<NowRow[]>(
          readItems('live_scores', {
            filter: { status: { _eq: 'live' } },
            // Only what the banner shows — not the whole board.
            fields: ['channel', 'status', 'sport', 'team_a_short', 'team_b_short', 'points_a', 'points_b', 'date_updated', 'source'],
            sort: ['-date_updated'],
            limit: 20,
          } as never),
        )
        if (cancelled) return
        const row = pickLiveNow(rows)
        if (!row) {
          setState((p) => (p.live ? { ...p, live: false } : p))
          return
        }
        const a = row.team_a_short || ''
        const b = row.team_b_short || ''
        setState({
          live: true,
          sport: normaliseSport(row.sport),
          headline: `${a} ${Number(row.points_a) || 0} : ${Number(row.points_b) || 0} ${b}`.trim(),
          channel: row.channel,
        })
      } catch {
        // Best-effort: a missing collection or a network blip just means no banner.
        if (!cancelled) setState((p) => (p.live ? { ...p, live: false } : p))
      }
    }

    void poll()
    const timer = setInterval(poll, POLL_MS)
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') void poll()
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearInterval(timer)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return state
}

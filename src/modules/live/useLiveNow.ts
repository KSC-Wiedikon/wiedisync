import { useEffect, useState } from 'react'
import { readItems } from '@directus/sdk'
import { client } from '@/lib/api'
import { normaliseSport } from './scoreboard'
import type { LiveScoreRow, LiveSport } from './types'

/**
 * "Is the hall scoreboard showing a match right now?" — for the discoverability
 * banner that points people at /live from the pages they are already on.
 *
 * Deliberately NOT the same thing as useLiveMatch:
 *  - it polls every 30s, not 3s. This answers a yes/no question that changes once
 *    or twice an evening; the 3s cadence is only justified on /live itself, where
 *    the score is the content.
 *  - it returns a headline, not a board, so nothing re-renders on every point.
 *
 * ⚠ It cannot say WHICH game is on the board: `live_scores` carries team short
 * codes, not a `games` foreign key, so there is no honest way to bind a row to a
 * fixture. The banner therefore says "a match is live", never "your game is live".
 */
export interface LiveNow {
  live: boolean
  sport: LiveSport
  /** e.g. "KSCW 23 : 21 ZUL" — empty until the first read resolves. */
  headline: string
}

const POLL_MS = 30_000

export function useLiveNow(channel = 'kscw'): LiveNow {
  const [state, setState] = useState<LiveNow>({ live: false, sport: 'volleyball', headline: '' })

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      try {
        const rows = await client.request<LiveScoreRow[]>(
          readItems('live_scores', {
            filter: { channel: { _eq: channel } },
            // Only what the banner shows — not the whole board.
            fields: ['status', 'sport', 'team_a_short', 'team_b_short', 'points_a', 'points_b'],
            limit: 1,
          } as never),
        )
        if (cancelled) return
        const row = rows?.[0]
        // 'final' is not "live": a finished match sitting on the board all evening
        // would otherwise keep advertising itself as something to watch.
        if (!row || row.status !== 'live') {
          setState((p) => (p.live ? { ...p, live: false } : p))
          return
        }
        const a = row.team_a_short || ''
        const b = row.team_b_short || ''
        setState({
          live: true,
          sport: normaliseSport(row.sport),
          headline: `${a} ${Number(row.points_a) || 0} : ${Number(row.points_b) || 0} ${b}`.trim(),
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
  }, [channel])

  return state
}

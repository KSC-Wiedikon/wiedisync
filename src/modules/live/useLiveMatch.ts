import { useCallback, useEffect, useRef, useState } from 'react'
import { readItems } from '@directus/sdk'
import { client } from '@/lib/api'
import { useRealtime } from '@/hooks/useRealtime'
import { normaliseSport } from './scoreboard'
import type { BoardState, Connection, Envelope, LiveScoreRow, LiveStatus } from './types'

/**
 * Live scoring reads a single Directus `live_scores` row (one per channel) that
 * the LedBox board keeps overwriting. See src/modules/live/DIRECTUS-SETUP.md.
 *
 * DEFAULT = ~3s polling; realtime is a progressive enhancement.
 *
 * Why poll is the baseline, not realtime: `/live` is a public spectator page and
 * most viewers are NOT logged in. Directus WebSocket subscriptions authenticate
 * with the session cookie (the shared client uses `authMode: 'handshake'`), so
 * for an anonymous viewer the socket has no token and `useRealtime` silently
 * no-ops (it bails on `!isAuthenticated()`). A public REST read works for
 * everyone with zero server config, and one tiny row every 3s is negligible.
 * When a logged-in member views the page (and Directus has WEBSOCKETS_ENABLED),
 * the realtime subscription below layers instant pushes on top of the poll.
 *
 * Both the REST origin (https://directus*.kscw.ch) and the WS origin
 * (wss://directus*.kscw.ch) are already in the CSP `connect-src` allowlist
 * (public/_headers) — no CSP change is needed for either transport.
 */
const POLL_MS = 3000

export interface LiveMatch {
  /** Latest normalised snapshot, or null before the first read resolves. */
  envelope: Envelope | null
  /** Read lifecycle, mapped onto the same union the SSE scaffold used. */
  connection: Connection
  /** ms epoch of the last snapshot the client applied (for "updated at HH:MM"). */
  lastReceivedAt: number | null
}

/** Coerce a Directus value (bigInteger may arrive as a string) to a finite number. */
function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}

/** Map a raw `live_scores` row to the Envelope the UI renders. */
function rowToEnvelope(row: LiveScoreRow): Envelope {
  const status: LiveStatus = row.status ?? 'idle'
  // 'idle' => the board is blank / no match → the Live page shows its empty state.
  const match: BoardState | null =
    status === 'idle'
      ? null
      : {
          sport: normaliseSport(row.sport),
          side_a: 'left',
          team_a_name: row.team_a_name ?? '',
          team_a_short: row.team_a_short ?? '',
          team_a_color: row.team_a_color ?? '#2563eb',
          team_b_name: row.team_b_name ?? '',
          team_b_short: row.team_b_short ?? '',
          team_b_color: row.team_b_color ?? '#ef4444',
          points_a: num(row.points_a),
          points_b: num(row.points_b),
          sets_won_a: num(row.sets_won_a),
          sets_won_b: num(row.sets_won_b),
          timeouts_a: num(row.timeouts_a),
          timeouts_b: num(row.timeouts_b),
          subs_a: num(row.subs_a),
          subs_b: num(row.subs_b),
          fouls_a: num(row.fouls_a),
          fouls_b: num(row.fouls_b),
          period: num(row.period),
          over: row.over === true,
          serving_team: row.serving_team ?? null,
          set_results: Array.isArray(row.set_results)
            ? row.set_results.map((r) => ({ a: num(r.a), b: num(r.b) }))
            : [],
        }
  const seq = num(row.ts)
  const ts = seq || (row.date_updated ? Date.parse(row.date_updated) : 0) || Date.now()
  return { v: 1, channel: row.channel, status, seq, event: row.event ?? null, ts, match }
}

/**
 * Subscribe to a live-scoring channel via the wiedisync Directus client.
 *
 * Keeps the exact `{ envelope, connection, lastReceivedAt }` contract of the old
 * EventSource hook so LivePage + Scoreboard are unchanged.
 */
export function useLiveMatch(channel: string): LiveMatch {
  const [envelope, setEnvelope] = useState<Envelope | null>(null)
  const [connection, setConnection] = useState<Connection>('connecting')
  const [lastReceivedAt, setLastReceivedAt] = useState<number | null>(null)

  // Highest board `ts` applied so far — drops an out-of-order frame (a slow poll
  // landing after a newer realtime push, or vice-versa). Reset on channel change.
  const lastTsRef = useRef(-1)
  // Whether we've ever reached Directus for this channel: distinguishes the
  // initial 'connecting' state from a mid-stream 'reconnecting' after a drop.
  const reachedRef = useRef(false)

  const apply = useCallback((row: LiveScoreRow) => {
    const env = rowToEnvelope(row)
    if (env.seq < lastTsRef.current) return // stale frame — a newer one already won
    lastTsRef.current = env.seq
    reachedRef.current = true
    setEnvelope(env)
    setLastReceivedAt(Date.now())
    setConnection('open')
  }, [])

  // ── Baseline: poll the row every POLL_MS (paused while the tab is hidden) ──
  useEffect(() => {
    // Reset the ordering/reach refs for this (possibly new) channel. Ref writes
    // only — NO synchronous setState in the effect body (react-hooks/
    // set-state-in-effect). The immediate poll below repaints: on a channel
    // switch its empty-branch channel-guard drops any stale envelope, and a
    // matching row is applied via `apply`.
    lastTsRef.current = -1
    reachedRef.current = false

    let cancelled = false

    const poll = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      try {
        const rows = await client.request<LiveScoreRow[]>(
          readItems('live_scores', {
            filter: { channel: { _eq: channel } },
            limit: 1,
          } as never),
        )
        if (cancelled) return
        const row = rows?.[0]
        if (row) {
          apply(row)
        } else {
          // Reached Directus, but no row exists for this channel yet → treat as
          // idle. Don't clobber an already-applied match with a transient empty.
          reachedRef.current = true
          setConnection('open')
          // Keep an already-applied match for THIS channel; otherwise (first read,
          // or a channel switch that left a stale envelope) show idle.
          setEnvelope((prev) =>
            prev && prev.channel === channel
              ? prev
              : { v: 1, channel, status: 'idle', seq: 0, event: null, ts: Date.now(), match: null },
          )
        }
      } catch {
        if (cancelled) return
        // Swallow — the collection/public-read may not be set up yet, or the
        // network blipped. Surface 'reconnecting' only once we'd been live; the
        // next tick retries. (No Sentry: this read is intentionally best-effort.)
        setConnection(reachedRef.current ? 'reconnecting' : 'connecting')
      }
    }

    void poll() // immediate first read — don't wait a full interval
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
  }, [channel, apply])

  // ── Enhancement: realtime pushes for logged-in members (no-op for anon) ──
  // useRealtime bails when unauthenticated and swallows socket failures, so this
  // is purely additive on top of the poll. It fires on create (first publish)
  // and update (every subsequent board change) of the live_scores row.
  useRealtime<LiveScoreRow>(
    'live_scores',
    (evt) => {
      if (evt.record?.channel === channel) apply(evt.record)
    },
    ['create', 'update'],
  )

  return { envelope, connection, lastReceivedAt }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import i18n from '../../i18n'
import { kscwApi } from '../../lib/api'
import { EMPTY_STATE, stateFromRow, type ScoreState } from './scoring'

/**
 * State + transport for phone live scoring (`/live/score/:gameId`).
 *
 * Taps apply LOCALLY first (a scorer in a hall with one bar of signal must never
 * wait for a round-trip to see the point land), then one writer loop publishes the
 * latest local state. Taps made while a write is in flight coalesce into the next
 * write — the row only ever needs the newest score, not every intermediate one.
 *
 * Every write carries the `ts` of the row it was built on; the endpoint refuses a
 * stale one (409) with the current row. Then the local state is REPLACED by the
 * server's and the scorer is told: a lost tap is visible and re-tappable, a second
 * phone's points silently rolled back are not.
 *
 * A 3 s poll keeps a second phone (and a scorer who reopens the page) in step. It
 * never overwrites while local taps are unpublished.
 */
const POLL_MS = 3000
const UNDO_MAX = 30

export interface GameSummary {
  id: string | number
  home_team: string | null
  away_team: string | null
  date: string | null
  time: string | null
  type: string | null
  league: string | null
}

interface ScoringResponse {
  can_score: boolean
  code: string | null
  channel: string
  game: GameSummary | null
  row: (Record<string, unknown> & { ts?: number | string | null }) | null
}

export type SyncState = 'loading' | 'synced' | 'saving' | 'offline'

export function useGameScoring(gameId: string | undefined) {
  const [state, setState] = useState<ScoreState>(EMPTY_STATE)
  const [meta, setMeta] = useState<Omit<ScoringResponse, 'row'> | null>(null)
  const [sync, setSync] = useState<SyncState>('loading')
  const [undoDepth, setUndoDepth] = useState(0)

  const stateRef = useRef<ScoreState>(EMPTY_STATE)
  const baseTs = useRef<number | null>(null)
  const dirty = useRef(false)
  const inFlight = useRef(false)
  const undo = useRef<ScoreState[]>([])

  const adopt = useCallback((row: ScoringResponse['row']) => {
    const next = stateFromRow(row)
    baseTs.current = row?.ts != null ? Number(row.ts) : null
    stateRef.current = next
    setState(next)
  }, [])

  // The writer loop re-enters itself for taps made while a write was in flight;
  // held in a ref so it can, without a self-referencing callback.
  const flushRef = useRef<() => Promise<void>>(async () => {})
  const flush = useCallback(async () => {
    if (!gameId || inFlight.current || !dirty.current) return
    inFlight.current = true
    dirty.current = false
    setSync('saving')
    const sent = stateRef.current
    let ok = false
    try {
      const res = await kscwApi<{ row: ScoringResponse['row'] }>(`/live-scoring/game/${gameId}`, {
        method: 'POST',
        body: { base_ts: baseTs.current, state: sent },
      })
      baseTs.current = res.row?.ts != null ? Number(res.row.ts) : baseTs.current
      ok = true
      setSync(dirty.current ? 'saving' : 'synced')
    } catch (err) {
      const e = err as { status?: number; code?: string; body?: { row?: ScoringResponse['row'] } }
      if (e.status === 409 && e.code === 'stale') {
        dirty.current = false
        undo.current = []
        setUndoDepth(0)
        adopt(e.body?.row ?? null)
        toast.warning(i18n.t('live:scoreChangedElsewhere'))
        setSync('synced')
      } else {
        // Keep the local score; the poll tick retries it.
        dirty.current = true
        setSync('offline')
      }
    } finally {
      inFlight.current = false
    }
    // Taps made while this write was in flight go out now, as one write.
    if (ok && dirty.current) void flushRef.current()
  }, [gameId, adopt])
  useEffect(() => { flushRef.current = flush }, [flush])

  /** Apply a rule (from ./scoring) to the current state and publish it. */
  const apply = useCallback((rule: (s: ScoreState) => ScoreState) => {
    const before = stateRef.current
    const next = rule(before)
    if (next === before) return
    undo.current = [...undo.current.slice(-(UNDO_MAX - 1)), before]
    setUndoDepth(undo.current.length)
    stateRef.current = next
    setState(next)
    dirty.current = true
    void flushRef.current()
  }, [])

  const undoLast = useCallback(() => {
    const prev = undo.current.pop()
    setUndoDepth(undo.current.length)
    if (!prev) return
    stateRef.current = prev
    setState(prev)
    dirty.current = true
    void flushRef.current()
  }, [])

  useEffect(() => {
    if (!gameId) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await kscwApi<ScoringResponse>(`/live-scoring/game/${gameId}`)
        if (cancelled) return
        const { row, ...rest } = res
        setMeta(rest)
        // Never overwrite taps that have not been published yet.
        if (!dirty.current && !inFlight.current) {
          const ts = row?.ts != null ? Number(row.ts) : null
          if (ts !== baseTs.current) adopt(row)
          setSync('synced')
        }
      } catch {
        if (!cancelled) setSync((s) => (s === 'loading' ? 'loading' : 'offline'))
      }
    }
    void load()
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (dirty.current && !inFlight.current) void flushRef.current()
      else void load()
    }, POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [gameId, adopt])

  return { state, meta, sync, apply, undoLast, canUndo: undoDepth > 0 }
}

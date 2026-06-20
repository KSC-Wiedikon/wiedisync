import { useCallback, useEffect, useRef, useState } from 'react'
import { kscwApi } from '../lib/api'

/**
 * Live progress for a manual "Sync now" action.
 *
 * Two modes:
 *  - **Async (background) syncs** — pass a `source` (the `sync_runs` key, e.g.
 *    `'svrz_sync'`). The trigger POST returns immediately (202); the real work
 *    runs for minutes in a detached/managed child. We poll `/admin/sync-status`
 *    until that source's `last_run_at` advances past the click, then read its
 *    `status` to resolve success/error. Mirrors the InfraHealthPage poll.
 *  - **Synchronous syncs** — omit `source`. The trigger promise itself resolves
 *    when the work is done, so we just await it (no polling).
 *
 * The phase drives the button UI: `running` → spinner + "Sync in progress…",
 * `success`/`error` → toast + refreshed counts via `onSuccess`.
 */
export type SyncPhase = 'idle' | 'running' | 'success' | 'error'

export interface SyncRun {
  source: string
  last_run_at: string | null
  status: 'ok' | 'error'
  rows_changed: number
  duration_ms: number
  error_message: string | null
}

interface UseSyncProgressOptions {
  /** `sync_runs` source key to poll for background syncs. Omit for synchronous endpoints. */
  source?: string
  /** Fire the trigger POST(s). For synchronous syncs, resolve with the result. */
  run: () => Promise<unknown>
  /** Run after success — refresh status/counts. `run` is the completed heartbeat (async mode). */
  onSuccess?: (info: { result?: unknown; run?: SyncRun }) => void | Promise<void>
  /** Run after error. */
  onError?: (message: string) => void
  /** Poll interval (async mode). Default 6s. */
  pollMs?: number
  /** Give up the spinner after this long (async mode) — the sync keeps running in the background. Default 240s. */
  maxPollMs?: number
}

export function useSyncProgress({
  source,
  run,
  onSuccess,
  onError,
  pollMs = 6_000,
  maxPollMs = 240_000,
}: UseSyncProgressOptions) {
  const [phase, setPhase] = useState<SyncPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const start = useCallback(async () => {
    if (phase === 'running') return
    setPhase('running')
    setError(null)
    const clickedAt = Date.now()

    let result: unknown
    try {
      result = await run()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!mountedRef.current) return
      setPhase('error')
      setError(msg)
      onError?.(msg)
      return
    }

    // Synchronous sync — the await already finished the work.
    if (!source) {
      if (!mountedRef.current) return
      setPhase('success')
      await onSuccess?.({ result })
      return
    }

    // Background sync — poll the heartbeat until it advances past the click.
    const deadline = clickedAt + maxPollMs
    const poll = async () => {
      let done: SyncRun | undefined
      try {
        const { runs } = await kscwApi<{ runs: SyncRun[] }>('/admin/sync-status')
        const r = (runs || []).find((x) => x.source === source)
        // 5s slack absorbs clock skew between the browser and the server heartbeat.
        if (r?.last_run_at && new Date(r.last_run_at).getTime() > clickedAt - 5_000) done = r
      } catch { /* transient — keep polling */ }

      if (!mountedRef.current) return
      if (done) {
        if (done.status === 'error') {
          setPhase('error')
          setError(done.error_message || 'Sync failed')
          onError?.(done.error_message || 'Sync failed')
        } else {
          setPhase('success')
          await onSuccess?.({ run: done })
        }
        return
      }
      if (Date.now() >= deadline) {
        // Still running in the background — release the spinner without claiming
        // failure; the heartbeat will reflect the outcome on the next view.
        setPhase('idle')
        await onSuccess?.({})
        return
      }
      timerRef.current = setTimeout(poll, pollMs)
    }
    timerRef.current = setTimeout(poll, pollMs)
  }, [phase, source, run, onSuccess, onError, pollMs, maxPollMs])

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setPhase('idle')
    setError(null)
  }, [])

  return { phase, error, start, reset, isRunning: phase === 'running' }
}

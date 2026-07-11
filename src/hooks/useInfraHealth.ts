import { useState, useEffect, useCallback, useMemo } from 'react'
import { API_URL, kscwApi } from '../lib/api'

export interface ServiceHealth {
  name: string
  status: 'ok' | 'error' | 'loading'
  latency?: number
}

export interface SyncStatus {
  source: string
  lastUpdated: string | null
  isStale: boolean
  /** 'error' when the last cron run actually errored (not just stale).
   *  Lets the status page distinguish "ran 4 hours ago but failed" from
   *  "hasn't run in 41 days". */
  hadError?: boolean
  /** True when the heartbeat row holds the migration-045 epoch seed
   *  (1970-01-01) — i.e. the cron is wired but hasn't fired since deploy.
   *  Suppresses the nonsensical "20583 d ago" label. */
  awaitingFirstRun?: boolean
}

export interface SyncRun {
  source: string
  last_run_at: string | null
  status: 'ok' | 'error'
  age_seconds: number | null
  error_message: string | null
  rows_changed?: number
  duration_ms?: number
}

export interface InfraHealth {
  services: ServiceHealth[]
  syncs: SyncStatus[]
  /** Raw sync_runs heartbeats keyed by source — lets callers render
   *  per-source cards / trigger buttons (e.g. the data-health refresh row). */
  runs: SyncRun[]
  isLoading: boolean
  refresh: () => void
}

const STALE_THRESHOLD_MS = 36 * 60 * 60 * 1000 // 36 hours

export function useInfraHealth(): InfraHealth {
  const [services, setServices] = useState<ServiceHealth[]>([])
  const [syncs, setSyncs] = useState<SyncStatus[]>([])
  const [runs, setRuns] = useState<SyncRun[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const checkHealth = useCallback(async () => {
    setIsLoading(true)
    try {
      // API health check — /server/ping, NOT /server/health: Directus 12.1
      // restricted /server/health to authenticated users (unauth now fails →
      // false "API down"). Ping is public on 11 and 12. May omit CORS headers,
      // so fall back to no-cors (opaque response = server reachable), matching
      // the pattern used by InfraHealthPage.checkEndpoint.
      const pbStart = Date.now()
      let pbHealth: ServiceHealth
      try {
        const r = await fetch(`${API_URL}/server/ping`, { mode: 'cors' })
        pbHealth = { name: 'Directus', status: r.ok ? 'ok' : 'error', latency: Date.now() - pbStart }
      } catch {
        try {
          const r = await fetch(`${API_URL}/server/ping`, { mode: 'no-cors' })
          pbHealth = {
            name: 'Directus',
            status: r.type === 'opaque' ? 'ok' : 'error',
            latency: Date.now() - pbStart,
          }
        } catch {
          pbHealth = { name: 'Directus', status: 'error' }
        }
      }

      setServices([pbHealth])

      // Sync freshness — pull cron last-run heartbeats from `sync_runs`
      // (migration 045) via the auth-required /admin/sync-status endpoint.
      // The previous implementation used `MAX(games.date_updated)` per
      // source as a proxy, which only bumped when a row actually changed —
      // a steady-state season made every sync look stale even when the cron
      // was firing nightly. Now we read the cron heartbeats directly.
      const syncChecks: SyncStatus[] = []
      try {
        const { runs } = await kscwApi<{ runs: SyncRun[] }>('/admin/sync-status')
        setRuns(runs)
        const byKey = new Map<string, SyncRun>(runs.map((r) => [r.source, r]))

        // Map our internal cron sources to the public /status row keys.
        // Swiss Volley aggregates two crons (sv_sync polls game data;
        // svrz_sync walks the scheduling/contacts API) — surface the most
        // recent run between them so a single failure doesn't flip the row
        // orange while the other is healthy.
        const pickLatest = (...keys: string[]): SyncRun | null => {
          const candidates = keys.map((k) => byKey.get(k)).filter(Boolean) as SyncRun[]
          if (candidates.length === 0) return null
          return candidates.reduce((best, cur) => {
            const a = best.last_run_at ? new Date(best.last_run_at).getTime() : 0
            const b = cur.last_run_at ? new Date(cur.last_run_at).getTime() : 0
            return b > a ? cur : best
          })
        }

        const swissVolley = pickLatest('sv_sync', 'svrz_sync')
        const basketplan = byKey.get('bp_sync') ?? null
        const gcal = byKey.get('gcal_sync') ?? null

        const toStatus = (source: string, run: SyncRun | null): SyncStatus => {
          if (!run || !run.last_run_at) return { source, lastUpdated: null, isStale: true }
          const runMs = new Date(run.last_run_at).getTime()
          // Migration 045 seeds 1970-01-01 so a freshly-deployed system shows
          // the row as stale immediately. Detect that and surface a friendlier
          // label instead of "20583 d ago".
          const awaitingFirstRun = runMs < new Date('2000-01-01').getTime()
          const ageMs = (run.age_seconds ?? 0) * 1000
          const isStale = ageMs > STALE_THRESHOLD_MS
          return {
            source,
            lastUpdated: run.last_run_at,
            isStale: isStale || run.status === 'error',
            hadError: run.status === 'error',
            awaitingFirstRun,
          }
        }

        syncChecks.push(toStatus('swiss_volley', swissVolley))
        syncChecks.push(toStatus('basketplan', basketplan))
        syncChecks.push(toStatus('gcal', gcal))
      } catch {
        // /admin/sync-status not deployed yet (transient on first migration
        // run) — render every source as stale rather than blank.
        setRuns([])
        syncChecks.push({ source: 'swiss_volley', lastUpdated: null, isStale: true })
        syncChecks.push({ source: 'basketplan', lastUpdated: null, isStale: true })
        syncChecks.push({ source: 'gcal', lastUpdated: null, isStale: true })
      }

      setSyncs(syncChecks)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { checkHealth() }, [checkHealth])

  return useMemo(
    () => ({ services, syncs, runs, isLoading, refresh: checkHealth }),
    [services, syncs, runs, isLoading, checkHealth],
  )
}

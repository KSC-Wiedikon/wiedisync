import { useState, useEffect, useRef } from 'react'
import { kscwApi } from '../../../lib/api'

/** One roster-sharing team that plays on a given date (blocking a home slot for
 *  the selected team). `affects` lists which selected team(s) it conflicts with. */
export interface CrossTeamConflict {
  teamId: number
  teamName: string
  affects: string[]
  matchup: string | null
  kind: 'game' | 'home' | 'away'
}

interface ConflictsResponse {
  conflicts: { date: string; items: CrossTeamConflict[] }[]
}

const EMPTY: Map<string, CrossTeamConflict[]> = new Map()

/**
 * Fetch the dates a roster-sharing team already plays for the given KSCW team(s),
 * keyed by date (yyyy-MM-dd). These are exactly the days the cross-team same-day
 * rule blocks a home slot on — surfaced on the calendar so a planner sees why a
 * date is unavailable. No-ops (empty map) on an empty id list.
 *
 * `result` is tagged with the key it was fetched for so `byDate` / `isLoading` are
 * derived (no synchronous setState in the effect); a latestKeyRef guard discards
 * out-of-order responses.
 */
export function useCrossTeamConflicts(teamIds: string[]): {
  byDate: Map<string, CrossTeamConflict[]>
  isLoading: boolean
} {
  const key = teamIds.join(',')
  const [result, setResult] = useState<{ key: string; byDate: Map<string, CrossTeamConflict[]> }>(
    { key: '', byDate: EMPTY },
  )
  const latestKeyRef = useRef<string>('')

  useEffect(() => {
    if (!key) return // empty → byDate derived empty below, no fetch
    latestKeyRef.current = key
    let cancelled = false
    kscwApi<ConflictsResponse>(`/terminplanung/admin/cross-team-conflicts?teams=${encodeURIComponent(key)}`)
      .then((resp) => {
        if (cancelled || latestKeyRef.current !== key) return
        const m = new Map<string, CrossTeamConflict[]>()
        for (const c of resp.conflicts ?? []) m.set(c.date, c.items)
        setResult({ key, byDate: m })
      })
      .catch(() => { if (!cancelled && latestKeyRef.current === key) setResult({ key, byDate: EMPTY }) })
    return () => { cancelled = true }
  }, [key])

  const byDate = result.key === key ? result.byDate : EMPTY
  const isLoading = key !== '' && result.key !== key
  return { byDate, isLoading }
}

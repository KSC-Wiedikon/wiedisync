import { useCallback, useEffect, useState } from 'react'
import { kscwApi } from '../../../lib/api'
import type { Derby, DerbiesResponse } from '../../../types'

export interface SaveDerbyLeg {
  svrz_id: string
  home_team_id: number
  date: string | null
}

export interface SaveDerbyArgs {
  team_a: number
  team_b: number
  legs: SaveDerbyLeg[]
  confirmed: boolean
}

// Intra-club derby anchoring (Art. 27 SVRZ). Detects KSCW team pairs sharing a
// league group from the synced SVRZ feed and lets the spielplaner fix the two
// head-to-head dates. The "external" opponent flow then clamps behind them.
export function useDerbies(seasonId: string | number | null | undefined) {
  const [derbies, setDerbies] = useState<Derby[]>([])
  const [boundary, setBoundary] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchDerbies = useCallback(async () => {
    if (!seasonId) return
    setIsLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ season: String(seasonId) })
      const resp = await kscwApi<DerbiesResponse>(`/admin/terminplanung/derbies?${qs}`)
      setDerbies(resp.derbies ?? [])
      setBoundary(resp.boundary ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }, [seasonId])

  // Load on mount and whenever the season changes. The call is made from an
  // effect-local async function (React's documented data-fetching shape) so the
  // effect body itself stays free of state updates.
  useEffect(() => {
    async function run() { await fetchDerbies() }
    void run()
  }, [fetchDerbies])

  const saveDerby = useCallback(
    async (args: SaveDerbyArgs) => {
      if (!seasonId) throw new Error('season required')
      const resp = await kscwApi<{ success: true; confirmed: boolean }>('/admin/terminplanung/derbies', {
        method: 'POST',
        body: { season: seasonId, ...args },
      })
      await fetchDerbies()
      return resp
    },
    [seasonId, fetchDerbies],
  )

  return { derbies, boundary, isLoading, error, saveDerby, refetch: fetchDerbies }
}

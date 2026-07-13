import { useState, useEffect, useCallback } from 'react'
import type { GameSchedulingSeason } from '../../../types'
import { createRecord, fetchAllItems, updateRecord } from '../../../lib/api'

export function useGameSchedulingSeason() {
  const [season, setSeason] = useState<GameSchedulingSeason | null>(null)
  const [allSeasons, setAllSeasons] = useState<GameSchedulingSeason[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // The fetch itself, without the `isLoading = true` flip. Split out so the
  // on-mount effect can call it directly: `isLoading` already starts true, so
  // the flip is a no-op there — only the refetch paths (below) need it.
  const loadSeasons = useCallback(async () => {
    try {
      const records = await fetchAllItems<GameSchedulingSeason>('game_scheduling_seasons', {
        sort: ['-date_created'],
      })
      setAllSeasons(records)
      // Auto-select the open one, or the most recent
      const open = records.find((s: GameSchedulingSeason) => s.status === 'open')
      setSeason(open || records[0] || null)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setIsLoading(false)
    }
  }, [])

  const fetchSeasons = useCallback(async () => {
    setIsLoading(true)
    await loadSeasons()
  }, [loadSeasons])

  useEffect(() => { void (async () => { await loadSeasons() })() }, [loadSeasons])

  const createSeason = useCallback(async (seasonName: string) => {
    const record = await createRecord<GameSchedulingSeason>('game_scheduling_seasons', {
      season: seasonName,
      status: 'setup',
      spielsamstage: [],
      team_slot_config: {},
      notes: '',
    })
    await fetchSeasons()
    return record
  }, [fetchSeasons])

  const updateSeason = useCallback(async (id: string, data: Partial<GameSchedulingSeason>) => {
    const record = await updateRecord<GameSchedulingSeason>('game_scheduling_seasons', id, data)
    await fetchSeasons()
    return record
  }, [fetchSeasons])

  return {
    season,
    allSeasons,
    isLoading,
    error,
    setSeason,
    createSeason,
    updateSeason,
    refetch: fetchSeasons,
  }
}

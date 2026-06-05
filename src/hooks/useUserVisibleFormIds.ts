import { useState, useEffect } from 'react'
import { fetchAllItems } from '../lib/api'
import { relId } from '../utils/relations'

interface Result {
  teamFormIds: string[]
  isLoading: boolean
  error: Error | null
}

/**
 * Resolve which team-scoped forms the current user can see, via team
 * membership, returned as a flat ID array. Frontend code then filters forms
 * with `{ id: { _in: [...] } }` instead of walking `forms.teams.teams_id` —
 * avoiding the deep-M2M-filter trap where the policy and the frontend both
 * traverse the same alias and Directus silently returns []. Mirrors
 * useUserVisibleEventIds (forms have no per-member invite junction).
 */
export function useUserVisibleFormIds(teamIds: string[], enabled = true): Result {
  const [teamFormIds, setTeamFormIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const teamKey = teamIds.map(String).filter(Boolean).sort().join(',')
  const key = `${enabled ? '1' : '0'}|${teamKey}`

  useEffect(() => {
    if (!enabled || teamIds.length === 0) {
      setTeamFormIds([])
      setIsLoading(false)
      return
    }
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const junctions = await fetchAllItems<{ forms_id: string | number }>('forms_teams', {
          filter: { teams_id: { _in: teamIds } },
          fields: ['forms_id'],
        })
        if (cancelled) return
        setTeamFormIds([...new Set(junctions.map(j => relId(j.forms_id)).filter(Boolean))])
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { teamFormIds, isLoading, error }
}

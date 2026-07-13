import { useEffect, useState } from 'react'
import { fetchAllItems } from '../../../lib/api'

export type TeamProfile = { id: string; name: string; picture: string | null }

/**
 * Batch-fetch team name + picture uuid for a set of team ids.
 * Returns a Map keyed by string id. Re-fetches when the set changes.
 *
 * Parallel to useMemberProfiles — used by ConversationList to show
 * team pictures for conversations with type='team'.
 */
export function useTeamProfiles(teamIds: Array<string | null | undefined>): Map<string, TeamProfile> {
  const [map, setMap] = useState<Map<string, TeamProfile>>(new Map())
  const ids = teamIds.filter((x): x is string => !!x)
  const key = ids.slice().sort().join(',')

  // Empty id set → empty map. React's adjust-state-during-render pattern; fires
  // on the same occasions the effect below used to (first render + every `key`
  // change), so the "clear" no longer cascades an extra render from the effect.
  const [prevKey, setPrevKey] = useState<string | null>(null)
  if (prevKey !== key) {
    setPrevKey(key)
    if (ids.length === 0) setMap(new Map())
  }

  useEffect(() => {
    if (ids.length === 0) return
    let alive = true
    ;(async () => {
      try {
        const rows = await fetchAllItems<{ id: string | number; name: string; team_picture: string | null }>(
          'teams',
          { filter: { id: { _in: ids } }, fields: ['id', 'name', 'team_picture'] },
        )
        if (!alive) return
        const m = new Map<string, TeamProfile>()
        for (const r of rows) {
          m.set(String(r.id), { id: String(r.id), name: r.name || String(r.id), picture: r.team_picture ?? null })
        }
        setMap(m)
      } catch { /* empty map — caller falls back */ }
    })()
    return () => { alive = false }
  }, [key])   // eslint-disable-line react-hooks/exhaustive-deps
  return map
}

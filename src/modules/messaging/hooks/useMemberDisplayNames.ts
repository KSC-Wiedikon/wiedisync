import { useEffect, useState } from 'react'
import { fetchAllItems } from '../../../lib/api'

/** Shared, never-mutated empty result (the fetch always builds a fresh Map). */
const EMPTY_NAMES: Map<string, string> = new Map()

/**
 * Batch-fetch display names for a set of member ids. Returns a Map keyed by id.
 * Re-fetches when the set of ids changes.
 */
export function useMemberDisplayNames(memberIds: string[]): Map<string, string> {
  const [map, setMap] = useState<Map<string, string>>(EMPTY_NAMES)
  const key = memberIds.slice().sort().join(',')
  // Drop the cached names as soon as the id set empties out. Adjust-state-during-
  // render (React's reset-on-prop-change pattern) rather than a setState in the
  // effect below — same result, one render less.
  const [prevKey, setPrevKey] = useState(key)
  if (prevKey !== key) {
    setPrevKey(key)
    if (memberIds.length === 0) setMap(EMPTY_NAMES)
  }
  useEffect(() => {
    if (memberIds.length === 0) return
    let alive = true
    ;(async () => {
      try {
        const rows = await fetchAllItems<{ id: string; first_name: string; last_name: string }>(
          'members',
          { filter: { id: { _in: memberIds } }, fields: ['id', 'first_name', 'last_name'] },
        )
        if (!alive) return
        const m = new Map<string, string>()
        for (const r of rows) {
          const full = `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim()
          m.set(String(r.id), full || String(r.id))
        }
        setMap(m)
      } catch { /* empty map — caller falls back to '—' */ }
    })()
    return () => { alive = false }
  }, [key])   // eslint-disable-line react-hooks/exhaustive-deps
  return map
}

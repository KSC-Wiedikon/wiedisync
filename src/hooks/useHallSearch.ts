import { useMemo } from 'react'
import type { Hall, LocationResult } from '../types'
import { useCollection } from '../lib/query'

// Stable empty fallback so the filter memo doesn't recompute every render while
// the halls query is still loading (`hallsRaw ?? []` would allocate a fresh [] each time).
const EMPTY_HALLS: Hall[] = []

function hallToLocationResult(hall: Hall): LocationResult {
  return {
    name: hall.name,
    address: hall.address,
    city: hall.city,
    lat: null,
    lon: null,
    source: 'directus',
  }
}

export function useHallSearch(query: string) {
  const { data: hallsRaw } = useCollection<Hall>('halls', { all: true, sort: ['name'] })
  const halls = hallsRaw ?? EMPTY_HALLS

  // Pure derivation of `query` + `halls` — computed during render instead of
  // mirrored into state by an effect (react-hooks/set-state-in-effect).
  const results = useMemo<LocationResult[]>(() => {
    if (!query || query.length < 1) return []
    const q = query.toLowerCase()
    return halls
      .filter(
        (h) =>
          (h.name || '').toLowerCase().includes(q) ||
          (h.address || '').toLowerCase().includes(q) ||
          (h.city || '').toLowerCase().includes(q),
      )
      .slice(0, 5)
      .map(hallToLocationResult)
  }, [query, halls])

  return { results }
}

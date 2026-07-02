import { useState, useEffect } from 'react'
import type { Hall, LocationResult } from '../types'
import { useCollection } from '../lib/query'

// Stable empty fallback so the filter effect doesn't re-run every render while
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
  const [results, setResults] = useState<LocationResult[]>([])

  useEffect(() => {
    if (!query || query.length < 1) {
      setResults([])
      return
    }
    const q = query.toLowerCase()
    const filtered = halls
      .filter(
        (h) =>
          (h.name || '').toLowerCase().includes(q) ||
          (h.address || '').toLowerCase().includes(q) ||
          (h.city || '').toLowerCase().includes(q),
      )
      .slice(0, 5)
      .map(hallToLocationResult)
    setResults(filtered)
  }, [query, halls])

  return { results }
}

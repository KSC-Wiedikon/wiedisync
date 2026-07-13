import { useCallback, useEffect, useRef, useState } from 'react'
import { messagingApi, type SearchableMember } from '../api/messaging'

interface UseMemberSearchOptions {
  debounceMs?: number
  enabled?: boolean
}

interface UseMemberSearchResult {
  results: SearchableMember[]
  loading: boolean
  error: string | null
}

export function useMemberSearch(
  query: string,
  { debounceMs = 200, enabled = true }: UseMemberSearchOptions = {},
): UseMemberSearchResult {
  const active = enabled && query.trim().length >= 2

  const [results, setResults] = useState<SearchableMember[]>([])
  // Lazy init mirrors the effect's first run: an already-searchable query is
  // "loading" (debouncing) from the very first render.
  const [loading, setLoading] = useState(() => active)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback(async (q: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await messagingApi.searchMembers(q.trim())
      setResults(data.members)
    } catch {
      setError('search_failed')
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Prime the loading/results state when the search key changes; the effect below
  // only (re)arms the debounce timer. `searchKey` covers the effect's deps verbatim
  // (`search` is a stable useCallback), so this fires on exactly the same renders —
  // it just settles during render rather than synchronously inside the effect
  // (react-hooks/set-state-in-effect).
  const searchKey = `${enabled ? '1' : '0'}|${debounceMs}|${query}`
  const [prevSearchKey, setPrevSearchKey] = useState(searchKey)
  if (prevSearchKey !== searchKey) {
    setPrevSearchKey(searchKey)
    if (active) {
      setLoading(true)
    } else {
      setResults([])
      setLoading(false)
    }
  }

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)

    if (!enabled || query.trim().length < 2) return

    timerRef.current = setTimeout(() => { void search(query) }, debounceMs)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query, debounceMs, enabled, search])

  return { results, loading, error }
}

import { useCallback, useEffect, useRef } from 'react'

/**
 * Coalesce a burst of realtime frames into ONE refetch.
 *
 * Directus emits one websocket frame per changed row, so a bulk write fans out into a
 * frame storm: `ScorerAssignPage` saves a season as ~200 chunked PATCHes, and the
 * training/game cascades rewrite whole weeks at a time. An undebounced
 * `useRealtime(coll, () => refetch())` re-issues the page's entire payload per frame —
 * and TanStack's `refetch()` defaults to `cancelRefetch: true`, so in-flight requests
 * are torn down and restarted rather than deduped. The user watches the list
 * re-render for as long as the burst lasts, and every one of those requests is a
 * permission-filtered read on the shared Postgres.
 *
 * Lifted from the already-correct implementation in
 * `src/modules/calendar/HallenplanView.tsx` (300ms), which is the reference for this
 * pattern — it was the only page doing it right when the 26.08.2026 participations
 * stall was investigated. See DEVLOG 26.08.2026.
 *
 * Returns a stable callback safe to hand straight to `useRealtime`. The pending timer
 * is cleared on unmount, so a refetch can never fire against a torn-down component.
 */
export function useDebouncedRefetch(refetch: () => void, delayMs = 300) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // "Latest value" ref, same reasoning as `useRealtime`: `refetch` identity changes on
  // every render of most callers, and depending on it directly would hand out a new
  // callback each time — which `useRealtime` treats as a reason to keep its effect
  // stable but which would defeat the point for any consumer that does depend on it.
  const refetchRef = useRef(refetch)
  useEffect(() => {
    refetchRef.current = refetch
  })

  useEffect(() => () => clearTimeout(timerRef.current), [])

  return useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => refetchRef.current(), delayMs)
  }, [delayMs])
}

import { useCallback, useSyncExternalStore } from 'react'

export function useMediaQuery(query: string): boolean {
  // matchMedia is an external store: subscribe to `change`, read the current
  // match on every snapshot. Equivalent to the previous useState + useEffect
  // pair, minus the extra render the effect's setState used to trigger.
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (typeof window === 'undefined') return () => {}
    const mql = window.matchMedia(query)
    mql.addEventListener('change', onStoreChange)
    return () => mql.removeEventListener('change', onStoreChange)
  }, [query])

  const getSnapshot = useCallback(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
    [query],
  )

  // No window (SSR / tests without matchMedia) → same `false` the old lazy
  // useState initializer produced.
  const getServerSnapshot = useCallback(() => false, [])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function useIsMobile() {
  return useMediaQuery('(max-width: 639px)')
}

export function useIsDesktop() {
  return useMediaQuery('(min-width: 1024px)')
}

import { useState, useCallback, useMemo } from 'react'
import { useAuth } from './useAuth'

export type SportView = 'vb' | 'bb' | 'all'

const STORAGE_KEY = 'wiedisync-sport'

/**
 * Sport preference hook.
 * - Reads from localStorage first (persisted across sessions for all users).
 * - Falls back to user's primary sport if no stored preference.
 * - Defaults to 'all' if nothing else applies.
 */
export function useSportPreference() {
  const { user, primarySport } = useAuth()

  // ⚠ Keyed per MEMBER (migration 348). A household guardian switches between
  // children on one phone, and a volleyball daughter and a basketball daughter
  // must not fight over one device-global setting — the second child would open
  // the app filtered to a sport she does not play.
  // Anonymous visitors keep the legacy device-global key.
  const storageKey = user ? `${STORAGE_KEY}:${user.id}` : STORAGE_KEY

  const read = useCallback((key: string): SportView | null => {
    try {
      const stored = localStorage.getItem(key)
      return stored === 'vb' || stored === 'bb' || stored === 'all' ? stored : null
    } catch { return null }
  }, [])

  const fallback = useCallback((): SportView => {
    if (primarySport === 'volleyball') return 'vb'
    if (primarySport === 'basketball') return 'bb'
    return 'all'
  }, [primarySport])

  // Fully DERIVED from the key rather than held in state and resynced by an
  // effect: a useState initialiser runs once, so a switch to another child would
  // keep the previous child's filter, and resyncing it from an effect is a
  // cascading render (and a lint error). `bump` just re-reads after a write.
  const [bump, setBump] = useState(0)
  const sport = useMemo(
    () => read(storageKey) ?? fallback(),
    // `bump` is not "unnecessary": localStorage is an external store the linter
    // cannot see, and without it this memo never re-reads after setSport writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageKey, read, fallback, bump],
  )

  const setSport = useCallback((value: SportView) => {
    try { localStorage.setItem(storageKey, value) } catch { /* storage unavailable */ }
    setBump((n) => n + 1)
  }, [storageKey])

  return { sport, setSport }
}

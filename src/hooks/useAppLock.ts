import { useCallback, useEffect, useRef, useState } from 'react'

/** Hidden at least this long → the app asks again when it comes back. */
export const APP_LOCK_AFTER_HIDDEN_MS = 5 * 60 * 1000

export interface AppLockOptions {
  /** The lock applies: switched on for this member, with a key on this device. */
  enabled: boolean
  /** The session was restored at a cold start — not a sign-in made in this page's lifetime. */
  lockOnStart: boolean
  afterHiddenMs?: number
  /** Injectable clock for the unit test. */
  now?: () => number
}

/**
 * WHEN the optional app lock (Profile → Passkeys) shows — the timing only; the
 * check itself is lib/passkeys.ts `unlockOnThisDevice`.
 *
 *  - cold start with a restored session: locked once, the first time the lock applies
 *    (a sign-in in this page's lifetime never locks — the member just proved who she is)
 *  - back from the background after ≥ `afterHiddenMs` hidden: locked
 *  - switched off, or nobody signed in: never locked, and nothing stays locked for the
 *    next member
 */
export function useAppLock({ enabled, lockOnStart, afterHiddenMs = APP_LOCK_AFTER_HIDDEN_MS, now = Date.now }: AppLockOptions) {
  const [locked, setLocked] = useState(false)
  const [startDecided, setStartDecided] = useState(false)
  if (enabled && !startDecided) {
    setStartDecided(true)
    if (lockOnStart) setLocked(true)
  }
  if (!enabled && locked) setLocked(false)

  // Survives a re-subscribe (a changed clock or threshold) while the page is hidden.
  const hiddenAt = useRef<number | null>(null)
  useEffect(() => {
    if (!enabled) return
    // Visible now: an older timestamp (from before the lock last went off) is stale.
    hiddenAt.current = document.visibilityState === 'hidden' ? (hiddenAt.current ?? now()) : null
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current ??= now()
        return
      }
      const since = hiddenAt.current
      hiddenAt.current = null
      if (since != null && now() - since >= afterHiddenMs) setLocked(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [enabled, afterHiddenMs, now])

  const unlock = useCallback(() => setLocked(false), [])
  return { locked: enabled && locked, unlock }
}

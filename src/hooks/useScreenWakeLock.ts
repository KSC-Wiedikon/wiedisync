import { useEffect } from 'react'

type Sentinel = { release: () => Promise<void> }
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: 'screen') => Promise<Sentinel> } }

/**
 * Keep the screen on while `active` — the Screen Wake Lock API (Chrome/Android,
 * Safari 16.4+). The browser drops the lock whenever the page is hidden, so it is
 * taken again each time the page comes back. Where the API is missing (older iOS,
 * an insecure origin) it is a silent no-op.
 */
export function useScreenWakeLock(active = true) {
  useEffect(() => {
    if (!active) return
    const nav = navigator as WakeLockNavigator
    let lock: Sentinel | null = null
    let released = false
    const grab = () => {
      nav.wakeLock?.request('screen')
        .then((l) => {
          // The effect may have been torn down while the request was pending.
          if (released) void l.release().catch(() => {})
          else lock = l
        })
        .catch(() => {})
    }
    grab()
    const onVisible = () => { if (document.visibilityState === 'visible') grab() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release().catch(() => {})
    }
  }, [active])
}

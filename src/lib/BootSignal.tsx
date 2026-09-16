import { useEffect } from 'react'

/**
 * Tells public/boot-watchdog.js (loaded from index.html, before this bundle)
 * that React has committed a first frame. Until this runs the watchdog owns
 * "the page never loaded" — after it, Sentry and the error log do. A mount
 * effect on a sibling of the app is the earliest hook that fires after the
 * first commit of BOTH build targets; `root.render` itself only schedules.
 */
export function BootSignal() {
  useEffect(() => {
    ;(window as unknown as { __kscwBootWatchdog?: { booted: () => void } }).__kscwBootWatchdog?.booted()
  }, [])
  return null
}

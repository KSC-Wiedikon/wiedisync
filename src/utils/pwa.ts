/**
 * PWA / standalone-display helpers.
 *
 * The Spielplanung app lives on its own subdomain (spielplanung.wiedisync.kscw.ch)
 * and is a separate PWA scope. When wiedisync itself is installed as a standalone
 * PWA, navigating an in-window link to that out-of-scope origin traps the user
 * inside the standalone window's chrome-less in-app browser. For these external
 * hops we want the SYSTEM browser instead — see `openExternalApp` /
 * `handlePWAExternalClick`.
 */

/** True when the app is running as an installed standalone PWA (any platform). */
export function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false
  const mm = window.matchMedia
  const standaloneDisplay =
    !!mm &&
    (mm('(display-mode: standalone)').matches ||
      mm('(display-mode: fullscreen)').matches ||
      mm('(display-mode: minimal-ui)').matches)
  // iOS Safari exposes the legacy `navigator.standalone` instead of display-mode.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true
  return standaloneDisplay || iosStandalone
}

/**
 * Navigate to an external app URL. From an installed PWA we force the system
 * browser via `window.open(_blank)` so the link isn't trapped inside the
 * standalone window; in a normal browser tab we navigate in place (preserving
 * the seamless SSO cookie hop). Use this for programmatic navigation.
 */
export function openExternalApp(href: string): void {
  if (typeof window === 'undefined') return
  if (isStandalonePWA()) {
    window.open(href, '_blank', 'noopener,noreferrer')
  } else {
    window.location.assign(href)
  }
}

/**
 * `onClick` handler for an `<a href>` that should break out of a PWA into the
 * system browser. In a PWA it cancels the in-window navigation and opens a new
 * system-browser tab; in a normal browser it does nothing and lets the anchor
 * navigate as usual (so cmd/ctrl-click still works).
 */
export function handlePWAExternalClick(e: { preventDefault: () => void }, href: string): void {
  if (isStandalonePWA()) {
    e.preventDefault()
    window.open(href, '_blank', 'noopener,noreferrer')
  }
}

/**
 * App-level boot gate — one spinner for the whole app.
 *
 * Without this, loading happens at two levels: Layout shows a fullscreen
 * spinner while auth/team context loads, then reveals the chrome (header +
 * footer), and THEN the routed page shows its own spinner while its data
 * loads. The user sees: spinner → chrome + spinner → content (the header
 * pops in between two spinners).
 *
 * With this, a routed page reports its primary-data loading via
 * `useReportPageLoading(loading)`. Layout reads `usePageLoading()` and keeps a
 * single fullscreen spinner up — masking chrome AND content — until both the
 * auth/team context and the page's data are ready, then reveals everything at
 * once. `useLayoutEffect` makes the report fire before paint, so there is no
 * chrome-then-content flash. The flag resets on unmount (navigation).
 */

import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'

/**
 * TEMP boot diagnostics. Logs to the console on every non-prod host (dev
 * preview, *.pages.dev, localhost) and stays silent on wiedisync.kscw.ch.
 * Used to trace how many times the boot spinner shows and what data each phase
 * is waiting on. Remove once the double-spinner is diagnosed.
 */
// Enabled when: we're on a non-prod host (dev preview / *.pages.dev / localhost),
// OR the URL has `?bootdebug=1` (survives a hard reload — more robust than
// localStorage, which gets wiped on this host), OR `localStorage.bootdebug` is
// set. Evaluated once and cached so it stays on even after the router strips the
// query param post-load.
let bootDebug: boolean | null = null
function bootDebugOn(): boolean {
  if (bootDebug !== null) return bootDebug
  if (typeof window === 'undefined') return false
  let on = window.location.hostname !== 'wiedisync.kscw.ch'
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.has('bootdebug')) on = params.get('bootdebug') !== '0'
    else if (localStorage.getItem('bootdebug')) on = true
  } catch { /* storage blocked — leave `on` as the host default */ }
  bootDebug = on
  return on
}

export function logBoot(label: string, data?: Record<string, unknown>) {
  if (!bootDebugOn()) return
  const t = Math.round(performance.now())
  if (data) console.log(`%c[boot +${t}ms] ${label}`, 'color:#b8860b', data)
  else console.log(`%c[boot +${t}ms] ${label}`, 'color:#b8860b')
}

interface PageReadyContextValue {
  pageLoading: boolean
  setPageLoading: (loading: boolean) => void
}

const PageReadyContext = createContext<PageReadyContextValue>({
  pageLoading: false,
  setPageLoading: () => {},
})

export function PageReadyProvider({ children }: { children: ReactNode }) {
  const [pageLoading, setPageLoading] = useState(false)
  return (
    <PageReadyContext.Provider value={{ pageLoading, setPageLoading }}>
      {children}
    </PageReadyContext.Provider>
  )
}

/** Layout reads this to decide whether to keep the unified boot spinner up. */
export function usePageLoading() {
  return useContext(PageReadyContext).pageLoading
}

/**
 * A routed page calls this with its own primary-data loading flag. While true,
 * the app-level boot spinner (rendered by Layout) stays up and masks the chrome
 * + content, so the user sees ONE spinner that lifts when everything is ready.
 * Resets to false on unmount (navigation away).
 */
export function useReportPageLoading(loading: boolean) {
  const { setPageLoading } = useContext(PageReadyContext)
  useLayoutEffect(() => {
    logBoot(`page reports loading=${loading}`, { path: window.location.pathname })
    setPageLoading(loading)
    return () => setPageLoading(false)
  }, [loading, setPageLoading])
}

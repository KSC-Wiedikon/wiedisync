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
 *
 * The provider COMPONENT lives in `hooks/PageReadyProvider.tsx` — a module may
 * export either React components or non-components, not both (react-refresh /
 * Fast Refresh).
 */

import { createContext, useContext, useLayoutEffect } from 'react'

export interface PageReadyContextValue {
  pageLoading: boolean
  setPageLoading: (loading: boolean) => void
}

export const PageReadyContext = createContext<PageReadyContextValue>({
  pageLoading: false,
  setPageLoading: () => {},
})

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
    setPageLoading(loading)
    return () => setPageLoading(false)
  }, [loading, setPageLoading])
}

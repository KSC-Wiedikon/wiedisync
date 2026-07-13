/**
 * PageReadyProvider — holds the app-level "page is still loading" flag.
 *
 * Split out of `hooks/usePageReady.tsx` (which keeps the context + the
 * `usePageLoading` / `useReportPageLoading` hooks) so neither module exports both
 * a React component and non-component values — required by
 * react-refresh/only-export-components (Fast Refresh).
 */

import { useState, type ReactNode } from 'react'
import { PageReadyContext } from './usePageReady'

export function PageReadyProvider({ children }: { children: ReactNode }) {
  const [pageLoading, setPageLoading] = useState(false)
  return (
    <PageReadyContext.Provider value={{ pageLoading, setPageLoading }}>
      {children}
    </PageReadyContext.Provider>
  )
}

/**
 * TanStack Query provider component.
 *
 * Lives in its own file (separate from `lib/query.tsx`, which holds the shared
 * `queryClient` + the hook factories) so neither module exports both a React
 * component and non-component values — the react-refresh/only-export-components
 * rule (Fast Refresh) requires that split.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from './query'

export function QueryProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

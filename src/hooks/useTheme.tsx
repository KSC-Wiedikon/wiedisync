/**
 * Theme context + the `useTheme` hook.
 *
 * The provider COMPONENT lives in `hooks/ThemeProvider.tsx` — a module may export
 * either React components or non-components, not both (react-refresh /
 * Fast Refresh).
 */

import { createContext, useContext } from 'react'

export type Theme = 'dark' | 'light'

export interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

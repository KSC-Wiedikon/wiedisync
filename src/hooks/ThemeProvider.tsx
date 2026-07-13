/**
 * ThemeProvider — dark/light theme provider component.
 *
 * Split out of `hooks/useTheme.tsx` (which keeps the context + the `useTheme`
 * hook) so neither module exports both a React component and non-component
 * values — required by react-refresh/only-export-components (Fast Refresh).
 */

import { useEffect, useState, type ReactNode } from 'react'
import { ThemeContext, type Theme } from './useTheme'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('wiedisync-theme') as Theme | null
    return stored === 'light' ? 'light' : 'dark'
  })

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    localStorage.setItem('wiedisync-theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

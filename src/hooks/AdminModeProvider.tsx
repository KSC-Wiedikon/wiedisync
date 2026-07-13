/**
 * AdminModeProvider — admin-mode toggle provider component.
 *
 * Split out of `hooks/useAdminMode.tsx` (which keeps the context + the
 * `useAdminMode` hook) so neither module exports both a React component and
 * non-component values — required by react-refresh/only-export-components.
 */

import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { useAuth } from './useAuth'
import { AdminModeContext, ADMIN_MODE_STORAGE_KEY, type AdminModeContextValue } from './useAdminMode'

export function AdminModeProvider({ children }: { children: ReactNode }) {
  const { isAdmin, isVorstand, coachTeamIds } = useAuth()

  const [rawMode, setRawMode] = useState<boolean>(() => {
    return localStorage.getItem(ADMIN_MODE_STORAGE_KEY) === 'true'
  })

  useEffect(() => {
    localStorage.setItem(ADMIN_MODE_STORAGE_KEY, String(rawMode))
  }, [rawMode])

  // Anyone with elevated privileges can toggle the mode
  const hasElevatedAccess = isAdmin || isVorstand
  const isAdminMode = hasElevatedAccess && rawMode

  // effectiveIsAdmin is true only when admin AND mode ON
  const effectiveIsAdmin = isAdmin && rawMode

  // Vorstand cross-team read access — only when mode ON
  const effectiveIsVorstand = isVorstand && rawMode

  // When admin mode OFF: coachTeamIds only (no isAdmin grant)
  // When admin mode ON: coachTeamIds || isAdmin
  const effectiveIsCoach = isAdminMode
    ? coachTeamIds.length > 0 || isAdmin
    : coachTeamIds.length > 0

  const toggleAdminMode = useCallback(() => setRawMode(prev => !prev), [])
  const setAdminMode = useCallback((mode: boolean) => setRawMode(mode), [])

  const value = useMemo<AdminModeContextValue>(
    () => ({
      isAdminMode,
      toggleAdminMode,
      setAdminMode,
      effectiveIsAdmin,
      effectiveIsCoach,
      effectiveIsVorstand,
      hasElevatedAccess,
    }),
    [isAdminMode, toggleAdminMode, setAdminMode, effectiveIsAdmin, effectiveIsCoach, effectiveIsVorstand, hasElevatedAccess],
  )

  return (
    <AdminModeContext.Provider value={value}>
      {children}
    </AdminModeContext.Provider>
  )
}

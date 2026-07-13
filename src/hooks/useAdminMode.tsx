/**
 * Admin-mode context + the `useAdminMode` hook.
 *
 * The provider COMPONENT lives in `hooks/AdminModeProvider.tsx` — a module may
 * export either React components or non-components, not both (react-refresh /
 * Fast Refresh).
 */

import { createContext, useContext } from 'react'

export interface AdminModeContextValue {
  isAdminMode: boolean
  toggleAdminMode: () => void
  setAdminMode: (mode: boolean) => void
  effectiveIsAdmin: boolean
  effectiveIsCoach: boolean
  /** Vorstand cross-team read access (read-only, no edit powers) */
  effectiveIsVorstand: boolean
  /** True when user has any elevated role that the toggle can gate */
  hasElevatedAccess: boolean
}

export const ADMIN_MODE_STORAGE_KEY = 'wiedisync-admin-mode'

export const AdminModeContext = createContext<AdminModeContextValue | null>(null)

export function useAdminMode() {
  const ctx = useContext(AdminModeContext)
  if (!ctx) throw new Error('useAdminMode must be used within AdminModeProvider')
  return ctx
}

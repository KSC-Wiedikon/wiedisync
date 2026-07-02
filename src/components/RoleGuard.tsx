import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth, type AuthContextValue } from '../hooks/useAuth'

/**
 * A single redirect rule. When `when(auth)` is true, the guard renders
 * `<Navigate to={to} replace />`. Rules are evaluated in array order and the
 * first match wins — anything that falls through renders `children`.
 */
export interface RoleGuardRedirect {
  when: (auth: AuthContextValue) => boolean
  to: string
}

/**
 * Shared route-guard primitive. Encapsulates the loading gate + ordered
 * allow/redirect checks that every KSCW route guard repeats:
 *
 *   1. While auth OR team/role context is still loading, render nothing
 *      (`return null`) — prevents pages flashing with incomplete role data.
 *   2. Walk `redirects` in order; the first rule whose `when` is true wins and
 *      the user is sent to its `to` (with `replace`).
 *   3. Otherwise render `children`.
 *
 * Each concrete guard (AdminRoute, AuthRoute, …) is a thin wrapper that just
 * supplies its own redirect rules.
 */
export default function RoleGuard({
  redirects,
  children,
}: {
  redirects: RoleGuardRedirect[]
  children: ReactNode
}) {
  const auth = useAuth()

  if (auth.isLoading || auth.teamsLoading) return null

  for (const rule of redirects) {
    if (rule.when(auth)) return <Navigate to={rule.to} replace />
  }

  return <>{children}</>
}

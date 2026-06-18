import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

/**
 * Board-only route guard. `isVorstand` is `roles.includes('vorstand') ||
 * isGlobalAdmin`, so club admins/superusers pass too. Mirrors AdminRoute.
 */
export default function VorstandRoute({ children }: { children: ReactNode }) {
  const { isVorstand, isLoading, teamsLoading } = useAuth()

  if (isLoading || teamsLoading) return null
  if (!isVorstand) return <Navigate to="/" replace />

  return <>{children}</>
}

import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

/**
 * Finance dashboard route guard. Opens for the board (Vorstand/admins) OR the
 * dedicated 'finance' role (treasurer / finance team) — `canAccessFinance` is
 * `isVorstand || isFinance`. Mirrors VorstandRoute. The backend independently
 * gates finance reads (KSCW Finance policy) + writes (canManageFinance).
 */
export default function FinanceRoute({ children }: { children: ReactNode }) {
  const { canAccessFinance, isLoading, teamsLoading } = useAuth()

  if (isLoading || teamsLoading) return null
  if (!canAccessFinance) return <Navigate to="/" replace />

  return <>{children}</>
}

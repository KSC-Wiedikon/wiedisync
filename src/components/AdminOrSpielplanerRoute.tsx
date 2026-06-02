import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

// Terminplanung (opponent game-scheduling) access: volleyball sport admins OR
// club-wide Spielplaner members (members.is_spielplaner = true). Mirrors the
// backend "KSCW Terminplanung" Directus policy + the isAdminOrSpielplaner gate
// on the action endpoints — per-team spielplaner_assignments alone do NOT grant
// access here (they wouldn't hold the policy and would 403 on the items API).
export default function AdminOrSpielplanerRoute({ children }: { children: ReactNode }) {
  const { hasAdminAccessToSport, is_spielplaner, isLoading, teamsLoading } = useAuth()

  if (isLoading || teamsLoading) return null
  if (!hasAdminAccessToSport('volleyball') && !is_spielplaner) return <Navigate to="/" replace />

  return <>{children}</>
}

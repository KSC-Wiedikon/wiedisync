import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

// Mailbox tab access: anyone who can reach at least one of the two scheduling
// mailboxes — volleyball (sport admin or club-wide Spielplaner) OR basketball
// (sport admin). Wider than AdminOrSpielplanerRoute so a basketball-only
// bb_admin can still open their mailbox. The page itself gates the toggle and
// the per-sport endpoints enforce the same split server-side.
export default function MailboxRoute({ children }: { children: ReactNode }) {
  const { hasAdminAccessToSport, is_spielplaner, isLoading, teamsLoading } = useAuth()

  if (isLoading || teamsLoading) return null
  const canVB = hasAdminAccessToSport('volleyball') || is_spielplaner
  const canBB = hasAdminAccessToSport('basketball')
  if (!canVB && !canBB) return <Navigate to="/" replace />

  return <>{children}</>
}

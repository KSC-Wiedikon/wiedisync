import type { ReactNode } from 'react'
import RoleGuard from './RoleGuard'

// Terminplanung (opponent game-scheduling) access: volleyball sport admins OR
// club-wide Spielplaner members (members.is_spielplaner = true). Mirrors the
// backend "KSCW Terminplanung" Directus policy + the isAdminOrSpielplaner gate
// on the action endpoints — per-team spielplaner_assignments alone do NOT grant
// access here (they wouldn't hold the policy and would 403 on the items API).
export default function AdminOrSpielplanerRoute({ children }: { children: ReactNode }) {
  return (
    <RoleGuard
      redirects={[
        { when: (a) => !a.hasAdminAccessToSport('volleyball') && !a.is_spielplaner, to: '/' },
      ]}
    >
      {children}
    </RoleGuard>
  )
}

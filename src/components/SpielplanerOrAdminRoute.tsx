import type { ReactNode } from 'react'
import RoleGuard from './RoleGuard'

export interface SpielplanerAccess {
  isAdmin: boolean
  is_spielplaner: boolean
  spielplanerTeamIds: string[]
  /** v1 read-only planner access: coaches/TRs may VIEW their teams' schedule
   *  (mutations stay spielplaner/admin-only — see editableTeamIds). */
  coachTeamIds: string[]
  teamResponsibleIds: string[]
}

export function canAccessSpielplanung(auth: SpielplanerAccess): boolean {
  return (
    auth.isAdmin ||
    auth.is_spielplaner ||
    auth.spielplanerTeamIds.length > 0 ||
    auth.coachTeamIds.length > 0 ||
    auth.teamResponsibleIds.length > 0
  )
}

export default function SpielplanerOrAdminRoute({ children }: { children: ReactNode }) {
  return (
    <RoleGuard
      redirects={[
        {
          when: (a) =>
            !canAccessSpielplanung({
              isAdmin: a.isAdmin,
              is_spielplaner: a.is_spielplaner,
              spielplanerTeamIds: a.spielplanerTeamIds,
              coachTeamIds: a.coachTeamIds,
              teamResponsibleIds: a.teamResponsibleIds,
            }),
          to: '/',
        },
      ]}
    >
      {children}
    </RoleGuard>
  )
}

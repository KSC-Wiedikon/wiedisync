import type { ReactNode } from 'react'
import RoleGuard from './RoleGuard'
import { canAccessSpielplanung } from '../utils/spielplanerAccess'

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

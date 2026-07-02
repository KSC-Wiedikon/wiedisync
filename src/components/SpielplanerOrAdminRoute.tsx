import type { ReactNode } from 'react'
import RoleGuard from './RoleGuard'

export interface SpielplanerAccess {
  isAdmin: boolean
  is_spielplaner: boolean
  spielplanerTeamIds: string[]
}

export function canAccessSpielplanung(auth: SpielplanerAccess): boolean {
  return auth.isAdmin || auth.is_spielplaner || auth.spielplanerTeamIds.length > 0
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
            }),
          to: '/',
        },
      ]}
    >
      {children}
    </RoleGuard>
  )
}

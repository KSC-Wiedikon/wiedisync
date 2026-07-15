import type { ReactNode } from 'react'
import RoleGuard from './RoleGuard'

/**
 * Basketball scheduling (prep view) access: basketball sport admins (bb_admin) or
 * full admins — `hasAdminAccessToSport('basketball')` already covers both. A
 * volleyball-only admin/Spielplaner is sent away: the page is basketball-only
 * (ProBasket hall availability, no opponent/token/booking flow).
 */
export default function BasketballAdminRoute({ children }: { children: ReactNode }) {
  return (
    <RoleGuard
      redirects={[{ when: (a) => !a.hasAdminAccessToSport('basketball'), to: '/' }]}
    >
      {children}
    </RoleGuard>
  )
}

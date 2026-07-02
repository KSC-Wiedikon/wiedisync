import type { ReactNode } from 'react'
import RoleGuard from './RoleGuard'

/**
 * Finance dashboard route guard. Opens for the board (Vorstand/admins) OR the
 * dedicated 'finance' role (treasurer / finance team) — `canAccessFinance` is
 * `isVorstand || isFinance`. Mirrors VorstandRoute. The backend independently
 * gates finance reads (KSCW Finance policy) + writes (canManageFinance).
 */
export default function FinanceRoute({ children }: { children: ReactNode }) {
  return (
    <RoleGuard redirects={[{ when: (a) => !a.canAccessFinance, to: '/' }]}>
      {children}
    </RoleGuard>
  )
}

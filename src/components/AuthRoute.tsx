import type { ReactNode } from 'react'
import RoleGuard from './RoleGuard'

/**
 * Authenticated + approved gate. RoleGuard blocks rendering until both auth AND
 * team/role context are fully loaded (prevents a flash of pages with incomplete
 * role data, then a re-render). After that, unauthenticated users go to /login
 * and authenticated-but-unapproved ones to /pending.
 */
export default function AuthRoute({ children }: { children: ReactNode }) {
  return (
    <RoleGuard
      redirects={[
        { when: (a) => !a.user, to: '/login' },
        { when: (a) => !a.isApproved, to: '/pending' },
      ]}
    >
      {children}
    </RoleGuard>
  )
}

import type { ReactNode } from 'react'
import RoleGuard from './RoleGuard'

export default function SuperAdminRoute({ children }: { children: ReactNode }) {
  return (
    <RoleGuard redirects={[{ when: (a) => !a.isSuperAdmin, to: '/' }]}>
      {children}
    </RoleGuard>
  )
}

import type { ReactNode } from 'react'
import RoleGuard from './RoleGuard'

export default function AdminRoute({ children }: { children: ReactNode }) {
  return (
    <RoleGuard redirects={[{ when: (a) => !a.isAdmin, to: '/' }]}>
      {children}
    </RoleGuard>
  )
}

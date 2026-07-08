import type { ReactNode } from 'react'
import RoleGuard from './RoleGuard'

/**
 * TK (Sport Admin) expense-confirmation route guard. Opens for a section's Sport
 * Admin (vb_admin / bb_admin) OR the board / finance role. The endpoint
 * (/kscw/expenses/tk-queue + /tk-confirm) independently gates by section, so
 * this only decides who may see the page at all.
 */
export default function TkRoute({ children }: { children: ReactNode }) {
  return (
    <RoleGuard redirects={[{ when: (a) => !(a.isVbAdmin || a.isBbAdmin || a.canAccessFinance), to: '/' }]}>
      {children}
    </RoleGuard>
  )
}

import type { ReactNode } from 'react'
import RoleGuard from './RoleGuard'

/**
 * Global-admin-only route guard: `isGlobalAdmin` is `admin || superuser`.
 *
 * Deliberately distinct from its neighbours, all of which are wrong here:
 *  - `AdminRoute`     — also lets in vb_admin / bb_admin (sport-scoped).
 *  - `VorstandRoute`  — also lets in vorstand (board).
 *  - `SuperAdminRoute`— superuser ONLY, excludes plain admins.
 *
 * Used by /admin/mailbox, and mirrors the server's authForAccount('admin') in
 * kscw-endpoints/src/scheduling-mailbox.js. Keep the two in step: widening one
 * without the other either 403s people on a nav item they can see, or shows a
 * link the server refuses.
 */
export default function GlobalAdminRoute({ children }: { children: ReactNode }) {
  return (
    <RoleGuard redirects={[{ when: (a) => !a.isGlobalAdmin, to: '/' }]}>
      {children}
    </RoleGuard>
  )
}

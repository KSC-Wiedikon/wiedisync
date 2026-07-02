import type { ReactNode } from 'react'
import RoleGuard from './RoleGuard'

/**
 * Board-only route guard. `isVorstand` is `roles.includes('vorstand') ||
 * isGlobalAdmin`, so club admins/superusers pass too. Mirrors AdminRoute.
 */
export default function VorstandRoute({ children }: { children: ReactNode }) {
  return (
    <RoleGuard redirects={[{ when: (a) => !a.isVorstand, to: '/' }]}>
      {children}
    </RoleGuard>
  )
}

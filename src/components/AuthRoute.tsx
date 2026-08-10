import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import RoleGuard from './RoleGuard'
import { safeReturnPath } from '../utils/activityLinks'

/** Where an unauthenticated visitor is sent back to after logging in. */
const RETURN_PARAM = 'next'

/**
 * Authenticated + approved gate. RoleGuard blocks rendering until both auth AND
 * team/role context are fully loaded (prevents a flash of pages with incomplete
 * role data, then a re-render). After that, unauthenticated users go to /login
 * and authenticated-but-unapproved ones to /pending.
 *
 * The attempted path rides along as `?next=` so a shared deep link survives the
 * login screen. Without it every `/events/42` link handed to a member who is not
 * currently signed in on that device dead-ends on the home page, which is the
 * common case on a phone opening a link from a chat.
 */
export default function AuthRoute({ children }: { children: ReactNode }) {
  const location = useLocation()
  const attempted = `${location.pathname}${location.search}`
  const loginTo = safeReturnPath(attempted)
    ? `/login?${RETURN_PARAM}=${encodeURIComponent(attempted)}`
    : '/login'

  return (
    <RoleGuard
      redirects={[
        { when: (a) => !a.user, to: loginTo },
        { when: (a) => !a.isApproved, to: '/pending' },
      ]}
    >
      {children}
    </RoleGuard>
  )
}

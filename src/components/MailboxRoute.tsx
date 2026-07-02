import type { ReactNode } from 'react'
import RoleGuard from './RoleGuard'

// Mailbox tab access: anyone who can reach at least one of the two scheduling
// mailboxes — volleyball (sport admin or club-wide Spielplaner) OR basketball
// (sport admin). Wider than AdminOrSpielplanerRoute so a basketball-only
// bb_admin can still open their mailbox. The page itself gates the toggle and
// the per-sport endpoints enforce the same split server-side.
export default function MailboxRoute({ children }: { children: ReactNode }) {
  return (
    <RoleGuard
      redirects={[
        {
          when: (a) => {
            const canVB = a.hasAdminAccessToSport('volleyball') || a.is_spielplaner
            const canBB = a.hasAdminAccessToSport('basketball')
            return !canVB && !canBB
          },
          to: '/',
        },
      ]}
    >
      {children}
    </RoleGuard>
  )
}

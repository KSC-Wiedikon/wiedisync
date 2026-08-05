import type { ReactNode } from 'react'
import RoleGuard from './RoleGuard'

/**
 * Basketball scheduling (prep view / calendar / settings) access: basketball
 * sport admins (bb_admin) or full admins — `hasAdminAccessToSport('basketball')`
 * already covers both — OR club-wide Spielplaner members
 * (members.is_spielplaner = true). Same shape as AdminOrSpielplanerRoute: the
 * Spielplaner role is club-wide, not per-sport, so a Spielplaner plans the
 * basketball hall availability too. Per-team spielplaner_assignments alone do
 * NOT grant access here (same caveat as volleyball).
 *
 * A denied user lands on `/?denied=basketball` so SchedulingHome shows the
 * no-access notice instead of silently re-routing them into the volleyball
 * planner (which is what made this read as "the link doesn't work").
 *
 * ⚠ The basketball MAILBOX is deliberately NOT widened by this guard — see
 * MailboxRoute: `/terminplanung/mailbox` requires bb_admin server-side, so a
 * Spielplaner would only earn a 403 there.
 */
export default function BasketballAdminRoute({ children }: { children: ReactNode }) {
  return (
    <RoleGuard
      redirects={[
        { when: (a) => !a.hasAdminAccessToSport('basketball') && !a.is_spielplaner, to: '/?denied=basketball' },
      ]}
    >
      {children}
    </RoleGuard>
  )
}

import { Navigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { isAuthenticated } from '@/lib/api'
import { useReportPageLoading } from '../../../hooks/usePageReady'

/**
 * Root dispatcher for the Spielplanung subdomain. Deliberately UNGUARDED so it
 * never bounces a no-access user back to itself (the admin route guards redirect
 * to `/`). Routes:
 *   - not logged in        → /login
 *   - `?denied=<section>`  → friendly notice (a guard just turned this user away)
 *   - terminplanung access → /admin/terminplanung
 *   - planner-only access  → /admin/spielplanung
 *   - logged in, no access → friendly notice
 *
 * The `?denied` short-circuit matters: without it a user bounced off a basketball
 * route (BasketballAdminRoute → `/?denied=basketball`) got silently forwarded to
 * the volleyball planner, which reads as "the link doesn't work" rather than
 * "you don't have access to that section".
 */
export default function SchedulingHome() {
  const {
    user, isLoading, teamsLoading,
    hasAdminAccessToSport, is_spielplaner, isAdmin, spielplanerTeamIds,
    coachTeamIds, teamResponsibleIds,
  } = useAuth()
  const { theme } = useTheme()
  const { t } = useTranslation('gameScheduling')
  const [searchParams] = useSearchParams()
  // Set by a route guard that just turned this user away — stop dispatching and
  // explain, instead of forwarding them into an unrelated section.
  const denied = searchParams.get('denied')

  // Report to the app boot gate — see usePageReady.tsx
  const isInitialLoading = (isLoading || teamsLoading) && isAuthenticated()
  useReportPageLoading(isInitialLoading)

  if (isInitialLoading) return null
  if (!user) return <Navigate to="/login" replace />

  const canTerminplanung = hasAdminAccessToSport('volleyball') || is_spielplaner
  if (!denied && canTerminplanung) return <Navigate to="/admin/terminplanung" replace />

  // Coaches/TRs get READ-ONLY planner access (v1) — same landing as a scoped
  // spielplaner; the page itself keeps edit rights spielplaner/admin-only.
  const canPlanner =
    isAdmin || is_spielplaner || spielplanerTeamIds.length > 0 ||
    coachTeamIds.length > 0 || teamResponsibleIds.length > 0
  if (!denied && canPlanner) return <Navigate to="/admin/spielplanung" replace />

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm text-center">
        <img
          src={theme === 'light' ? '/wiedisync_blau.png' : '/wiedisync_weiss.png'}
          alt="KSC Wiedikon"
          className="mx-auto mb-6 h-14 w-auto"
        />
        <h1 className="mb-2 text-lg font-bold">{t('home.noAccessTitle', 'No scheduling access')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('home.noAccessBody', 'Your account does not have access to game scheduling. Contact a club admin if you think this is a mistake.')}
        </p>
      </div>
    </div>
  )
}

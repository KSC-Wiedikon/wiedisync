import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import LoadingSpinner from '@/components/LoadingSpinner'
import { isAuthenticated } from '@/lib/api'

/**
 * Root dispatcher for the Spielplanung subdomain. Deliberately UNGUARDED so it
 * never bounces a no-access user back to itself (the admin route guards redirect
 * to `/`). Routes:
 *   - not logged in        → /login
 *   - terminplanung access → /admin/terminplanung
 *   - planner-only access  → /admin/spielplanung
 *   - logged in, no access → friendly notice
 */
export default function SchedulingHome() {
  const {
    user, isLoading, teamsLoading,
    hasAdminAccessToSport, is_spielplaner, isAdmin, spielplanerTeamIds,
  } = useAuth()
  const { theme } = useTheme()
  const { t } = useTranslation('gameScheduling')

  if ((isLoading || teamsLoading) && isAuthenticated()) return <LoadingSpinner />
  if (!user) return <Navigate to="/login" replace />

  const canTerminplanung = hasAdminAccessToSport('volleyball') || is_spielplaner
  if (canTerminplanung) return <Navigate to="/admin/terminplanung" replace />

  const canPlanner = isAdmin || is_spielplaner || spielplanerTeamIds.length > 0
  if (canPlanner) return <Navigate to="/admin/spielplanung" replace />

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

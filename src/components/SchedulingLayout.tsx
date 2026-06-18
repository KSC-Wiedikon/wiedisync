import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { isAuthenticated } from '../lib/api'
import LanguageDropdown from '@/components/LanguageDropdown'
import LoadingSpinner from './LoadingSpinner'
import { CalendarClock, ClipboardList, LogOut, Moon, Sun } from 'lucide-react'

/**
 * Minimal shell for the Spielplanung subdomain's admin pages — logo, the two
 * scheduling sections (role-gated), language + dark-mode + logout. Deliberately
 * NOT the member-app `Layout`: its navigation targets member-only routes that
 * don't exist here. Opponent pages render bare (no shell), as on the member app.
 */
export default function SchedulingLayout() {
  const {
    user, isLoading, teamsLoading, logout,
    hasAdminAccessToSport, is_spielplaner, isAdmin, spielplanerTeamIds,
  } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { t } = useTranslation('nav')
  const navigate = useNavigate()

  if ((isLoading || teamsLoading) && isAuthenticated()) return <LoadingSpinner />

  const canTerminplanung = hasAdminAccessToSport('volleyball') || is_spielplaner
  const canPlanner = isAdmin || is_spielplaner || spielplanerTeamIds.length > 0

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      isActive
        ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-gold-400'
        : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
    }`

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <NavLink to="/admin/terminplanung" className="flex shrink-0 items-center gap-2">
            <img
              src={theme === 'light' ? '/wiedisync_blau.png' : '/wiedisync_weiss.png'}
              alt="KSC Wiedikon"
              className="h-8 w-auto"
            />
            <span className="hidden text-sm font-bold sm:inline">Spielplanung</span>
          </NavLink>

          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            {canTerminplanung && (
              <NavLink to="/admin/terminplanung" className={linkClass}>
                <CalendarClock className="h-4 w-4" />
                <span className="whitespace-nowrap">{t('terminplanung')}</span>
              </NavLink>
            )}
            {canPlanner && (
              <NavLink to="/admin/spielplanung" className={linkClass}>
                <ClipboardList className="h-4 w-4" />
                <span className="whitespace-nowrap">{t('gameplan')}</span>
              </NavLink>
            )}
          </nav>

          <div className="flex shrink-0 items-center gap-1">
            <LanguageDropdown />
            <button
              onClick={toggleTheme}
              aria-label={t('darkMode', 'Dark mode')}
              className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            {user && (
              <button
                onClick={handleLogout}
                aria-label={t('logout')}
                className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  )
}

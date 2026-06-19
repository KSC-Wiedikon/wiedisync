import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { isAuthenticated } from '../lib/api'
import LanguageDropdown from '@/components/LanguageDropdown'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import LoadingSpinner from './LoadingSpinner'
import { CalendarClock, Check, ChevronDown, ClipboardList, LogOut, Moon, Sun } from 'lucide-react'

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
  const { pathname } = useLocation()

  if ((isLoading || teamsLoading) && isAuthenticated()) return <LoadingSpinner />

  const canTerminplanung = hasAdminAccessToSport('volleyball') || is_spielplaner
  const canPlanner = isAdmin || is_spielplaner || spielplanerTeamIds.length > 0

  const navItems: { to: string; label: string; Icon: typeof CalendarClock }[] = [
    ...(canTerminplanung ? [{ to: '/admin/terminplanung', label: t('terminplanung'), Icon: CalendarClock }] : []),
    ...(canPlanner ? [{ to: '/admin/spielplanung', label: t('gameplan'), Icon: ClipboardList }] : []),
  ]
  const activeItem = navItems.find((item) => pathname.startsWith(item.to)) ?? navItems[0]

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

          {/* Desktop: inline tabs. Mobile: a dropdown so long labels never scroll horizontally. */}
          <nav className="hidden flex-1 items-center gap-1 sm:flex">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={linkClass}>
                <item.Icon className="h-4 w-4" />
                <span className="whitespace-nowrap">{item.label}</span>
              </NavLink>
            ))}
          </nav>

          {navItems.length > 0 && activeItem && (
            <div className="flex min-w-0 flex-1 sm:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 outline-none transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
                    <activeItem.Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{activeItem.label}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[200px]">
                  {navItems.map((item) => (
                    <DropdownMenuItem
                      key={item.to}
                      onClick={() => navigate(item.to)}
                      className="flex cursor-pointer items-center gap-2.5"
                    >
                      <item.Icon className="h-4 w-4" />
                      <span className="flex-1">{item.label}</span>
                      {activeItem.to === item.to && (
                        <Check className="h-4 w-4 text-brand-600 dark:text-gold-400" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

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

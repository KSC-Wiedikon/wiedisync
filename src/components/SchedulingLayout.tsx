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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CalendarCheck, CalendarClock, Check, ChevronDown, ClipboardList, ExternalLink, LayoutDashboard, LogOut, Mail, Moon, Settings, Sun } from 'lucide-react'

const WIEDISYNC_URL = 'https://wiedisync.kscw.ch'

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
    coachTeamIds, teamResponsibleIds,
  } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { t } = useTranslation('nav')
  const { t: tb } = useTranslation('basketballScheduling')
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // Don't render the shell with incomplete role context; the app-level
  // <BootOverlay/> (in SchedulingApp) shows the single boot spinner meanwhile.
  if ((isLoading || teamsLoading) && isAuthenticated()) return null

  const canTerminplanung = hasAdminAccessToSport('volleyball') || is_spielplaner
  // Coaches/TRs reach the planner calendar only (read-only in v1) — never the
  // Terminplanung dashboard (its reads need the club-wide Directus policy).
  const canPlanner =
    isAdmin || is_spielplaner || spielplanerTeamIds.length > 0 ||
    coachTeamIds.length > 0 || teamResponsibleIds.length > 0
  // Basketball scheduling (planner / calendar / settings) — same shape as
  // volleyball's canTerminplanung: basketball sport admins OR club-wide
  // Spielplaner. Must agree with BasketballAdminRoute and SchedulingHome or the
  // tab shows a link the route guard bounces.
  const canBasketball = hasAdminAccessToSport('basketball') || is_spielplaner
  // ⚠ The basketball MAILBOX stays sport-admin-only on purpose: the mailbox
  // route split is a security boundary (CLAUDE.md) and scheduling-mailbox.js
  // requires bb_admin server-side, so widening it here would only produce a 403.
  const canBasketballMailbox = hasAdminAccessToSport('basketball')
  // The mailbox tab is reachable by either sport's admins (basketball-only
  // bb_admins included), wider than the terminplanung dashboard.
  const canMailbox = canTerminplanung || canBasketballMailbox

  // Sport split: the URL carries the sport — /admin/terminplanung/volleyball* vs
  // /admin/terminplanung/basketball*. Each sport has its own tab set.
  const activeSport: 'volleyball' | 'basketball' =
    pathname.startsWith('/admin/terminplanung/basketball') ? 'basketball' : 'volleyball'

  type NavItem = { to: string; label: string; Icon: typeof CalendarClock; end?: boolean }
  const volleyballNav: NavItem[] = [
    ...(canTerminplanung ? [{ to: '/admin/terminplanung/volleyball', label: t('dashboard'), Icon: LayoutDashboard }] : []),
    ...(canMailbox ? [{ to: '/admin/terminplanung/mailbox', label: t('mailbox'), Icon: Mail }] : []),
    ...(canTerminplanung ? [{ to: '/admin/terminplanung/settings', label: t('settings'), Icon: Settings }] : []),
    ...(canPlanner ? [{ to: '/admin/spielplanung', label: t('gameplan'), Icon: ClipboardList }] : []),
  ]
  const basketballNav: NavItem[] = [
    ...(canBasketball ? [{ to: '/admin/terminplanung/basketball', label: tb('tab'), Icon: CalendarCheck, end: true }] : []),
    ...(canBasketball ? [{ to: '/admin/terminplanung/basketball/calendar', label: tb('tabCalendar'), Icon: CalendarClock }] : []),
    ...(canBasketball ? [{ to: '/admin/terminplanung/basketball/settings', label: tb('tabSettings'), Icon: Settings }] : []),
    // Sport-admin-only (see canBasketballMailbox) — a Spielplaner planning
    // basketball still has no basketball mailbox.
    ...(canBasketballMailbox ? [{ to: '/admin/terminplanung/basketball/mailbox', label: t('mailbox'), Icon: Mail }] : []),
  ]
  const navItems: NavItem[] = activeSport === 'basketball' ? basketballNav : volleyballNav

  // Sport-toggle landing targets.
  const volleyballHome = volleyballNav[0]?.to ?? '/admin/terminplanung/volleyball'
  const basketballHome = '/admin/terminplanung/basketball'

  // Most-specific match wins so /settings doesn't light up the exact-match dashboard tab.
  const activeItem =
    navItems
      .filter((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to)))
      .sort((a, b) => b.to.length - a.to.length)[0] ?? navItems[0]

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      isActive
        ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-gold-400'
        : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
    }`

  const sportPillClass = (active: boolean) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
      active
        ? 'bg-brand-600 text-white shadow-sm'
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

          {/* Sport toggle — Volleyball ↔ Basketball. Only shown to users with
              basketball access; volleyball-only admins see the app unchanged. */}
          {canBasketball && (
            <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
              <button
                type="button"
                onClick={() => navigate(volleyballHome)}
                aria-pressed={activeSport === 'volleyball'}
                className={sportPillClass(activeSport === 'volleyball')}
              >
                <span aria-hidden>🏐</span>
                <span className="hidden md:inline">{tb('volleyball')}</span>
              </button>
              <button
                type="button"
                onClick={() => navigate(basketballHome)}
                aria-pressed={activeSport === 'basketball'}
                className={sportPillClass(activeSport === 'basketball')}
              >
                <span aria-hidden>🏀</span>
                <span className="hidden md:inline">{tb('basketball')}</span>
              </button>
            </div>
          )}

          {/* Desktop: inline tabs. Mobile: a dropdown so long labels never scroll horizontally. */}
          <nav className="hidden flex-1 items-center gap-1 sm:flex">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
                <item.Icon className="h-4 w-4" />
                <span className="whitespace-nowrap">{item.label}</span>
              </NavLink>
            ))}
            <a
              href={WIEDISYNC_URL}
              className="ml-auto flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ExternalLink className="h-4 w-4" />
              <span className="whitespace-nowrap">Wiedisync</span>
            </a>
          </nav>

          {navItems.length > 0 && activeItem && (
            <div className="flex min-w-0 flex-1 sm:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button aria-label={activeItem.label} className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-gray-600 outline-none transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
                    <activeItem.Icon className="h-5 w-5 shrink-0" />
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
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => { window.location.href = WIEDISYNC_URL }}
                    className="flex cursor-pointer items-center gap-2.5"
                  >
                    <ExternalLink className="h-4 w-4" />
                    <span className="flex-1">Wiedisync</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          <div className="flex shrink-0 items-center gap-1">
            <LanguageDropdown />
            <button
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? t('switchToLight') : t('switchToDark')}
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

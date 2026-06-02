import { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { useIsDesktop } from '../hooks/useMediaQuery'
import { useNotifications } from '../hooks/useNotifications'
import { useUnreadTotal } from '../modules/messaging/hooks/useUnreadTotal'
import { messagingFeatureEnabled } from '../utils/messagingFeatureFlag'
import { getFileUrl } from '../utils/fileUrl'
import { getCurrentSeason } from '../utils/dateHelpers'
import { isAuthenticated } from '../lib/api'
import AdminToggle from './AdminToggle'
import { useAdminMode } from '../hooks/useAdminMode'
import BottomTabBar from './BottomTabBar'
import MoreSheet from './MoreSheet'
import NotificationBell from './NotificationBell'
import NotificationPanel from './NotificationPanel'
import SidebarNotifications from './SidebarNotifications'
import SwitchToggle from '@/components/SwitchToggle'
import LanguageDropdown from '@/components/LanguageDropdown'
import TeamChip from './TeamChip'
import { useCollection } from '../lib/query'
import LoadingSpinner from './LoadingSpinner'
import ProfileEditModal from '../modules/auth/ProfileEditModal'
import type { MemberTeam, Team } from '../types'
import { asObj } from '../utils/relations'
import {
  Home, Calendar, Trophy, UserX, PenSquare, PartyPopper, Users,
  ClipboardList, Building2, CalendarClock, Activity,
  HeartPulse, Settings, ChevronDown, MessageSquare, MessageCircle, Inbox, Banknote, BarChart3, UserPlus, Bug, GraduationCap, Database, Megaphone, Newspaper, Flag, ScrollText, Terminal, Gavel,
} from 'lucide-react'
import { APP_VERSION } from '../modules/changelog/ChangelogPage'

type ExpandedMemberTeam = MemberTeam & { team: Team | string }

function useNavItems(isLoggedIn: boolean, isApproved: boolean, memberId?: number | string | null) {
  const { t } = useTranslation('nav')
  const { memberTeamIds, isAdmin, is_spielplaner, spielplanerTeamIds } = useAuth()
  const { effectiveIsAdmin, effectiveIsVorstand } = useAdminMode()
  const showTeamsPlural = effectiveIsAdmin || effectiveIsVorstand || memberTeamIds.length > 1
  const iconClass = 'h-5 w-5'
  const publicItems = [
    { to: '/', label: t('home'), icon: <Home className={iconClass} /> },
    { to: '/calendar', label: t('calendar'), icon: <Calendar className={iconClass} /> },
    { to: '/games', label: t('games'), icon: <Trophy className={iconClass} /> },
  ]
  const authItems = [
    {
      to: '/trainings',
      label: t('trainings'),
      icon: (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M16.05 10.966a5 2.5 0 0 1-8.1 0" />
          <path d="m16.923 14.049 4.48 2.04a1 1 0 0 1 .001 1.831l-8.574 3.9a2 2 0 0 1-1.66 0l-8.574-3.91a1 1 0 0 1 0-1.83l4.484-2.04" />
          <path d="M16.949 14.14a5 2.5 0 1 1-9.9 0L10.063 3.5a2 2 0 0 1 3.874 0z" />
          <path d="M9.194 6.57a5 2.5 0 0 0 5.61 0" />
        </svg>
      ),
    },
    { to: '/events', label: t('events'), icon: <PartyPopper className={iconClass} /> },
    ...(messagingFeatureEnabled(memberId)
      ? [{ to: '/inbox', label: t('inbox'), icon: <Inbox className={iconClass} /> }]
      : []),
    { to: '/teams', label: t(showTeamsPlural ? 'teams' : 'team'), icon: <Users className={iconClass} /> },
    { to: '/absences', label: t('absences'), icon: <UserX className={iconClass} /> },
    { to: '/scorer', label: t('scorer'), icon: <PenSquare className={iconClass} /> },
    { to: '/fines', label: t('fines'), icon: <Gavel className={iconClass} /> },
    { to: '/news', label: t('news'), icon: <Newspaper className={iconClass} /> },
  ]
  // Spielplaner tools surfaced directly in the main nav (no admin-mode toggle)
  // for non-admin members who hold scheduling access. Admins reach these via the
  // Admin menu instead. Spielplanung = club-wide or per-team Spielplaner;
  // Terminplanung = club-wide Spielplaner only (matches AdminOrSpielplanerRoute).
  const spielplanerItems = !isAdmin
    ? [
        ...(is_spielplaner || spielplanerTeamIds.length > 0
          ? [{ to: '/admin/spielplanung', label: t('gameplan'), icon: <ClipboardList className={iconClass} /> }]
          : []),
        ...(is_spielplaner
          ? [{ to: '/admin/terminplanung', label: t('terminplanung'), icon: <CalendarClock className={iconClass} /> }]
          : []),
      ]
    : []
  return {
    navItems: isLoggedIn && isApproved ? [...publicItems, ...authItems, ...spielplanerItems] : publicItems,
    adminItems: [
      { to: '/admin/spielplanung', label: t('gameplan'), icon: <ClipboardList className={iconClass} /> },
      { to: '/admin/hallenplan', label: t('hallenplan'), icon: <Building2 className={iconClass} /> },
      { to: '/admin/terminplanung', label: t('terminplanung'), icon: <CalendarClock className={iconClass} /> },
      { to: '/admin/referee-expenses', label: t('refereeExpenses'), icon: <Banknote className={iconClass} /> },
      { to: '/admin/anmeldungen', label: t('anmeldungen'), icon: <UserPlus className={iconClass} /> },
      { to: '/admin/club-stats', label: t('clubStats'), icon: <BarChart3 className={iconClass} /> },
      { to: '/admin/volley-feedback', label: t('volleyFeedback'), icon: <MessageSquare className={iconClass} /> },
      { to: '/admin/explore', label: t('adminExplorer'), icon: <Database className={iconClass} /> },
      { to: '/admin/announcements', label: t('announcements'), icon: <Megaphone className={iconClass} /> },
      { to: '/admin/reports', label: t('moderationReports'), icon: <Flag className={iconClass} /> },
    ],
    superadminItems: [
      { to: '/admin/infra', label: t('infraHealth'), icon: <Activity className={iconClass} /> },
      { to: '/admin/data-health', label: t('dataHealth'), icon: <HeartPulse className={iconClass} /> },
      { to: '/bugfixes', label: t('bugfixes'), icon: <Bug className={iconClass} /> },
      { to: '/admin/audit-log', label: t('auditLog'), icon: <ScrollText className={iconClass} /> },
      { to: '/admin/sql', label: t('sqlWorkspace'), icon: <Terminal className={iconClass} /> },
    ],
  }
}

type SidebarView = 'closed' | 'nav' | 'notifications'

function SidebarOptions({ isAdmin, theme, toggleTheme, onClose, memberId }: { isAdmin: boolean; theme: string; toggleTheme: () => void; onClose?: () => void; memberId?: number | string | null }) {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation('nav')

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
      >
        <Settings className="h-4 w-4" />
        <span className="flex-1 text-left">{t('options', 'Options')}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`grid transition-[grid-template-rows] duration-200 ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="py-1">
            <div className="flex items-center justify-between rounded-lg px-3 py-2 text-sm">
              <span className="font-medium text-gray-600 dark:text-gray-300">{t('darkMode', 'Dark mode')}</span>
              <SwitchToggle
                enabled={theme === 'dark'}
                onChange={toggleTheme}
                ariaLabel="Toggle dark mode"
                iconOff={
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591z" />
                  </svg>
                }
                iconOn={
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path fillRule="evenodd" d="M9.528 1.718a.75.75 0 01.162.819A8.97 8.97 0 009 6a9 9 0 009 9 8.97 8.97 0 003.463-.69.75.75 0 01.981.98 10.503 10.503 0 01-9.694 6.46c-5.799 0-10.5-4.701-10.5-10.5 0-4.368 2.667-8.112 6.46-9.694a.75.75 0 01.818.162z" clipRule="evenodd" />
                  </svg>
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-lg px-3 py-2 text-sm">
              <span className="font-medium text-gray-600 dark:text-gray-300">{t('language', 'Language')}</span>
              <LanguageDropdown />
            </div>
            {isAdmin && (
              <div className="flex items-center justify-between rounded-lg px-3 py-2 text-sm">
                <span className="font-medium text-gray-600 dark:text-gray-300">{t('adminMode', 'Admin mode')}</span>
                <AdminToggle />
              </div>
            )}
            <NavLink
              to="/feedback"
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-gold-400'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                }`
              }
            >
              <MessageSquare className="h-4 w-4" />
              {t('feedback')}
            </NavLink>
            {messagingFeatureEnabled(memberId) && (
              <NavLink
                to="/options/messaging"
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-gold-400'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`
                }
              >
                <MessageCircle className="h-4 w-4" />
                {t('messagingSettings')}
              </NavLink>
            )}
            <NavLink
              to="/status"
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-gold-400'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                }`
              }
            >
              <Activity className="h-4 w-4" />
              {t('status', 'Status')}
            </NavLink>
            <NavLink
              to="/changelog"
              onClick={onClose}
              className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <span className="flex items-center gap-3">
                <ScrollText className="h-4 w-4" />
                {t('whatsNew', "What's New")}
              </span>
              <span className="font-mono text-xs text-gray-400 dark:text-gray-500">v{APP_VERSION}</span>
            </NavLink>
          </div>
        </div>
      </div>
    </>
  )
}

export default function Layout() {
  const [sidebarView, setSidebarView] = useState<SidebarView>('closed')
  const [moreOpen, setMoreOpen] = useState(false)
  const [notifPanelOpen, setNotifPanelOpen] = useState(false)
  const sidebarExpanded = sidebarView !== 'closed'
  const { user, isAdmin, isApproved, isProfileComplete, isSuperAdmin, isLoading, teamsLoading, logout } = useAuth()
  const { notifications, unreadCount, markAsRead, markAllAsRead, deleteNotification, clearAllRead } = useNotifications()
  const { theme, toggleTheme } = useTheme()
  const { t } = useTranslation('nav')
  const isDesktop = useIsDesktop()
  const location = useLocation()
  const { isAdminMode, setAdminMode } = useAdminMode()
  const { navItems, adminItems, superadminItems } = useNavItems(!!user, isApproved, user?.id)
  const messagingOn = messagingFeatureEnabled(user?.id)
  const unreadMessages = useUnreadTotal()

  // Auto-activate admin mode when navigating to /admin/* routes
  useEffect(() => {
    if (isAdmin && location.pathname.startsWith('/admin') && !isAdminMode) {
      setAdminMode(true)
    }
  }, [location.pathname, isAdmin, isAdminMode, setAdminMode])
  const { data: memberTeamsRaw } = useCollection<ExpandedMemberTeam>('member_teams', {
    // Current-season only — otherwise archived same-name teams (e.g. old + new
    // "H3" after a rollover) render as duplicate badges in the user card.
    filter: user ? { _and: [{ member: { _eq: user.id } }, { season: { _eq: getCurrentSeason() } }] } : undefined,
    fields: ['*', 'team.*'],
    limit: 10,
    enabled: !!user && !isLoading,
  })
  const memberTeams = memberTeamsRaw ?? []

  // Block rendering until auth + role context fully loads (prevents flash
  // where pages render before memberTeamIds/coachTeamIds are available)
  if ((isLoading || teamsLoading) && isAuthenticated()) {
    return <LoadingSpinner />
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* Backdrop overlay when sidebar is expanded — fades in/out with sidebar */}
      {isDesktop && (
        <div
          className={`fixed inset-0 z-30 bg-black/30 transition-opacity duration-300 ${
            sidebarExpanded ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          onClick={() => setSidebarView('closed')}
        />
      )}

      {/* Desktop sidebar */}
      {isDesktop && (
        <>
          {/* Collapsed rail — always visible */}
          <div
            className={`flex w-16 shrink-0 flex-col items-center py-4 shadow-lg ${
              theme === 'light' ? 'bg-white' : 'bg-brand-900 dark:bg-brand-950'
            }`}
          >
            <button
              onClick={() => setSidebarView('nav')}
              className="rounded-lg p-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-brand-800 [perspective:600px]"
            >
              <img
                src={theme === 'light' ? '/wiedisync_blau.png' : '/wiedisync_weiss.png'}
                alt="Wiedisync"
                className={`h-8 w-auto transition-transform duration-500 ease-out ${
                  sidebarExpanded ? '[transform:rotateY(360deg)]' : ''
                }`}
              />
            </button>
            {user && isApproved && (
              <NotificationBell
                unreadCount={unreadCount}
                onClick={() => setSidebarView(sidebarView === 'notifications' ? 'closed' : 'notifications')}
                className="mt-4"
              />
            )}
          </div>

          {/* Expanded sidebar — overlays on top */}
          <aside
            className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col shadow-lg transition-transform duration-300 ease-out ${
              sidebarExpanded ? 'translate-x-0' : '-translate-x-full'
            } ${theme === 'light' ? 'bg-white' : 'bg-brand-900 dark:bg-brand-950'}`}
          >
            {sidebarView === 'notifications' ? (
              <SidebarNotifications
                notifications={notifications}
                unreadCount={unreadCount}
                onMarkAsRead={markAsRead}
                onMarkAllAsRead={markAllAsRead}
                onDelete={deleteNotification}
                onClearRead={clearAllRead}
                onBack={() => setSidebarView('nav')}
                onCloseSidebar={() => setSidebarView('closed')}
                theme={theme}
              />
            ) : (
            <>
            <div className={`flex h-16 items-center gap-3 border-b px-6 ${
              theme === 'light' ? 'border-gray-200' : 'border-brand-800'
            }`}>
              <button
                onClick={() => setSidebarView('closed')}
                className="rounded-lg p-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-brand-800 [perspective:600px]"
              >
                <img
                  src={theme === 'light' ? '/wiedisync_blau.png' : '/wiedisync_weiss.png'}
                  alt="Wiedisync"
                  className={`h-8 w-auto transition-transform duration-500 ease-out ${
                    sidebarExpanded ? '' : '[transform:rotateY(360deg)]'
                  }`}
                />
              </button>
            </div>

            <nav data-tour="nav-sidebar" className="flex-1 overflow-y-auto p-4">
              <ul className="space-y-1">
                {navItems.map((item) => {
                  const showBadge = messagingOn && item.to === '/inbox' && unreadMessages > 0
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        onClick={() => setSidebarView('closed')}
                        className={({ isActive }) =>
                          `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                            theme === 'light'
                              ? isActive
                                ? 'bg-brand-50 text-brand-700'
                                : 'text-gray-700 hover:bg-gray-100'
                              : isActive
                                ? 'border-l-3 border-gold-400 bg-brand-800 text-gold-400'
                                : 'text-gray-300 hover:bg-brand-800 hover:text-white'
                          }`
                        }
                        end={item.to === '/'}
                      >
                        <span className="relative flex items-center gap-3">
                          {item.icon}
                          {item.label}
                          {showBadge && (
                            <span
                              className="absolute -top-1 -right-2 rounded-full bg-primary text-primary-foreground text-[10px] leading-none px-1.5 py-0.5 min-w-[18px] text-center"
                              aria-label={`${unreadMessages} ungelesene Nachrichten`}
                            >
                              {unreadMessages > 99 ? '99+' : unreadMessages}
                            </span>
                          )}
                        </span>
                      </NavLink>
                    </li>
                  )
                })}
              </ul>

              {isAdminMode && (
                <>
                  <div className={`my-3 border-t ${
                    theme === 'light' ? 'border-gray-200' : 'border-brand-800'
                  }`} />
                  <p className={`mb-1 px-3 text-xs font-semibold uppercase tracking-wider ${
                    theme === 'light' ? 'text-gray-400' : 'text-gray-500'
                  }`}>
                    Admin
                  </p>
                  <ul className="space-y-1">
                    {adminItems.map((item) => (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          onClick={() => setSidebarView('closed')}
                          className={({ isActive }) =>
                            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                              theme === 'light'
                                ? isActive
                                  ? 'bg-brand-50 text-brand-700'
                                  : 'text-gray-700 hover:bg-gray-100'
                                : isActive
                                  ? 'border-l-3 border-gold-400 bg-brand-800 text-gold-400'
                                  : 'text-gray-300 hover:bg-brand-800 hover:text-white'
                            }`
                          }
                        >
                          {item.icon}
                          {item.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {isAdminMode && isSuperAdmin && (
                <>
                  <div className={`my-3 border-t ${
                    theme === 'light' ? 'border-gray-200' : 'border-brand-800'
                  }`} />
                  <p className={`mb-1 px-3 text-xs font-semibold uppercase tracking-wider ${
                    theme === 'light' ? 'text-gray-400' : 'text-gray-500'
                  }`}>
                    {t('superadmin')}
                  </p>
                  <ul className="space-y-1">
                    {superadminItems.map((item) => (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          onClick={() => setSidebarView('closed')}
                          className={({ isActive }) =>
                            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                              theme === 'light'
                                ? isActive
                                  ? 'bg-brand-50 text-brand-700'
                                  : 'text-gray-700 hover:bg-gray-100'
                                : isActive
                                  ? 'border-l-3 border-gold-400 bg-brand-800 text-gold-400'
                                  : 'text-gray-300 hover:bg-brand-800 hover:text-white'
                            }`
                          }
                        >
                          {item.icon}
                          {item.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </nav>

            <div className={`space-y-3 border-t p-4 ${
              theme === 'light' ? 'border-gray-200' : 'border-brand-800'
            }`}>
              <NavLink
                to="/guide"
                data-tour="nav-guide"
                onClick={() => setSidebarView('closed')}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    theme === 'light'
                      ? isActive
                        ? 'bg-brand-50 text-brand-700'
                        : 'text-gray-700 hover:bg-gray-100'
                      : isActive
                        ? 'bg-brand-800 text-gold-400'
                        : 'text-gray-300 hover:bg-brand-800 hover:text-white'
                  }`
                }
              >
                <GraduationCap className="h-5 w-5" />
                {t('guide')}
              </NavLink>
              <div data-tour="nav-settings">
                <SidebarOptions isAdmin={isAdmin} theme={theme} toggleTheme={toggleTheme} onClose={() => setSidebarView('closed')} memberId={user?.id} />
              </div>

              {user ? (
                <div className="space-y-2">
                  <NavLink
                    to="/profile"
                    data-tour="nav-profile"
                    onClick={() => setSidebarView('closed')}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        theme === 'light'
                          ? isActive
                            ? 'bg-brand-50 text-brand-700'
                            : 'text-gray-700 hover:bg-gray-100'
                          : isActive
                            ? 'bg-brand-800 text-gold-400'
                            : 'text-gray-300 hover:bg-brand-800 hover:text-white'
                      }`
                    }
                  >
                    {user.photo ? (
                      <img
                        src={getFileUrl('members', user.id, user.photo)}
                        alt=""
                        className="h-7 w-7 rounded-full object-cover"
                      />
                    ) : (
                      <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                        theme === 'light'
                          ? 'bg-gray-200 text-gray-500'
                          : 'bg-brand-800 text-gray-400'
                      }`}>
                        {`${user.first_name?.[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="block truncate">{user.first_name} {user.last_name}</span>
                      {memberTeams.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {memberTeams.map((mt) => (
                            <TeamChip key={mt.id} team={asObj<Team>(mt.team)?.name ?? '?'} size="sm" />
                          ))}
                        </div>
                      )}
                    </div>
                  </NavLink>
                  <button
                    onClick={logout}
                    className={`w-full rounded-lg px-3 py-1.5 text-left text-sm ${
                      theme === 'light'
                        ? 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                        : 'text-gray-400 hover:bg-brand-800 hover:text-white'
                    }`}
                  >
                    {t('logout')}
                  </button>
                </div>
              ) : (
                <NavLink
                  to="/login"
                  onClick={() => setSidebarView('closed')}
                  className={`block rounded-lg px-3 py-2 text-center text-sm font-medium ${
                    theme === 'light'
                      ? 'text-brand-600 hover:bg-gray-100 hover:text-brand-800'
                      : 'text-gold-400 hover:bg-brand-800 hover:text-gold-300'
                  }`}
                >
                  {t('signIn')}
                </NavLink>
              )}
            </div>
            </>
            )}
          </aside>
        </>
      )}

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className={`flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8 ${
          !isDesktop ? 'pb-24' : ''
        }`}>
          {isAdminMode && (
            <div
              className="
                -mx-4 -mt-4 mb-4 border-x border-b border-t-2 border-gold-400 bg-gold-50 px-4 py-1 text-center text-xs font-semibold uppercase tracking-wider text-gold-700
                sm:-mx-6 sm:-mt-6
                lg:-mx-8 lg:-mt-8
                dark:bg-brand-900/50 dark:text-gold-300
              "
            >
              {t('adminMode')}
            </div>
          )}
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      {!isDesktop && (
        <BottomTabBar
          onMoreTap={() => setMoreOpen(true)}
          moreActive={moreOpen}
          unreadNotifications={unreadCount}
        />
      )}

      {/* More sheet */}
      {moreOpen && (
        <MoreSheet
          onClose={() => setMoreOpen(false)}
          unreadNotifications={unreadCount}
          onOpenNotifications={() => { setMoreOpen(false); setNotifPanelOpen(true) }}
          memberTeams={memberTeams}
        />
      )}

      {/* Notification panel */}
      {notifPanelOpen && (
        <NotificationPanel
          notifications={notifications}
          unreadCount={unreadCount}
          onMarkAsRead={markAsRead}
          onMarkAllAsRead={markAllAsRead}
          onDelete={deleteNotification}
          onClearRead={clearAllRead}
          onClose={() => setNotifPanelOpen(false)}
        />
      )}

      {/* Onboarding modal — non-dismissable, shown once until profile is complete */}
      {user && isApproved && !isProfileComplete && (
        <ProfileEditModal
          open
          onClose={() => {}}
          onboarding
        />
      )}

      {/* Messaging consent modal mounts at the messaging entry points
          (InboxPage, ConversationPage, TeamMessagesTab), not globally,
          so users only see it when they actually engage with messaging. */}
    </div>
  )
}

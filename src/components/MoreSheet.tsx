import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import TeamChip from './TeamChip'
import SwitchToggle from '@/components/SwitchToggle'
import LanguageDropdown from '@/components/LanguageDropdown'
import { getFileUrl } from '../utils/fileUrl'
import AdminToggle from './AdminToggle'
import { Bell, UserX, PenSquare, PartyPopper, Building2, CalendarClock, HeartPulse, LogIn, User, Users, Settings, ChevronDown, ScrollText, MessageSquare, MessageCircle, Inbox, Mail, Banknote, BarChart3, UserPlus, Bug, Activity, GraduationCap, Database, Megaphone, Newspaper, Flag, Terminal, Gavel, Wallet, Landmark, ReceiptText, FileWarning, ClipboardList, FolderSync, ArrowRightLeft, Coffee } from 'lucide-react'
import type { MemberTeam, Team } from '../types'
import { asObj, memberDisplayName } from '../utils/relations'
import { messagingFeatureEnabled } from '../utils/messagingFeatureFlag'
import { SCHEDULING_ORIGIN } from '../lib/api'
import { handlePWAExternalClick } from '../utils/pwa'
import { APP_VERSION } from '../modules/changelog/ChangelogPage'
import { useDonateVisible } from '../modules/support/donateConfig'

type ExpandedMemberTeam = MemberTeam & { team: Team | string }

/** Animated close: plays exit animation, then calls onClose after it finishes */
function useAnimatedClose(onClose: () => void) {
  const [closing, setClosing] = useState(false)
  const startClose = useCallback(() => {
    setClosing(true)
  }, [])
  const onAnimEnd = useCallback(() => {
    if (closing) onClose()
  }, [closing, onClose])
  return { closing, startClose, onAnimEnd }
}

const iconClass = 'h-5 w-5'

interface SheetItem { to: string; labelKey: string; icon: ReactNode; external?: boolean; href?: string }

function buildSecondaryItems(
  memberId: number | string | undefined | null,
  sched: { isAdmin: boolean; isVorstand: boolean; canAccessFinance: boolean; is_spielplaner: boolean; spielplanerTeamIds: string[]; coachTeamIds: string[]; teamResponsibleIds: string[]; canManageForms: boolean },
): { primary: SheetItem[]; memberTools: SheetItem[]; finance: SheetItem[]; spielplaner: SheetItem[] } {
  // Primary = items NOT already on the bottom tab bar (Home/Calendar/Games/
  // Trainings live there); shown ungrouped at the top of the sheet.
  const primary: SheetItem[] = [
    { to: '/events', labelKey: 'events', icon: <PartyPopper className={iconClass} /> },
  ]
  // Member tools — grouped under one header. Forms is here (author-only; gated);
  // News (the read feed) lives here too.
  const memberTools: SheetItem[] = [
    { to: '/teams', labelKey: 'teams', icon: <Users className={iconClass} /> },
    { to: '/absences', labelKey: 'absences', icon: <UserX className={iconClass} /> },
    { to: '/scorer', labelKey: 'scorer', icon: <PenSquare className={iconClass} /> },
    ...(messagingFeatureEnabled(memberId)
      ? [{ to: '/inbox', labelKey: 'inbox', icon: <Inbox className={iconClass} /> }]
      : []),
    ...(sched.canManageForms ? [{ to: '/forms', labelKey: 'forms', icon: <ScrollText className={iconClass} /> }] : []),
    // J+S export — coaches and above (same audience as Forms authoring).
    ...(sched.canManageForms ? [{ to: '/js-export', labelKey: 'jsExport', icon: <GraduationCap className={iconClass} /> }] : []),
    { to: '/news', labelKey: 'news', icon: <Newspaper className={iconClass} /> },
  ]
  // Finance — own section (mirrors useNavItems): personal dues, fines, expense
  // upload (all members), board club-finances dashboard (Vorstand only).
  const finance: SheetItem[] = [
    { to: '/finance/dues', labelKey: 'finance:myDuesTitle', icon: <Wallet className={iconClass} /> },
    { to: '/fines', labelKey: 'fines', icon: <Gavel className={iconClass} /> },
    { to: '/finance/expense', labelKey: 'uploadInvoice', icon: <ReceiptText className={iconClass} /> },
    ...(sched.canAccessFinance ? [{ to: '/admin/finance', labelKey: 'finance:title', icon: <Landmark className={iconClass} /> }] : []),
  ]
  // Spielplaner tools — the whole game-scheduling feature opens as ONE "Planning"
  // entry (mirrors `useNavItems` / the desktop top nav); it has its own in-app
  // nav once you're in it. Game scheduling lives on its own subdomain, so link
  // out when SCHEDULING_ORIGIN differs from the current origin (SSO makes it
  // seamless), else stay in-app. Full & club Spielplaner land on Match
  // scheduling; a per-team Spielplaner who can't reach it lands on the manual
  // game calendar — and so do coaches/TRs (read-only planner view in v1).
  const schedExternal = typeof window !== 'undefined' && SCHEDULING_ORIGIN.replace(/\/$/, '') !== window.location.origin
  const hasSchedulingAccess =
    sched.isAdmin || sched.is_spielplaner || sched.spielplanerTeamIds.length > 0 ||
    sched.coachTeamIds.length > 0 || sched.teamResponsibleIds.length > 0
  const schedTo = sched.isAdmin || sched.is_spielplaner ? '/admin/terminplanung' : '/admin/spielplanung'
  const spielplaner: SheetItem[] = hasSchedulingAccess
    ? [{ to: schedTo, href: `${SCHEDULING_ORIGIN}${schedTo}`, external: schedExternal, labelKey: 'spielplanung', icon: <CalendarClock className={iconClass} /> }]
    : []
  return { primary, memberTools, finance, spielplaner }
}

interface NavItem { to: string; labelKey: string; icon: ReactNode }

// Admin tools grouped into labeled sections — mirrors useNavItems.adminGroups
// (desktop dropdown). Keep the two in sync when adding admin pages.
//
// Items are gated INDIVIDUALLY, not by one section-wide isAdmin: every entry
// here is AdminRoute-guarded (isAdmin) except the club mailbox, which is
// GlobalAdminRoute-guarded (isGlobalAdmin = admin || superuser) to mirror the
// server's authForAccount('admin'). isAdmin is the WIDER set — it also contains
// vb_admin / bb_admin, whom the server 403s on the mailbox — so the two cannot
// share a gate. Empty groups are dropped so nobody sees a section of links that
// would bounce them back to '/'.
function buildAdminGroups(
  { isAdmin, isGlobalAdmin }: { isAdmin: boolean; isGlobalAdmin: boolean },
): Array<{ labelKey: string; items: NavItem[] }> {
  return [
    {
      labelKey: 'adminGroupPlanning',
      items: [
        ...(isAdmin ? [{ to: '/admin/hallenplan', labelKey: 'hallenplan', icon: <Building2 className={iconClass} /> }] : []),
        ...(isAdmin ? [{ to: '/admin/hallenfinder', labelKey: 'hallenfinder', icon: <CalendarClock className={iconClass} /> }] : []),
      ],
    },
    {
      labelKey: 'adminGroupGames',
      items: [
        ...(isAdmin ? [
          { to: '/admin/scorer-assign', labelKey: 'scorerAssign', icon: <ClipboardList className={iconClass} /> },
          { to: '/admin/vb-referees', labelKey: 'vbReferees', icon: <Gavel className={iconClass} /> },
          { to: '/admin/referee-expenses', labelKey: 'refereeExpenses', icon: <Banknote className={iconClass} /> },
        ] : []),
      ],
    },
    {
      labelKey: 'adminGroupMembers',
      items: [
        ...(isAdmin ? [
          { to: '/admin/anmeldungen', labelKey: 'anmeldungen', icon: <UserPlus className={iconClass} /> },
          // International transfers (AdminRoute). Mirrors useNavItems — the label
          // lives in the `admin` namespace with the rest of the page's strings,
          // so it carries the `admin:` prefix like the finance items above.
          { to: '/admin/transfers', labelKey: 'admin:trNavTransfers', icon: <ArrowRightLeft className={iconClass} /> },
          { to: '/admin/announcements', labelKey: 'announcements', icon: <Megaphone className={iconClass} /> },
        ] : []),
        // Club mailbox: admin||superuser only — mirrors the server's
        // authForAccount('admin'). NOT isAdmin (includes vb/bb admins, whom the
        // server 403s) and NOT isVorstand (board was rejected).
        ...(isGlobalAdmin ? [{ to: '/admin/mailbox', labelKey: 'clubMailbox', icon: <Mail className={iconClass} /> }] : []),
        ...(isAdmin ? [
          { to: '/admin/reports', labelKey: 'moderationReports', icon: <Flag className={iconClass} /> },
          { to: '/admin/volley-feedback', labelKey: 'volleyFeedback', icon: <MessageSquare className={iconClass} /> },
        ] : []),
      ],
    },
    {
      labelKey: 'adminGroupData',
      items: [
        ...(isAdmin ? [
          { to: '/admin/explore', labelKey: 'adminExplorer', icon: <Database className={iconClass} /> },
          { to: '/admin/club-stats', labelKey: 'clubStats', icon: <BarChart3 className={iconClass} /> },
        ] : []),
      ],
    },
  ].filter((g) => g.items.length > 0)
}

const superAdminItems: NavItem[] = [
  { to: '/admin/data-health', labelKey: 'dataHealth', icon: <HeartPulse className={iconClass} /> },
  { to: '/admin/clubdesk-sync', labelKey: 'clubdeskSync', icon: <FolderSync className={iconClass} /> },
  { to: '/admin/infra', labelKey: 'infraHealth', icon: <Activity className={iconClass} /> },
  { to: '/admin/audit-log', labelKey: 'auditLog', icon: <ScrollText className={iconClass} /> },
  { to: '/admin/error-logs', labelKey: 'errorLogs', icon: <FileWarning className={iconClass} /> },
  { to: '/admin/sql', labelKey: 'sqlWorkspace', icon: <Terminal className={iconClass} /> },
  { to: '/bugfixes', labelKey: 'bugfixes', icon: <Bug className={iconClass} /> },
]

function OptionsAccordion({ theme, toggleTheme, onClose, memberId }: { theme: string; toggleTheme: () => void; onClose?: () => void; memberId?: number | string | null }) {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation('nav')
  const { t: tSupport } = useTranslation('support')
  const donateVisible = useDonateVisible()

  return (
    <div className="px-4 py-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
      >
        <Settings className="h-5 w-5" />
        <span className="flex-1 text-left">{t('options', 'Options')}</span>
        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          <div className="py-1">
            {/* Dark mode row */}
            <div className="flex min-h-[48px] items-center justify-between rounded-lg px-4 py-3">
              <span className="text-base font-medium text-gray-700 dark:text-gray-300">{t('darkMode', 'Dark mode')}</span>
              <SwitchToggle
                enabled={theme === 'dark'}
                onChange={toggleTheme}
                size="sm"
                ariaLabel={theme === 'dark' ? t('switchToLight') : t('switchToDark')}
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
            {/* Language row */}
            <div className="flex min-h-[48px] items-center justify-between rounded-lg px-4 py-3">
              <span className="text-base font-medium text-gray-700 dark:text-gray-300">{t('language', 'Language')}</span>
              <LanguageDropdown size="sm" />
            </div>
            {/* Admin toggle row */}
            <div className="flex min-h-[48px] items-center justify-between rounded-lg px-4 py-3">
              <span className="text-base font-medium text-gray-700 dark:text-gray-300">{t('adminMode', 'Admin mode')}</span>
              <AdminToggle size="sm" onAfterToggle={onClose} />
            </div>
            {/* Feedback row */}
            <NavLink
              to="/feedback"
              onClick={onClose}
              className={({ isActive }) =>
                `flex min-h-[48px] items-center gap-3 rounded-lg px-4 py-3 transition-colors ${
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-gold-400'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                }`
              }
            >
              <MessageSquare className="h-4 w-4" />
              <span className="text-base font-medium">{t('feedback')}</span>
            </NavLink>
            {/* Status page row */}
            <NavLink
              to="/status"
              onClick={onClose}
              className={({ isActive }) =>
                `flex min-h-[48px] items-center gap-3 rounded-lg px-4 py-3 transition-colors ${
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-gold-400'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                }`
              }
            >
              <Activity className="h-4 w-4" />
              <span className="text-base font-medium">{t('status', 'Status')}</span>
            </NavLink>
            {/* Version / Changelog row */}
            <NavLink
              to="/changelog"
              onClick={onClose}
              className="flex min-h-[48px] items-center justify-between rounded-lg px-4 py-3 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <span className="flex items-center gap-2 text-base font-medium text-gray-700 dark:text-gray-300">
                <ScrollText className="h-4 w-4" />
                {t('whatsNew', "What's New")}
              </span>
              <span className="text-xs font-mono text-gray-400 dark:text-gray-500">v{APP_VERSION}</span>
            </NavLink>
            {/* Support-the-developer row — personal, not a club channel. Hidden
                for under-18s and while impersonating (see useDonateVisible). */}
            {donateVisible && (
              <NavLink
                to="/support"
                onClick={onClose}
                className={({ isActive }) =>
                  `flex min-h-[48px] items-center gap-3 rounded-lg px-4 py-3 transition-colors ${
                    isActive
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-gold-400'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`
                }
              >
                <Coffee className="h-4 w-4" />
                <span className="text-base font-medium">{tSupport('menuLabel')}</span>
              </NavLink>
            )}
            {/* Messaging settings row */}
            {messagingFeatureEnabled(memberId) && (
              <NavLink
                to="/options/messaging"
                onClick={onClose}
                className={({ isActive }) =>
                  `flex min-h-[48px] items-center gap-3 rounded-lg px-4 py-3 transition-colors ${
                    isActive
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-gold-400'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`
                }
              >
                <MessageCircle className="h-4 w-4" />
                <span className="text-base font-medium">{t('messagingSettings')}</span>
              </NavLink>
            )}
            {/* Guide row */}
            <NavLink
              to="/guide"
              onClick={onClose}
              className={({ isActive }) => `flex min-h-[48px] items-center gap-2 rounded-lg px-4 py-3 transition-colors ${
                isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-gold-400' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
              data-tour="nav-guide"
            >
              <GraduationCap className="h-4 w-4" />
              <span className="text-base font-medium">{t('guide')}</span>
            </NavLink>
          </div>
        </div>
      </div>
    </div>
  )
}

interface MoreSheetProps {
  onClose: () => void
  unreadNotifications?: number
  onOpenNotifications?: () => void
  memberTeams?: ExpandedMemberTeam[]
}

export default function MoreSheet({ onClose, unreadNotifications = 0, onOpenNotifications, memberTeams = [] }: MoreSheetProps) {
  const { user, isApproved, isAdmin, isGlobalAdmin, isSuperAdmin, isVorstand, canAccessFinance, is_spielplaner, spielplanerTeamIds, coachTeamIds, teamResponsibleIds, logout } = useAuth()
  const canManageForms = isAdmin || isVorstand || coachTeamIds.length > 0 || teamResponsibleIds.length > 0
  const adminGroups = buildAdminGroups({ isAdmin, isGlobalAdmin })
  const { theme, toggleTheme } = useTheme()
  const { t } = useTranslation('nav')
  const { t: tn } = useTranslation('notifications')
  const { closing, startClose, onAnimEnd } = useAnimatedClose(onClose)

  // Shared renderer for the internal admin/superadmin NavLinks — identical markup
  // per item, so drive both sections off their arrays instead of copy-pasting.
  const renderNavItem = (item: NavItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      onClick={startClose}
      className={({ isActive }) =>
        `flex min-h-[48px] items-center gap-4 rounded-lg px-4 py-3 text-base font-medium transition-colors ${
          isActive
            ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-gold-400'
            : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
        }`
      }
    >
      {item.icon}
      {t(item.labelKey)}
    </NavLink>
  )

  // Swipe-down-to-close: matches NotificationPanel + the Vaul-based detail
  // modals (Training/Game/Event). Drag is only consumed when the inner scroll
  // is at the top, so a downward swipe in the middle of a long admin nav
  // still scrolls the list normally.
  const scrollRef = useRef<HTMLDivElement>(null)
  const [dragY, setDragY] = useState(0)
  const touchStart = useRef<{ y: number; scrollTop: number } | null>(null)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const el = scrollRef.current
    if (!el) return
    touchStart.current = { y: e.touches[0].clientY, scrollTop: el.scrollTop }
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStart.current) return
    const dy = e.touches[0].clientY - touchStart.current.y
    if (touchStart.current.scrollTop <= 0 && dy > 0) {
      setDragY(dy)
      e.preventDefault()
    }
  }, [])

  const onTouchEnd = useCallback(() => {
    if (dragY > 100) {
      startClose()
    }
    setDragY(0)
    touchStart.current = null
  }, [dragY, startClose])

  // Prevent body scroll when sheet is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50" onClick={startClose}>
      {/* Backdrop */}
      <div className={`absolute inset-0 bg-black/50 ${closing ? 'animate-fade-out' : 'animate-fade-in'}`} />

      {/* Sheet — animation lives on this wrapper; scrolling lives on the inner
          container so iOS Safari doesn't lose touch-scroll when the parent
          carries an active transform from the slide-up keyframes. */}
      <div
        className={`absolute bottom-0 left-0 right-0 flex max-h-[85vh] flex-col rounded-t-2xl bg-white dark:bg-gray-800 ${closing ? 'animate-sheet-down' : 'animate-sheet-up'}`}
        style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={(e) => { if (e.target === e.currentTarget) onAnimEnd() }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Close row — the entire top strip is one big tap target. The visual
            handle bar in the middle is part of the same button so tapping it
            also dismisses (no more "is this thing interactive?" guessing). */}
        <button
          type="button"
          onClick={startClose}
          aria-label={t('close', { defaultValue: 'Close' })}
          className="relative flex shrink-0 items-center justify-center rounded-t-2xl bg-white pb-2 pt-3 transition-colors hover:bg-gray-50 active:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700/60 dark:active:bg-gray-700"
        >
          <span className="h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />
          <span className="absolute right-3 top-1.5 inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 dark:text-gray-500">
            <ChevronDown className="h-5 w-5" />
          </span>
        </button>

        {/* Scrollable body — ref drives the swipe-from-top scrollTop check */}
        <div ref={scrollRef} className="pb-safe flex-1 overflow-y-auto overscroll-contain">

        {/* Nav items */}
        <nav className="px-4 pb-2">
          {/* Notifications row */}
          {user && isApproved && onOpenNotifications && (
            <>
              <button
                onClick={onOpenNotifications}
                className="flex min-h-[48px] w-full items-center gap-4 rounded-lg px-4 py-3 text-base font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <div className="relative">
                  <Bell className={iconClass} />
                  {unreadNotifications > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-bold text-white">
                      <span aria-hidden="true">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>
                      <span className="sr-only">{tn('unreadBadge', { count: unreadNotifications })}</span>
                    </span>
                  )}
                </div>
                {t('notifications')}
              </button>
              <div className="my-2 border-t border-gray-200 dark:border-gray-700" />
            </>
          )}
          {(!user || !isApproved) ? null : (() => {
            const groups = buildSecondaryItems(user.id, { isAdmin, isVorstand, canAccessFinance, is_spielplaner, spielplanerTeamIds, coachTeamIds, teamResponsibleIds, canManageForms })
            const renderItem = (item: SheetItem) => (
              item.external ? (
                <a
                  key={item.to}
                  href={item.href}
                  onClick={(e) => { handlePWAExternalClick(e, item.href!); startClose() }}
                  className="flex min-h-[48px] items-center gap-4 rounded-lg px-4 py-3 text-base font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  {item.icon}
                  {t(item.labelKey)}
                </a>
              ) : (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={startClose}
                  className={({ isActive }) =>
                    `flex min-h-[48px] items-center gap-4 rounded-lg px-4 py-3 text-base font-medium transition-colors ${
                      isActive
                        ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-gold-400'
                        : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`
                  }
                >
                  {item.icon}
                  {t(item.labelKey)}
                </NavLink>
              )
            )
            return (
              <>
                {groups.primary.map(renderItem)}
                {groups.memberTools.length > 0 && (
                  <>
                    <div className="my-2 border-t border-gray-200 dark:border-gray-700" />
                    <p className="mb-1 px-4 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                      {t('memberTools')}
                    </p>
                    {groups.memberTools.map(renderItem)}
                  </>
                )}
                {groups.finance.length > 0 && (
                  <>
                    <div className="my-2 border-t border-gray-200 dark:border-gray-700" />
                    <p className="mb-1 px-4 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                      {t('finance')}
                    </p>
                    {groups.finance.map(renderItem)}
                  </>
                )}
                {groups.spielplaner.length > 0 && (
                  <>
                    {/* No section header — the single "Planning" item is already
                        self-describing (a "Planning" header would just repeat it). */}
                    <div className="my-2 border-t border-gray-200 dark:border-gray-700" />
                    {groups.spielplaner.map(renderItem)}
                  </>
                )}
              </>
            )
          })()}

          {/* Admin/Superadmin nav gated on ROLE, not the toggle — the navbar is
              always complete for privileged users; the admin-mode toggle only
              changes data scope. Routes enforce the same raw-role gate.
              Gated on the built groups (not isAdmin) so a plain vorstand still
              gets the section for the club mailbox alone. */}
          {adminGroups.length > 0 && (
            <>
              <div className="my-2 border-t border-gray-200 dark:border-gray-700" />
              <p className="mb-1 px-4 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                {t('admin')}
              </p>
              {adminGroups.map((g) => (
                <div key={g.labelKey}>
                  <p className="mb-0.5 mt-2 px-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400/80 dark:text-gray-500/80">
                    {t(g.labelKey)}
                  </p>
                  {g.items.map(renderNavItem)}
                </div>
              ))}
            </>
          )}

          {isSuperAdmin && (
            <>
              <div className="my-2 border-t border-gray-200 dark:border-gray-700" />
              <p className="mb-1 px-4 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                {t('superadmin')}
              </p>
              {superAdminItems.map(renderNavItem)}
            </>
          )}
        </nav>

        {/* Divider */}
        <div className="mx-4 border-t border-gray-200 dark:border-gray-700" />

        {/* User section */}
        {user ? (
          <>
            <div className="px-4 py-3">
              {/* Profile link + name + teams — whole row opens profile */}
              <div className="flex items-center gap-3">
                <NavLink
                  to="/profile"
                  onClick={startClose}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg -mx-2 px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-700"
                  aria-label={t('myProfile')}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
                    {user.photo ? (
                      <img
                        src={getFileUrl('members', user.id, user.photo)}
                        alt=""
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    ) : (
                      <User className={iconClass} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {memberDisplayName(user)}
                    </span>
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
                  onClick={() => {
                    logout()
                    startClose()
                  }}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  {t('logout')}
                </button>
              </div>
            </div>

            {/* Options section — expandable */}
            <div className="mx-4 border-t border-gray-200 dark:border-gray-700" />
            <OptionsAccordion theme={theme} toggleTheme={toggleTheme} onClose={startClose} memberId={user?.id} />
          </>
        ) : (
          <>
            <div className="px-4 py-3 space-y-3">
              {/* Sign in — own row */}
              <NavLink
                to="/login"
                onClick={startClose}
                className="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-base font-medium text-brand-600 transition-colors hover:bg-gray-100 dark:text-gold-400 dark:hover:bg-gray-700"
              >
                <LogIn className={iconClass} />
                {t('signIn')}
              </NavLink>

              {/* Toggles — expandable */}
              <OptionsAccordion theme={theme} toggleTheme={toggleTheme} onClose={startClose} memberId={null} />
            </div>
          </>
        )}

        {/* Legal links */}
        <div className="mx-4 border-t border-gray-200 dark:border-gray-700" />
        <div className="flex items-center justify-center gap-3 px-4 py-3 text-xs text-gray-400 dark:text-gray-500">
          <NavLink to="/datenschutz" onClick={startClose} className="hover:text-gray-600 dark:hover:text-gray-300">
            {t('privacy')}
          </NavLink>
          <span>·</span>
          <NavLink to="/impressum" onClick={startClose} className="hover:text-gray-600 dark:hover:text-gray-300">
            {t('impressum')}
          </NavLink>
        </div>
        </div>
      </div>
    </div>
  )
}

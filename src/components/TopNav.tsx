import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown, Settings, MessageSquare, MessageCircle, Activity, ScrollText, GraduationCap, LogOut, User as UserIcon, Coffee, ArrowRight, LayoutGrid,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useDonateVisible } from '../modules/support/donateConfig'
import { useTheme } from '../hooks/useTheme'
import { useNavItems, type NavItem } from '../hooks/useNavItems'
import { useUnreadTotal } from '../modules/messaging/hooks/useUnreadTotal'
import { messagingFeatureEnabled } from '../utils/messagingFeatureFlag'
import { getFileUrl } from '../utils/fileUrl'
import { asObj, memberDisplayName, memberFirstName } from '../utils/relations'
import { openExternalApp, handlePWAExternalClick } from '../utils/pwa'
import type { MemberTeam, Team } from '../types'
import { APP_VERSION } from '../modules/changelog/ChangelogPage'
import NotificationBell from './NotificationBell'
import AdminToggle from './AdminToggle'
import SwitchToggle from '@/components/SwitchToggle'
import LanguageDropdown from '@/components/LanguageDropdown'
import TeamChip from './TeamChip'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'

type ExpandedMemberTeam = MemberTeam & { team: Team | string }

interface TopNavProps {
  unreadCount: number
  onOpenNotifications: () => void
  memberTeams: ExpandedMemberTeam[]
}

const TRIGGER_ACTIVE = 'bg-brand-50 text-brand-700 dark:bg-brand-800 dark:text-gold-400'
const SECTION_LABEL = 'text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500'
const TRIGGER_IDLE = 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-brand-800 dark:hover:text-white'

function pathMatches(pathname: string, to: string) {
  if (to === '/') return pathname === '/'
  return pathname === to || pathname.startsWith(to + '/')
}

/** A grouped top-nav category that opens a dropdown of its items. */
function NavCategory({
  label, items, groups, extra, extraLabel, footerItem, wide, messagingOn, unreadMessages,
}: {
  label: string
  /** Flat item list — mutually exclusive with `groups`. */
  items?: NavItem[]
  /** Labeled sections rendered with sub-headers (used by the Admin dropdown). */
  groups?: Array<{ label: string; items: NavItem[] }>
  extra?: NavItem[]
  extraLabel?: string
  /** Full-width link pinned to the bottom (the Admin dropdown's "/admin" hub). */
  footerItem?: NavItem
  /**
   * Mega-menu layout: sections flow into balanced CSS columns instead of one
   * scrolling stack. The Admin dropdown outgrew the single column (19 entries
   * across 6 sections needed a scrollbar on a 1080p screen).
   */
  wide?: boolean
  messagingOn: boolean
  unreadMessages: number
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const flat = groups ? groups.flatMap((g) => g.items) : (items ?? [])
  const all = [...flat, ...(extra ?? []), ...(footerItem ? [footerItem] : [])]
  const isActive = all.some((i) => i.to && pathMatches(location.pathname, i.to))
  const hasInboxBadge = messagingOn && unreadMessages > 0 && flat.some((i) => i.to === '/inbox')

  const go = (item: NavItem) => {
    // External hops (e.g. the Spielplanung subdomain) break out of an installed
    // PWA into the system browser instead of getting trapped in the standalone
    // window; in a normal tab `openExternalApp` navigates in place.
    if (item.external && item.href) openExternalApp(item.href)
    else navigate(item.to)
  }

  const renderItem = (item: NavItem) => {
    const active = pathMatches(location.pathname, item.to)
    const showBadge = messagingOn && item.to === '/inbox' && unreadMessages > 0
    return (
      <DropdownMenuItem
        key={item.to}
        onSelect={() => go(item)}
        className={`cursor-pointer gap-2.5 ${active ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-800 dark:text-gold-400' : ''}`}
      >
        {item.icon}
        <span className="flex-1">{item.label}</span>
        {showBadge && (
          <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary-foreground">
            {unreadMessages > 99 ? '99+' : unreadMessages}
          </span>
        )}
      </DropdownMenuItem>
    )
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          className={`relative flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? TRIGGER_ACTIVE : TRIGGER_IDLE}`}
        >
          {label}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          {hasInboxBadge && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={wide ? 'w-[48rem] max-w-[calc(100vw-1.5rem)] p-2' : 'min-w-[14rem]'}
      >
        {groups ? (
          wide ? (
            /* Balanced CSS columns: sections keep their own header and never split
               across a column boundary (break-inside-avoid). Arrow-key/typeahead
               navigation still follows DOM order, so grouping stays intact. */
            <div className="columns-3 gap-2 [column-fill:balance]">
              {groups.map((g) => (
                <div key={g.label} className="mb-2 break-inside-avoid">
                  <DropdownMenuLabel className={SECTION_LABEL}>{g.label}</DropdownMenuLabel>
                  {g.items.map(renderItem)}
                </div>
              ))}
            </div>
          ) : (
            groups.map((g, gi) => (
              <div key={g.label}>
                {gi > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className={SECTION_LABEL}>{g.label}</DropdownMenuLabel>
                {g.items.map(renderItem)}
              </div>
            ))
          )
        ) : (
          (items ?? []).map(renderItem)
        )}
        {extra && extra.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className={SECTION_LABEL}>{extraLabel}</DropdownMenuLabel>
            {wide ? (
              <div className="columns-3 gap-2">
                {extra.map((item) => (
                  <div key={item.to} className="break-inside-avoid">{renderItem(item)}</div>
                ))}
              </div>
            ) : (
              extra.map(renderItem)
            )}
          </>
        )}
        {footerItem && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => go(footerItem)}
              className="cursor-pointer justify-center gap-2 text-sm font-medium text-brand-700 dark:text-gold-400"
            >
              {footerItem.icon}
              {footerItem.label}
              <ArrowRight className="h-4 w-4" />
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default function TopNav({ unreadCount, onOpenNotifications, memberTeams }: TopNavProps) {
  const { t } = useTranslation('nav')
  const { t: tSupport } = useTranslation('support')
  const donateVisible = useDonateVisible()
  const { user, isAdmin, isApproved, isSuperAdmin, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const messagingOn = messagingFeatureEnabled(user?.id)
  const unreadMessages = useUnreadTotal()
  const [optionsOpen, setOptionsOpen] = useState(false)
  const { navItems, memberToolsItems, financeItems, schedulingItem, adminGroups, superadminItems } =
    useNavItems(!!user, isApproved, user?.id)

  // navItems[0] is always Home — it stays a direct link; the rest (Calendar,
  // Games, Trainings, Events) live under the "Activities" dropdown.
  const activityItems = navItems.slice(1)

  const iconBtn = 'rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-brand-800'
  const closeOptions = () => setOptionsOpen(false)

  const optLink = (to: string, icon: React.ReactNode, label: string) => (
    <NavLink
      to={to}
      onClick={closeOptions}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-brand-50 text-brand-700 dark:bg-brand-800 dark:text-gold-400'
            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-brand-800'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  )

  return (
    <header className="z-30 flex h-14 shrink-0 items-center gap-1 border-b border-gray-200 bg-white px-3 dark:border-brand-800 dark:bg-brand-950">
      {/* Logo → home */}
      <NavLink
        to="/"
        end
        className="mr-1 flex shrink-0 items-center rounded-lg p-1 transition-colors hover:bg-gray-100 dark:hover:bg-brand-800"
        aria-label="Wiedisync"
      >
        <img
          src={theme === 'light' ? '/wiedisync_blau.png' : '/wiedisync_weiss.png'}
          alt="Wiedisync"
          className="h-8 w-auto"
        />
      </NavLink>

      {/* Left: grouped categories */}
      <nav data-tour="nav-sidebar" className="flex items-center gap-0.5">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? TRIGGER_ACTIVE : TRIGGER_IDLE}`
          }
        >
          {t('home')}
        </NavLink>

        {activityItems.length > 0 && (
          <NavCategory label={t('activities')} items={activityItems} messagingOn={messagingOn} unreadMessages={unreadMessages} />
        )}
        {memberToolsItems.length > 0 && (
          <NavCategory label={t('memberTools')} items={memberToolsItems} messagingOn={messagingOn} unreadMessages={unreadMessages} />
        )}
        {financeItems.length > 0 && (
          <NavCategory label={t('finance')} items={financeItems} messagingOn={messagingOn} unreadMessages={unreadMessages} />
        )}
        {/* Game scheduling: non-admin Spielplaner get a direct top-level button;
            admins get it inside the Admin dropdown (leadingItem) instead. */}
        {schedulingItem && !isAdmin && (
          schedulingItem.external && schedulingItem.href ? (
            <a
              href={schedulingItem.href}
              onClick={(e) => handlePWAExternalClick(e, schedulingItem.href!)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${TRIGGER_IDLE}`}
            >
              {schedulingItem.label}
            </a>
          ) : (
            <NavLink
              to={schedulingItem.to}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? TRIGGER_ACTIVE : TRIGGER_IDLE}`
              }
            >
              {schedulingItem.label}
            </NavLink>
          )
        )}
        {/* Gate on the groups themselves, not isAdmin: useNavItems already gates
            each entry by role and drops empty groups, so a plain vorstand still
            gets the section for the club mailbox alone. */}
        {adminGroups.length > 0 && (
          <NavCategory
            label={t('admin')}
            groups={adminGroups}
            extra={isSuperAdmin ? superadminItems : undefined}
            extraLabel={t('superadmin')}
            footerItem={{ to: '/admin', label: t('allAdminTools'), icon: <LayoutGrid className="h-4 w-4" /> }}
            wide
            messagingOn={messagingOn}
            unreadMessages={unreadMessages}
          />
        )}
      </nav>

      {/* Spacer pushes the action cluster to the far right */}
      <div className="flex-1" />

      {/* Right: actions */}
      <div className="flex shrink-0 items-center gap-0.5">
        {user && isApproved && <NotificationBell unreadCount={unreadCount} onClick={onOpenNotifications} />}

        <NavLink
          to="/guide"
          data-tour="nav-guide"
          aria-label={t('guide')}
          title={t('guide')}
          className={({ isActive }) => `${iconBtn} ${isActive ? 'bg-brand-50 !text-brand-700 dark:bg-brand-800 dark:!text-gold-400' : ''}`}
        >
          <GraduationCap className="h-5 w-5" />
        </NavLink>

        {/* Options — a popover (not a menu) so the toggles + nested language
            dropdown work without auto-closing on interaction. */}
        <Popover open={optionsOpen} onOpenChange={setOptionsOpen}>
          <PopoverTrigger asChild>
            <button data-tour="nav-settings" aria-label={t('options', 'Options')} title={t('options', 'Options')} className={iconBtn}>
              <Settings className="h-5 w-5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-1.5">
            <div className="flex items-center justify-between rounded-lg px-3 py-2 text-sm">
              <span className="font-medium text-gray-600 dark:text-gray-300">{t('darkMode', 'Dark mode')}</span>
              <SwitchToggle
                enabled={theme === 'dark'}
                onChange={toggleTheme}
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
            <div className="my-1 h-px bg-gray-200 dark:bg-brand-800" />
            {optLink('/feedback', <MessageSquare className="h-4 w-4" />, t('feedback'))}
            {messagingOn && optLink('/options/messaging', <MessageCircle className="h-4 w-4" />, t('messagingSettings'))}
            {optLink('/status', <Activity className="h-4 w-4" />, t('status', 'Status'))}
            <NavLink
              to="/changelog"
              onClick={closeOptions}
              className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-brand-800"
            >
              <span className="flex items-center gap-3">
                <ScrollText className="h-4 w-4" />
                {t('whatsNew', "What's New")}
              </span>
              <span className="font-mono text-xs text-gray-400 dark:text-gray-500">v{APP_VERSION}</span>
            </NavLink>
          </PopoverContent>
        </Popover>

        {/* Profile / sign in */}
        {user ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                data-tour="nav-profile"
                className="flex items-center gap-1 rounded-lg p-1 transition-colors hover:bg-gray-100 dark:hover:bg-brand-800"
                aria-label={t('myProfile')}
              >
                {user.photo ? (
                  <img src={getFileUrl('members', user.id, user.photo)} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                ) : (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-500 dark:bg-brand-800 dark:text-gray-300">
                    {`${memberFirstName(user)[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase()}
                  </div>
                )}
                <ChevronDown className="h-4 w-4 text-gray-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <div className="px-2 py-1.5">
                <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                  {memberDisplayName(user)}
                </div>
                {memberTeams.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {memberTeams.map((mt) => (
                      <TeamChip key={mt.id} team={asObj<Team>(mt.team)?.name ?? '?'} size="sm" />
                    ))}
                  </div>
                )}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate('/profile')} className="cursor-pointer gap-2.5">
                <UserIcon className="h-4 w-4" />
                {t('myProfile')}
              </DropdownMenuItem>
              {/* Personal support link — above Logout, which stays last.
                  Hidden for under-18s and while impersonating (useDonateVisible). */}
              {donateVisible && (
                <DropdownMenuItem onSelect={() => navigate('/support')} className="cursor-pointer gap-2.5">
                  <Coffee className="h-4 w-4" />
                  {tSupport('menuLabel')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => logout()} className="cursor-pointer gap-2.5 text-gray-700 dark:text-gray-200">
                <LogOut className="h-4 w-4" />
                {t('logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <NavLink
            to="/login"
            className="rounded-lg px-3 py-2 text-sm font-medium text-brand-600 transition-colors hover:bg-gray-100 dark:text-gold-400 dark:hover:bg-brand-800"
          >
            {t('signIn')}
          </NavLink>
        )}
      </div>
    </header>
  )
}

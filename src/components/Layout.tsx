import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth'
import { useIsDesktop } from '../hooks/useMediaQuery'
import { useNotifications } from '../hooks/useNotifications'
import { getCurrentSeason } from '../utils/dateHelpers'
import { isAuthenticated } from '../lib/api'
import { useAdminMode } from '../hooks/useAdminMode'
import BottomTabBar from './BottomTabBar'
import MoreSheet from './MoreSheet'
import NotificationPanel from './NotificationPanel'
import TopNav from './TopNav'
import { useCollection } from '../lib/query'
import { usePageLoading } from '../hooks/usePageReady'
import LoadingSpinner from './LoadingSpinner'
import ProfileEditModal from '../modules/auth/ProfileEditModal'
import type { MemberTeam, Team } from '../types'

type ExpandedMemberTeam = MemberTeam & { team: Team | string }

export default function Layout() {
  const [moreOpen, setMoreOpen] = useState(false)
  const [notifPanelOpen, setNotifPanelOpen] = useState(false)
  const { user, isApproved, isProfileComplete, isLoading, teamsLoading } = useAuth()
  const { notifications, unreadCount, markAsRead, markAllAsRead, deleteNotification, clearAllRead } = useNotifications()
  const { t } = useTranslation('nav')
  const isDesktop = useIsDesktop()
  const { isAdminMode } = useAdminMode()
  // The active routed page reports whether its primary data is still loading
  // (via useReportPageLoading). While true we keep ONE fullscreen spinner up,
  // masking the chrome + content so they reveal together — no chrome-then-
  // content flash, no second spinner inside the page. See usePageReady.tsx.
  const pageLoading = usePageLoading()
  const location = useLocation()
  // Match-scheduling (Terminplanung) is a spielplaner tool with its own per-team
  // scoping — the gold admin-mode banner is just noise there, so hide it on those
  // pages (the toggle itself stays on; only the banner is suppressed).
  const onScheduling = location.pathname.includes('/terminplanung')

  // NOTE: the admin-mode toggle is fully manual — nothing auto-flips it. The
  // navbar is always complete for privileged users (role-gated); the toggle only
  // changes the data scope (own teams vs club-wide) + the gold banner.
  const { data: memberTeamsRaw } = useCollection<ExpandedMemberTeam>('member_teams', {
    // Current-season only — otherwise archived same-name teams (e.g. old + new
    // "H3" after a rollover) render as duplicate badges in the user card.
    filter: user ? { _and: [{ member: { _eq: user.id } }, { season: { _eq: getCurrentSeason() } }] } : undefined,
    fields: ['*', 'team.*'],
    limit: 10,
    enabled: !!user && !isLoading,
  })
  const memberTeams = memberTeamsRaw ?? []

  // Two boot phases share ONE spinner: (1) auth + role context loading, then
  // (2) the active page's own data loading. `authBooting` also gates the chrome
  // + page from mounting until role context is ready (memberTeamIds/coachTeamIds,
  // which the pages depend on). `booting` true ⇒ keep the overlay opaque.
  const authBooting = (isLoading || teamsLoading) && isAuthenticated()
  const booting = authBooting || pageLoading

  // Keep the overlay mounted briefly after booting ends, then fade it out — the
  // page content (which mounts the instant loading clears) paints underneath
  // before the spinner vanishes, killing the "spinner gone, data a beat later"
  // flash. A single instance spans both phases (useReportPageLoading reports via
  // useLayoutEffect, closing the sub-frame gap between phase 1 and phase 2), so
  // the user never sees a second spinner.
  const [overlayMounted, setOverlayMounted] = useState(booting)
  // Mount immediately when booting starts — set-state-during-render is React's
  // sanctioned way to derive state from a changed value (no effect lag).
  if (booting && !overlayMounted) setOverlayMounted(true)
  // Unmount 250ms after booting ends, once the fade-out has revealed the content
  // beneath. setState lives in the async timeout, not the effect body.
  useEffect(() => {
    if (booting) return
    const t = setTimeout(() => setOverlayMounted(false), 250)
    return () => clearTimeout(t)
  }, [booting])

  return (
    <div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-900">
      {/* One continuous boot spinner spanning both the auth/team phase and the
          page-data phase. It masks the chrome + content underneath, then fades
          out (content already painted beneath) so everything reveals at once —
          no second spinner, no chrome-then-content flash, no data-lag flicker.
          Progress bar off: a simulated bar resetting between phases is exactly
          what read as "two spinners". */}
      {overlayMounted && (
        <div
          className={`fixed inset-0 z-[60] flex items-center justify-center bg-gray-50 transition-opacity duration-200 dark:bg-gray-900 ${
            booting ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <LoadingSpinner showProgress={false} />
        </div>
      )}

      {/* Chrome + page mount only once auth/team context is ready; while the
          page's own data loads they render underneath the overlay (masked). */}
      {!authBooting && (<>
      {/* Desktop top navbar (replaces the old side rail). Mobile keeps the
          bottom tab bar + More sheet below. */}
      {isDesktop && (
        <TopNav
          unreadCount={unreadCount}
          onOpenNotifications={() => setNotifPanelOpen(true)}
          memberTeams={memberTeams}
        />
      )}

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className={`flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8 ${
          !isDesktop ? 'pb-24' : ''
        }`}>
          {isAdminMode && !onScheduling && (
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
      </>)}

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

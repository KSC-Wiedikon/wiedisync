import { useState } from 'react'
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

  // Block rendering until auth + role context fully loads (prevents flash
  // where pages render before memberTeamIds/coachTeamIds are available)
  if ((isLoading || teamsLoading) && isAuthenticated()) {
    return <LoadingSpinner />
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-900">
      {/* Unified boot spinner. The chrome + page stay mounted underneath (so
          the page can load its data and report readiness); this overlay masks
          them until the page's primary data lands, then lifts to reveal header,
          footer and content together. */}
      {pageLoading && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-50 dark:bg-gray-900">
          <LoadingSpinner />
        </div>
      )}

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

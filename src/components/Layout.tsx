import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth'
import { useIsDesktop } from '../hooks/useMediaQuery'
import { useNotifications } from '../hooks/useNotifications'
import { getCurrentSeason } from '../utils/dateHelpers'
import { isAuthenticated } from '../lib/api'
import { useAdminMode } from '../hooks/useAdminMode'
import { useProfileReviewDue } from '../hooks/useProfileReviewDue'
import BottomTabBar from './BottomTabBar'
import MoreSheet from './MoreSheet'
import NotificationPanel from './NotificationPanel'
import TopNav from './TopNav'
import ImpersonationBanner from './ImpersonationBanner'
import { useCollection } from '../lib/query'
import ProfileEditModal from '../modules/auth/ProfileEditModal'
import { ConversationsProvider } from '../modules/messaging/ConversationsStoreProvider'
import type { MemberTeam, Team } from '../types'

type ExpandedMemberTeam = MemberTeam & { team: Team | string }

export default function Layout() {
  const [moreOpen, setMoreOpen] = useState(false)
  const [notifPanelOpen, setNotifPanelOpen] = useState(false)
  const { user, isApproved, isProfileComplete, isImpersonating, isLoading, teamsLoading } = useAuth()
  // Already excludes impersonation and unapproved accounts — see the hook.
  const profileReviewDue = useProfileReviewDue()
  const { notifications, unreadCount, markAsRead, markAllAsRead, deleteNotification, clearAllRead } = useNotifications()
  const { t } = useTranslation('nav')
  const isDesktop = useIsDesktop()
  const { isAdminMode } = useAdminMode()
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

  // Gate the chrome + page from mounting until auth/role context is ready
  // (memberTeamIds/coachTeamIds, which the pages depend on). The boot spinner
  // itself is the app-level <BootOverlay/>; here we only decide whether to
  // render the chrome underneath it.
  const authBooting = (isLoading || teamsLoading) && isAuthenticated()

  return (
    <ConversationsProvider>
    <div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-900">
      {/* Chrome + page mount only once auth/team context is ready; while the
          page's own data loads they render underneath <BootOverlay/> (masked). */}
      {!authBooting && (<>
      <ImpersonationBanner />
      {/* Desktop top navbar (replaces the old side rail). Mobile keeps the
          bottom tab bar + More sheet below. */}
      {isDesktop && (
        <TopNav
          unreadCount={unreadCount}
          onOpenNotifications={() => setNotifPanelOpen(true)}
          memberTeams={memberTeams}
        />
      )}

      {/* Main content. Full-bleed workspace routes (desktop) manage their own
          internal scrolling — main stops scrolling and drops its padding so the
          page fills the viewport exactly (no outer scrollbar). */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className={
          isDesktop && location.pathname.startsWith('/admin/explore')
            ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
            : `flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8 ${!isDesktop ? 'pb-24' : ''}`
        }>
          {isAdminMode && !onScheduling && (
            <div
              className={
                'border-x border-b border-t-2 border-gold-400 bg-gold-50 px-4 py-1 text-center text-xs font-semibold uppercase tracking-wider text-gold-700 dark:bg-brand-900/50 dark:text-gold-300 ' +
                (isDesktop && location.pathname.startsWith('/admin/explore')
                  ? 'shrink-0'
                  : '-mx-4 -mt-4 mb-4 sm:-mx-6 sm:-mt-6 lg:-mx-8 lg:-mt-8')
              }
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

      {/* Onboarding modal — non-dismissable, blocks the app until the profile
          is complete (core contact set, see AuthProvider.isProfileComplete).
          Skipped while impersonating: the "View as" session can neither save
          (assertWritable blocks writes) nor refresh the impersonated member,
          so the gate would trap the admin in an unclosable modal. */}
      {user && isApproved && !isProfileComplete && !isImpersonating && (
        <ProfileEditModal
          open
          onClose={() => {}}
          onboarding
          dismissable={false}
        />
      )}

      {/* Annual pre-licence data check (migration 270) — same hard-gate
          machinery, but only once the profile is COMPLETE: an incomplete
          profile already has the onboarding gate above, and stacking both would
          put two modals on screen asking for overlapping things. */}
      {user && isApproved && isProfileComplete && profileReviewDue && (
        <ProfileEditModal
          open
          onClose={() => {}}
          verify
          dismissable={false}
        />
      )}

      {/* Messaging consent modal mounts at the messaging entry points
          (InboxPage, ConversationPage, TeamMessagesTab), not globally,
          so users only see it when they actually engage with messaging. */}
    </div>
    </ConversationsProvider>
  )
}

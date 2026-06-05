import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ClipboardList, Clock, AlertTriangle, Trophy, Bell, ArrowRightLeft, ArrowLeft, BellRing, BellOff, UserPlus, Flag, Trash2 } from 'lucide-react'
import type { Notification } from '../types'
import { usePushNotifications } from '../hooks/usePushNotifications'

interface SidebarNotificationsProps {
  notifications: Notification[]
  unreadCount: number
  onMarkAsRead: (id: string) => void
  onMarkAllAsRead: () => void
  onDelete?: (id: string) => void
  onClearRead?: () => void
  onBack: () => void
  onCloseSidebar: () => void
  theme: string
}

const typeIcons: Record<string, React.ReactNode> = {
  activity_change: <ClipboardList className="h-4 w-4" />,
  upcoming_activity: <Clock className="h-4 w-4" />,
  deadline_reminder: <AlertTriangle className="h-4 w-4" />,
  result_available: <Trophy className="h-4 w-4" />,
  duty_delegation_request: <ArrowRightLeft className="h-4 w-4" />,
  member_join_request: <UserPlus className="h-4 w-4" />,
  event_invite: <Bell className="h-4 w-4" />,
  new_report: <Flag className="h-4 w-4" />,
}

const typeLabels: Record<string, string> = {
  activity_change: 'activityChange',
  upcoming_activity: 'upcomingActivity',
  deadline_reminder: 'deadlineReminder',
  result_available: 'resultAvailable',
  duty_delegation_request: 'dutyDelegation',
  member_join_request: 'memberJoinRequest',
  event_invite: 'eventInvite',
  new_report: 'newReport',
}

function timeAgo(dateStr: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return t('justNow')
  if (minutes < 60) return t('minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('hoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  return t('daysAgo', { count: days })
}

function getNavigationPath(n: Notification): string {
  if (n.type === 'duty_delegation_request' || n.activity_type === 'scorer_duty') return '/scorer'
  if (n.type === 'member_join_request' && n.activity_id) return `/teams/${n.activity_id}`
  // Messaging moderation: admins get `new_report` notifications when a member
  // submits a report. The report list + resolution UI lives at /admin/reports.
  if (n.type === 'new_report' || n.activity_type === 'report') return '/admin/reports'
  switch (n.activity_type) {
    case 'game': return '/games'
    case 'training': return '/trainings'
    case 'event': return '/events'
    case 'form': return '/forms'
    default: return '/'
  }
}

export default function SidebarNotifications({
  notifications,
  unreadCount,
  onMarkAsRead,
  onMarkAllAsRead,
  onDelete,
  onClearRead,
  onBack,
  onCloseSidebar,
  theme,
}: SidebarNotificationsProps) {
  const { t } = useTranslation('notifications')
  const { t: tMessaging } = useTranslation('messaging')
  const navigate = useNavigate()
  const push = usePushNotifications()

  function handleClick(n: Notification) {
    if (!n.read) onMarkAsRead(n.id)
    onCloseSidebar()
    navigate(getNavigationPath(n))
  }

  function renderMessage(n: Notification): string {
    try {
      const data = n.body ? JSON.parse(n.body) : {}
      if (data.reason) {
        data.reason = tMessaging(`reportReason_${data.reason}`, { defaultValue: data.reason })
      }
      const noLocation = (!data.hall && !data.location) || (data.hall === '' && data.location == null) || (data.location === '' && data.hall == null)
      const key = noLocation && t(`${n.title}_no_hall`, { defaultValue: '' }) ? `${n.title}_no_hall` : n.title
      // Strip :SS seconds from legacy times (e.g. "19:00:00" → "19:00")
      return String(t(key, data)).replace(/(\d{2}:\d{2}):\d{2}/g, '$1')
    } catch {
      return String(n.title).replace(/(\d{2}:\d{2}):\d{2}/g, '$1')
    }
  }

  const isLight = theme === 'light'

  return (
    <>
      {/* Header with back button */}
      <div className={`flex h-16 items-center gap-2 border-b px-4 ${
        isLight ? 'border-gray-200' : 'border-brand-800'
      }`}>
        <button
          onClick={onBack}
          className={`rounded-lg p-1.5 transition-colors ${
            isLight ? 'hover:bg-gray-100 text-gray-600' : 'hover:bg-brand-800 text-gray-300'
          }`}
          aria-label="Back to navigation"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className={`text-sm font-semibold flex-1 ${
          isLight ? 'text-gray-900' : 'text-gray-100'
        }`}>
          {t('title')}
        </h2>
        {unreadCount > 0 && (
          <button
            onClick={onMarkAllAsRead}
            className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            {t('markAllRead')}
          </button>
        )}
        {onClearRead && notifications.some((n) => n.read) && (
          <button
            onClick={onClearRead}
            className={`text-xs font-medium ${
              isLight ? 'text-gray-500 hover:text-red-600' : 'text-gray-400 hover:text-red-400'
            }`}
          >
            {t('clearRead')}
          </button>
        )}
      </div>

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <Bell className={`h-8 w-8 mb-2 ${isLight ? 'text-gray-300' : 'text-gray-600'}`} />
            <p className={`text-sm ${isLight ? 'text-gray-400' : 'text-gray-500'}`}>
              {t('noNotifications')}
            </p>
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className={`flex w-full items-start transition-colors ${
                isLight
                  ? `border-b border-gray-100 hover:bg-gray-50 ${!n.read ? 'bg-brand-50/50' : ''}`
                  : `border-b border-brand-800/50 hover:bg-brand-800/50 ${!n.read ? 'bg-brand-900/40' : ''}`
              }`}
            >
              <button
                onClick={() => handleClick(n)}
                className={`flex min-w-0 flex-1 items-start gap-2.5 px-4 py-2.5 text-left ${
                  isLight ? 'active:bg-gray-100' : 'active:bg-brand-800'
                }`}
              >
                {/* Unread dot */}
                <div className="flex shrink-0 items-center pt-1.5">
                  {!n.read ? (
                    <div className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                  ) : (
                    <div className="h-1.5 w-1.5" />
                  )}
                </div>

                {/* Icon */}
                <span className={`shrink-0 pt-0.5 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                  {typeIcons[n.type] ?? <Bell className="h-4 w-4" />}
                </span>

                {/* Content */}
                <div className="min-w-0 flex-1 pr-px">
                  <p className={`break-words text-xs leading-snug ${
                    isLight ? 'text-gray-900' : 'text-gray-100'
                  } ${!n.read ? 'font-medium' : ''}`}>
                    {renderMessage(n)}
                  </p>
                  <div className={`mt-0.5 flex items-center gap-1.5 text-[10px] ${
                    isLight ? 'text-gray-400' : 'text-gray-500'
                  }`}>
                    <span>{t(typeLabels[n.type] ?? 'activityChange')}</span>
                    <span>·</span>
                    <span>{timeAgo(n.created ?? n.date_created ?? '', t)}</span>
                  </div>
                </div>
              </button>
              {onDelete && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(n.id) }}
                  className={`flex shrink-0 items-center justify-center p-2.5 transition-colors ${
                    isLight ? 'text-gray-400 hover:text-red-600' : 'text-gray-500 hover:text-red-400'
                  }`}
                  aria-label={t('delete')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Push notification toggle */}
      {push.supported && (
        <div className={`border-t px-4 py-2.5 ${
          isLight ? 'border-gray-200' : 'border-brand-800'
        }`}>
          <div className="flex items-center justify-between">
            <div className={`flex items-center gap-1.5 text-xs ${
              isLight ? 'text-gray-600' : 'text-gray-400'
            }`}>
              {push.subscribed ? <BellRing className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
              <span>{t('pushNotifications')}</span>
            </div>
            {push.permission === 'denied' ? (
              <span className="text-[10px] text-red-500">{t('pushDenied')}</span>
            ) : (
              <button
                onClick={() => push.subscribed ? push.unsubscribe() : push.subscribe()}
                disabled={push.loading}
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                  push.subscribed
                    ? isLight
                      ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      : 'bg-brand-800 text-gray-300 hover:bg-brand-700'
                    : 'bg-brand-600 text-white hover:bg-brand-700'
                } disabled:opacity-50`}
              >
                {push.loading ? '...' : push.subscribed ? t('pushDisable') : t('pushEnable')}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}

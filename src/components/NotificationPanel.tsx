import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ClipboardList, Clock, AlertTriangle, Trophy, Bell, ArrowRightLeft, BellRing, BellOff, UserPlus, Trash2, ChevronDown, X } from 'lucide-react'
import type { Notification } from '../types'
import { usePushNotifications } from '../hooks/usePushNotifications'

interface NotificationPanelProps {
  notifications: Notification[]
  unreadCount: number
  onMarkAsRead: (id: string) => void
  onMarkAllAsRead: () => void
  onDelete?: (id: string) => void
  onClearRead?: () => void
  onClose: () => void
}

const typeIcons: Record<string, React.ReactNode> = {
  activity_change: <ClipboardList className="h-4 w-4" />,
  upcoming_activity: <Clock className="h-4 w-4" />,
  deadline_reminder: <AlertTriangle className="h-4 w-4" />,
  result_available: <Trophy className="h-4 w-4" />,
  duty_delegation_request: <ArrowRightLeft className="h-4 w-4" />,
  member_join_request: <UserPlus className="h-4 w-4" />,
  event_invite: <Bell className="h-4 w-4" />,
}

const typeLabels: Record<string, string> = {
  activity_change: 'activityChange',
  upcoming_activity: 'upcomingActivity',
  deadline_reminder: 'deadlineReminder',
  result_available: 'resultAvailable',
  duty_delegation_request: 'dutyDelegation',
  member_join_request: 'memberJoinRequest',
  event_invite: 'eventInvite',
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

export default function NotificationPanel({
  notifications,
  unreadCount,
  onMarkAsRead,
  onMarkAllAsRead,
  onDelete,
  onClearRead,
  onClose,
}: NotificationPanelProps) {
  const { t } = useTranslation('notifications')
  const { t: tMessaging } = useTranslation('messaging')
  const navigate = useNavigate()
  const push = usePushNotifications()

  // Animated close
  const [closing, setClosing] = useState(false)
  const startClose = useCallback(() => setClosing(true), [])
  const onAnimEnd = useCallback(() => { if (closing) onClose() }, [closing, onClose])

  // Swipe-down-to-close (mobile)
  const panelRef = useRef<HTMLDivElement>(null)
  const [dragY, setDragY] = useState(0)
  const touchStart = useRef<{ y: number; scrollTop: number } | null>(null)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const el = panelRef.current
    if (!el) return
    touchStart.current = { y: e.touches[0].clientY, scrollTop: el.scrollTop }
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStart.current) return
    const dy = e.touches[0].clientY - touchStart.current.y
    // Only allow drag-down when scrolled to top
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

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  function handleClick(n: Notification) {
    if (!n.read) onMarkAsRead(n.id)
    onClose()
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

  return (
    <div className="fixed inset-0 z-50" onClick={startClose}>
      {/* Backdrop */}
      <div className={`absolute inset-0 bg-black/50 ${closing ? 'animate-fade-out' : 'animate-fade-in'}`} />

      {/* Panel — animation/drag transform on this wrapper; scrolling on inner
          container so iOS Safari keeps touch-scroll while transform is active. */}
      <div
        className={`absolute bottom-0 left-0 right-0 flex max-h-[85vh] flex-col rounded-t-2xl bg-white dark:bg-gray-800 lg:bottom-auto lg:left-auto lg:right-4 lg:top-4 lg:max-h-[80vh] lg:w-96 lg:rounded-2xl lg:shadow-2xl ${closing ? 'animate-sheet-down lg:animate-fade-out' : 'animate-sheet-up lg:animate-modal-enter'}`}
        style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={(e) => { if (e.target === e.currentTarget) onAnimEnd() }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Scrollable body — panelRef points here so onTouchStart can read scrollTop */}
        <div ref={panelRef} className="pb-safe flex-1 overflow-y-auto overscroll-contain">
        {/* Handle (mobile) + close button */}
        <div className="sticky top-0 z-10 rounded-t-2xl bg-white dark:bg-gray-800 lg:rounded-t-2xl">
          <button
            type="button"
            onClick={startClose}
            aria-label={t('close', { defaultValue: 'Close' })}
            className="relative flex w-full items-center justify-center rounded-t-2xl pb-1 pt-3 transition-colors hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-gray-700/60 dark:active:bg-gray-700 lg:hidden"
          >
            <span className="h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />
            <span className="absolute right-3 top-1.5 inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 dark:text-gray-500">
              <ChevronDown className="h-5 w-5" />
            </span>
          </button>

          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-4 pb-3 pt-2 dark:border-gray-700 lg:pt-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t('title')}
            </h2>
            <div className="flex items-center gap-3">
              {unreadCount > 0 && (
                <button
                  onClick={onMarkAllAsRead}
                  className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                >
                  {t('markAllRead')}
                </button>
              )}
              {onClearRead && notifications.some((n) => n.read) && (
                <button
                  onClick={onClearRead}
                  className="text-sm font-medium text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400"
                >
                  {t('clearRead')}
                </button>
              )}
              {/* Desktop close (mobile uses the chevron in the handle row) */}
              <button
                type="button"
                onClick={startClose}
                aria-label={t('close', { defaultValue: 'Close' })}
                className="hidden h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300 lg:inline-flex"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Notification list */}
        {notifications.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
            {t('noNotifications')}
          </p>
        ) : (
          <div>
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`flex w-full items-start border-b border-gray-100 transition-colors last:border-b-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50 ${
                  !n.read ? 'bg-brand-50/50 dark:bg-brand-900/20' : ''
                }`}
              >
                <button
                  onClick={() => handleClick(n)}
                  className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left active:bg-gray-100 dark:active:bg-gray-700"
                >
                  {/* Unread dot */}
                  <div className="flex shrink-0 items-center pt-1.5">
                    {!n.read ? (
                      <div className="h-2 w-2 rounded-full bg-brand-500" />
                    ) : (
                      <div className="h-2 w-2" />
                    )}
                  </div>

                  {/* Icon */}
                  <span className="shrink-0 pt-0.5 text-gray-500 dark:text-gray-400">{typeIcons[n.type] ?? <Bell className="h-4 w-4" />}</span>

                  {/* Content */}
                  <div className="min-w-0 flex-1 pr-px">
                    <p className={`break-words text-sm text-gray-900 dark:text-gray-100 ${!n.read ? 'font-medium' : ''}`}>
                      {renderMessage(n)}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                      <span>{t(typeLabels[n.type] ?? 'activityChange')}</span>
                      <span>·</span>
                      <span>{timeAgo(n.created ?? n.date_created ?? '', t)}</span>
                    </div>
                  </div>
                </button>
                {onDelete && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(n.id) }}
                    className="flex shrink-0 items-center justify-center p-3 text-gray-400 transition-colors hover:text-red-600 dark:text-gray-500 dark:hover:text-red-400"
                    aria-label={t('delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Push notification toggle */}
        {push.supported && (
          <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                {push.subscribed ? <BellRing className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                <span>{t('pushNotifications')}</span>
              </div>
              {push.permission === 'denied' ? (
                <span className="text-xs text-red-500">{t('pushDenied')}</span>
              ) : (
                <button
                  onClick={() => push.subscribed ? push.unsubscribe() : push.subscribe()}
                  disabled={push.loading}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    push.subscribed
                      ? 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                      : 'bg-brand-600 text-white hover:bg-brand-700'
                  } disabled:opacity-50`}
                >
                  {push.loading ? '...' : push.subscribed ? t('pushDisable') : t('pushEnable')}
                </button>
              )}
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}

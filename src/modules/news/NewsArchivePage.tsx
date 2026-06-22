import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Megaphone, Pin } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useNotifications } from '../../hooks/useNotifications'
import { useAnnouncements, pickTranslation } from '../../hooks/useAnnouncements'
import { stripHtml } from '../../components/RichText'
import { assetUrl } from '../../lib/api'
import { formatRelativeTimeZurich } from '../../utils/dateHelpers'
import AnnouncementDetailModal from '../home/components/AnnouncementDetailModal'
import { useReportPageLoading } from '../../hooks/usePageReady'
import { Table, TableBody, TableCell, TableRow } from '../../components/ui/table'
import type { Announcement, Notification } from '../../types'

type FeedItem =
  | { kind: 'announcement'; id: string; ts: number; pinned: boolean; record: Announcement }
  | { kind: 'notification'; id: string; ts: number; pinned: false; record: Notification }

const PAGE_SIZE = 20

export default function NewsArchivePage() {
  const { t, i18n } = useTranslation('announcements')
  const { t: tn } = useTranslation('notifications')
  const navigate = useNavigate()
  const { user, isApproved } = useAuth()
  const { notifications, isLoading: notifLoading, markAsRead } = useNotifications()
  const { announcements, isLoading: annLoading } = useAnnouncements({ limit: 100 })
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null)
  const [page, setPage] = useState(0)

  const isLoading = notifLoading || annLoading

  const items = useMemo<FeedItem[]>(() => {
    const annItems: FeedItem[] = announcements.map((a) => ({
      kind: 'announcement',
      id: `a:${a.id}`,
      ts: new Date(a.published_at ?? a.date_created ?? 0).getTime(),
      pinned: !!a.pinned,
      record: a,
    }))
    const notifItems: FeedItem[] = notifications.map((n) => ({
      kind: 'notification',
      id: `n:${n.id}`,
      ts: new Date(n.date_created ?? n.created ?? 0).getTime(),
      pinned: false,
      record: n,
    }))
    const merged = [...annItems, ...notifItems]
    merged.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.ts - a.ts
    })
    return merged
  }, [announcements, notifications])

  const visible = items.slice(0, (page + 1) * PAGE_SIZE)
  const hasMore = items.length > visible.length

  // Report to app boot gate — see usePageReady.tsx
  useReportPageLoading(isLoading && items.length === 0)

  if (!user || !isApproved) {
    return (
      <div className="mx-auto max-w-2xl py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        {t('signInRequired')}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{tn('news')}</h1>
      </div>

      {isLoading && items.length === 0 ? null : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {tn('noNotifications')}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <Table>
              <TableBody>
                {visible.map((item) =>
                  item.kind === 'announcement' ? (
                    <AnnouncementTableRow
                      key={item.id}
                      announcement={item.record}
                      lang={i18n.language}
                      onClick={() => setSelectedAnnouncement(item.record)}
                    />
                  ) : (
                    <NotificationTableRow
                      key={item.id}
                      notification={item.record}
                      onMarkAsRead={markAsRead}
                    />
                  ),
                )}
              </TableBody>
            </Table>
          </div>
          {hasMore && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                {t('loadMore')}
              </button>
            </div>
          )}
        </>
      )}

      {selectedAnnouncement && (
        <AnnouncementDetailModal
          announcement={selectedAnnouncement}
          onClose={() => setSelectedAnnouncement(null)}
        />
      )}
    </div>
  )
}

function AnnouncementTableRow({
  announcement,
  lang,
  onClick,
}: {
  announcement: Announcement
  lang: string
  onClick: () => void
}) {
  const tr = pickTranslation(announcement.translations, lang)
  const timeAgo = (() => {
    const ts = announcement.published_at ?? announcement.date_created
    if (!ts) return ''
    return formatRelativeTimeZurich(ts, lang)
  })()
  const excerpt = tr.body ? stripHtml(tr.body) : ''
  const thumbUrl = announcement.image ? assetUrl(announcement.image, 'width=96&height=96&fit=cover') : ''

  return (
    <TableRow onClick={onClick} className="cursor-pointer align-top">
      <TableCell className="hidden sm:table-cell w-12">
        {thumbUrl ? (
          <img src={thumbUrl} alt="" className="h-9 w-9 rounded-md object-cover" loading="lazy" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            <Megaphone className="h-4 w-4" />
          </span>
        )}
      </TableCell>
      <TableCell className="whitespace-normal">
        <div className="flex items-center gap-1.5">
          {announcement.pinned && (
            <Pin className="h-3 w-3 shrink-0 text-gold-500 dark:text-gold-400" aria-label="Pinned" />
          )}
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{tr.title}</span>
        </div>
        {excerpt && (
          <p className="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{excerpt}</p>
        )}
      </TableCell>
      <TableCell className="text-right text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
        {timeAgo}
      </TableCell>
    </TableRow>
  )
}

function NotificationTableRow({
  notification,
  onMarkAsRead,
}: {
  notification: Notification
  onMarkAsRead: (id: string) => void
}) {
  const { t } = useTranslation('notifications')
  const navigate = useNavigate()

  const message = (() => {
    try {
      const data = notification.body ? JSON.parse(notification.body) : {}
      const raw = String(t(notification.title, data))
      return raw.replace(/\s*@\s*$/, '').replace(/(\d{2}:\d{2}):\d{2}/g, '$1')
    } catch {
      return notification.title.replace(/(\d{2}:\d{2}):\d{2}/g, '$1')
    }
  })()

  const timeAgo = (() => {
    const ts = notification.date_created ?? notification.created
    if (!ts) return ''
    const diff = Date.now() - new Date(ts).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return String(t('justNow'))
    if (minutes < 60) return String(t('minutesAgo', { count: minutes }))
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return String(t('hoursAgo', { count: hours }))
    const days = Math.floor(hours / 60 / 24)
    return String(t('daysAgo', { count: days }))
  })()

  const path = (() => {
    if (notification.type === 'duty_delegation_request' || notification.activity_type === 'scorer_duty') return '/scorer'
    if (notification.activity_type === 'game') return '/games'
    if (notification.activity_type === 'training') return '/trainings'
    if (notification.activity_type === 'event') return '/events'
    if (notification.activity_type === 'form') return '/forms'
    return '/'
  })()

  return (
    <TableRow
      onClick={() => {
        if (!notification.read) onMarkAsRead(notification.id)
        navigate(path)
      }}
      className="cursor-pointer align-top"
    >
      <TableCell className="hidden sm:table-cell w-12" />
      <TableCell className="whitespace-normal text-sm text-gray-900 dark:text-gray-100">
        {message}
      </TableCell>
      <TableCell className="text-right text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
        {timeAgo}
      </TableCell>
    </TableRow>
  )
}

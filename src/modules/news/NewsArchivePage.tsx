import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Megaphone, Pin } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useNotificationsContext } from '../../hooks/NotificationsContext'
import { useAnnouncements, pickTranslation } from '../../hooks/useAnnouncements'
import { stripHtml } from '../../utils/stripHtml'
import { assetUrl } from '../../lib/api'
import { formatRelativeTimeZurich } from '../../utils/dateHelpers'
import AnnouncementDetailModal from '../home/components/AnnouncementDetailModal'
import { useReportPageLoading } from '../../hooks/usePageReady'
import { useNow } from '../../hooks/useNow'
import { Button } from '../../components/ui/button'
import IconButton from '../../components/IconButton'
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
  const { notifications, isLoading: notifLoading, markAsRead } = useNotificationsContext()
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
      <div className="mx-auto max-w-2xl py-8 text-center text-sm text-muted-foreground">
        {t('signInRequired')}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center gap-3">
        <IconButton
          onClick={() => navigate(-1)}
          className="shrink-0 text-muted-foreground hover:bg-accent hover:text-foreground"
          label={t('common:back')}
        >
          <ArrowLeft className="!size-5" />
        </IconButton>
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{tn('news')}</h1>
      </div>

      <div>
      {isLoading && items.length === 0 ? null : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-input px-6 py-10 text-center text-sm text-muted-foreground">
          {tn('noNotifications')}
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-hairline bg-card shadow-card">
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
              <Button
                variant="outline"
                onClick={() => setPage((p) => p + 1)}
              >
                {t('loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
      </div>

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
          <span className="text-sm font-medium text-foreground">{tr.title}</span>
        </div>
        {excerpt && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{excerpt}</p>
        )}
      </TableCell>
      <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
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

  // Ticking clock (1 min) instead of a render-time Date.now() — the relative
  // label ages on its own while the archive stays open.
  const now = useNow()
  const timeAgo = (() => {
    const ts = notification.date_created ?? notification.created
    if (!ts) return ''
    const diff = now - new Date(ts).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return String(t('justNow'))
    if (minutes < 60) return String(t('minutesAgo', { count: minutes }))
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return String(t('hoursAgo', { count: hours }))
    const days = Math.floor(hours / 24)
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
      <TableCell className="whitespace-normal text-sm text-foreground">
        {message}
      </TableCell>
      <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
        {timeAgo}
      </TableCell>
    </TableRow>
  )
}

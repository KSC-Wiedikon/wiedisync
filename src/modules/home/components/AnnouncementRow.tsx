import { useTranslation } from 'react-i18next'
import { Megaphone, Pin } from 'lucide-react'
import { assetUrl } from '../../../lib/api'
import { stripHtml } from '../../../utils/stripHtml'
import { pickTranslation } from '../../../hooks/useAnnouncements'
import { formatRelativeTimeZurich } from '../../../utils/dateHelpers'
import type { Announcement } from '../../../types'
import TruncatedText from '../../../components/TruncatedText'

interface Props {
  announcement: Announcement
  onClick: () => void
}

export default function AnnouncementRow({ announcement, onClick }: Props) {
  const { i18n } = useTranslation('notifications')
  const tr = pickTranslation(announcement.translations, i18n.language)

  const timeAgo = (() => {
    const ts = announcement.published_at ?? announcement.date_created
    if (!ts) return ''
    return formatRelativeTimeZurich(ts, i18n.language)
  })()

  const excerpt = tr.body ? stripHtml(tr.body) : ''
  const thumbUrl = announcement.image
    ? assetUrl(announcement.image, 'width=96&height=96&fit=cover')
    : ''

  return (
    <div
      onClick={onClick}
      className="flex cursor-pointer items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-b-0 hover:bg-muted active:bg-muted"
    >
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt=""
          className="h-9 w-9 shrink-0 rounded-md object-cover"
          loading="lazy"
        />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
          <Megaphone className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {announcement.pinned && (
            <Pin className="h-3 w-3 shrink-0 text-gold-500 dark:text-gold-400" aria-label="Pinned" />
          )}
          <TruncatedText as="p" text={tr.title} className="text-sm font-medium text-foreground" />
        </div>
        {excerpt && (
          <TruncatedText as="p" text={excerpt} className="text-xs text-muted-foreground" />
        )}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo}</span>
    </div>
  )
}

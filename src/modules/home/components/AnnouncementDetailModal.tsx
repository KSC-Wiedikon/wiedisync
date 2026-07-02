import { useTranslation } from 'react-i18next'
import { ExternalLink, Pin } from 'lucide-react'
import Modal from '../../../components/Modal'
import RichText from '../../../components/RichText'
import { assetUrl } from '../../../lib/api'
import { pickTranslation } from '../../../hooks/useAnnouncements'
import { formatDate } from '../../../utils/dateHelpers'
import { isSafeAppLink } from '../../../utils/sanitizeUrl'
import type { Announcement } from '../../../types'

interface Props {
  announcement: Announcement | null
  onClose: () => void
}

export default function AnnouncementDetailModal({ announcement, onClose }: Props) {
  const { i18n, t } = useTranslation('announcements')
  const tr = announcement
    ? pickTranslation(announcement.translations, i18n.language)
    : { title: '', body: '' }

  if (!announcement) return null

  const heroUrl = announcement.image
    ? assetUrl(announcement.image, 'width=1200&format=webp')
    : ''

  const publishedDate = announcement.published_at ? formatDate(announcement.published_at) : ''

  const safeLink = isSafeAppLink(announcement.link) ? announcement.link : null
  const linkLabel = (() => {
    if (!safeLink) return t('openLink')
    try {
      const u = new URL(safeLink, window.location.origin)
      return u.hostname.replace(/^www\./, '')
    } catch {
      return t('openLink')
    }
  })()

  return (
    <Modal open={!!announcement} onClose={onClose} title={tr.title} size="lg">
      <div className="space-y-4">
        {heroUrl && (
          <img
            src={heroUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-full rounded-lg"
          />
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {announcement.pinned && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gold-50 px-2 py-0.5 text-gold-700 dark:bg-gold-900/40 dark:text-gold-300">
              <Pin className="h-3 w-3" />
              {t('pinned')}
            </span>
          )}
          {publishedDate && <span>{publishedDate}</span>}
        </div>

        {tr.body && <RichText html={tr.body} />}

        {safeLink && (
          <div className="space-y-2">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t('linkHint')}
            </p>
            <a
              href={safeLink}
              target={safeLink.startsWith('http') ? '_blank' : undefined}
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
            >
              {linkLabel}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        )}
      </div>
    </Modal>
  )
}

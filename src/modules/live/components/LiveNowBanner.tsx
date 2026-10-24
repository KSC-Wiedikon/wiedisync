import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { liveHref, useLiveNow } from '../useLiveNow'

/**
 * "A match is live" → that match on /live (the hall board, or a game scored from a
 * phone). Renders nothing at all when nothing is live, so it costs one small 30s poll
 * and no layout on a normal day.
 *
 * The wording stays unattached to a fixture: the board's own row carries no game, so
 * "your game is live" would sometimes be wrong. The team codes in the headline let the
 * reader make that connection themselves.
 */
export default function LiveNowBanner() {
  const { t } = useTranslation('live')
  const { live, headline, channel } = useLiveNow()

  if (!live) return null

  return (
    <Link
      to={liveHref(channel)}
      className="mb-3 flex min-h-11 items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 transition-colors hover:bg-red-500/10"
    >
      <span className="flex items-center gap-2 text-xs font-semibold text-red-600 dark:text-red-400">
        <span className="h-2 w-2 rounded-full bg-red-500 motion-safe:animate-pulse" />
        {t('statusLive')}
      </span>
      {headline && (
        <span title={headline} className="min-w-0 flex-1 truncate text-sm font-semibold tabular-nums text-foreground">
          {headline}
        </span>
      )}
      <span className="shrink-0 text-xs font-medium text-muted-foreground">{t('watchLive')}</span>
    </Link>
  )
}

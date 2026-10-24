import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

/**
 * "Hosted by infomaniak" — Infomaniak sponsors the server Wiedisync runs on.
 * Blue wordmark on light, white on dark (their blue loses on navy).
 *
 * `stacked` puts the label above the wordmark (home header, desktop top nav);
 * `inline` keeps both on one line (More sheet).
 */
export default function HostedByInfomaniak({
  layout = 'stacked',
  align = 'start',
  className,
  logoClassName = 'h-3',
}: {
  layout?: 'stacked' | 'inline'
  align?: 'start' | 'end'
  className?: string
  logoClassName?: string
}) {
  const { t } = useTranslation('nav')
  return (
    <a
      href="https://www.infomaniak.com"
      target="_blank"
      rel="sponsored noopener noreferrer"
      title={`${t('hostedBy')} Infomaniak`}
      className={cn(
        'flex shrink-0 rounded-md opacity-90 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        layout === 'stacked'
          ? ['flex-col gap-1', align === 'end' ? 'items-end' : 'items-start']
          : 'items-center gap-2',
        className,
      )}
    >
      <span className="text-[9px] font-semibold uppercase leading-none tracking-[0.12em] text-muted-foreground">
        {t('hostedBy')}
      </span>
      <img src="/sponsors/infomaniak.svg" alt="Infomaniak" className={cn('w-auto dark:hidden', logoClassName)} />
      <img src="/sponsors/infomaniak-white.svg" alt="Infomaniak" className={cn('hidden w-auto dark:block', logoClassName)} />
    </a>
  )
}

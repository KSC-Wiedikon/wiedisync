import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { formatTimeZurich } from '../../utils/dateHelpers'
import Scoreboard from './components/Scoreboard'
import { useLiveMatch } from './useLiveMatch'

type Tone = 'live' | 'final' | 'idle' | 'pending'

function StatusPill({ tone, label }: { tone: Tone; label: string }) {
  const dot: Record<Tone, string> = {
    live: 'bg-red-500 motion-safe:animate-pulse',
    final: 'bg-primary',
    idle: 'bg-muted-foreground/50',
    pending: 'bg-amber-500 motion-safe:animate-pulse',
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-semibold text-foreground">
      <span className={cn('h-2 w-2 rounded-full', dot[tone])} />
      {label}
    </span>
  )
}

export default function LivePage() {
  const { t } = useTranslation('live')
  const [params] = useSearchParams()
  const channel = (params.get('channel') || 'kscw').toLowerCase()
  const { envelope, connection, lastReceivedAt } = useLiveMatch(channel)

  const { tone, label } = useMemo<{ tone: Tone; label: string }>(() => {
    if (!envelope) {
      return connection === 'reconnecting'
        ? { tone: 'pending', label: t('statusReconnecting') }
        : { tone: 'pending', label: t('statusConnecting') }
    }
    if (connection === 'reconnecting') return { tone: 'pending', label: t('statusReconnecting') }
    if (envelope.status === 'final') return { tone: 'final', label: t('statusFinal') }
    if (envelope.status === 'idle') return { tone: 'idle', label: t('statusIdle') }
    return { tone: 'live', label: t('statusLive') }
  }, [envelope, connection, t])

  // Contextual banner for the notable events the board flags.
  const eventNote = useMemo(() => {
    switch (envelope?.event) {
      case 'set-end': return t('eventSetEnd')
      case 'match-end': return t('eventMatchEnd')
      case 'switch-8': return t('eventSwitch')
      default: return null
    }
  }, [envelope?.event, t])

  const hasMatch = !!envelope?.match

  return (
    <div className="mx-auto w-full max-w-2xl p-4 sm:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <StatusPill tone={tone} label={label} />
      </header>

      {hasMatch ? (
        <>
          <Scoreboard state={envelope!.match!} />

          <div className="mt-3 flex min-h-5 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            {eventNote ? (
              <span className="rounded-md bg-accent px-2 py-1 font-medium text-accent-foreground">
                {eventNote}
              </span>
            ) : (
              <span />
            )}
            {lastReceivedAt && (
              <span>{t('updatedAt', { time: formatTimeZurich(new Date(lastReceivedAt)) })}</span>
            )}
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center">
          <p className="text-base font-semibold text-foreground">{t('noMatch')}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{t('noMatchHint')}</p>
        </div>
      )}
    </div>
  )
}

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { formatTimeZurich } from '../../utils/dateHelpers'
import FinalSummary from './components/FinalSummary'
import RecentMatches from './components/RecentMatches'
import Scoreboard from './components/Scoreboard'
import UpNextCard from './components/UpNextCard'
import { isUpNext, refereeNames, staleSince } from './liveGame'
import { useLiveMatch } from './useLiveMatch'
import { useLiveGame } from './useLiveGame'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useScreenWakeLock } from '@/hooks/useScreenWakeLock'

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
    // Not started yet, or no longer written: neither is "Live".
    if (envelope.status === 'idle' || isUpNext(envelope) || staleSince(envelope) != null) return { tone: 'idle', label: t('statusIdle') }
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
  const isFinal = envelope?.status === 'final'
  const upNext = isUpNext(envelope)
  const game = useLiveGame(envelope)
  const referees = refereeNames(game?.referees_json)
  const stale = staleSince(envelope)
  const running = hasMatch && !isFinal && !upNext && stale == null
  // A phone turned sideways shows the board alone, filling the screen (over the
  // tab bar). Height-bound so a tablet or a laptop keeps the normal page.
  const landscape = useMediaQuery('(orientation: landscape) and (max-height: 540px)')
  const fullScreen = landscape && running
  // Keep the screen on while a match is running — people watch for a whole set
  // without touching the phone.
  useScreenWakeLock(running)

  const refereeLine = referees.length > 0 && (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground/80">{t('referees')}:</span> {referees.join(' · ')}
    </p>
  )

  if (fullScreen) {
    return (
      <div
        className="fixed inset-0 z-[60] flex flex-col gap-2 bg-background pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))]"
        role="region"
        aria-label={t('title')}
      >
        <div className="flex min-h-0 flex-1">
          <Scoreboard state={envelope!.match!} big />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
          {refereeLine}
          {eventNote && (
            <span className="rounded-md bg-accent px-2 py-0.5 font-medium text-accent-foreground">{eventNote}</span>
          )}
          <span className="ml-auto flex items-center gap-2">
            {lastReceivedAt && <span>{t('updatedAt', { time: formatTimeZurich(new Date(lastReceivedAt)) })}</span>}
            <StatusPill tone={tone} label={label} />
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl p-4 sm:p-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
          {/* Which game is on the board — the layout differs per sport, so name it. */}
          {envelope?.match && (
            <span className="rounded-full border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground">
              {t(`sport_${envelope.match.sport}`)}
            </span>
          )}
          <StatusPill tone={tone} label={label} />
        </div>
      </header>

      {!envelope ? (
        // First read not back yet: a placeholder, not "No live match" for a moment.
        <div className="h-64 rounded-2xl border border-hairline bg-card shadow-card motion-safe:animate-pulse" aria-busy="true" />
      ) : hasMatch ? (
        <>
          {/* Once the match is over the live board (last-set points, TO/Sub, serve)
              is stale detail — the final summary replaces it entirely. */}
          {isFinal ? (
            <FinalSummary state={envelope!.match!} />
          ) : upNext ? (
            <UpNextCard state={envelope!.match!} game={game} />
          ) : (
            <Scoreboard state={envelope!.match!} />
          )}

          {refereeLine && <div className="mt-3 px-1">{refereeLine}</div>}

          <div className="mt-3 flex min-h-5 flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {eventNote && !isFinal ? (
              <span className="rounded-md bg-accent px-2 py-1 font-medium text-accent-foreground">
                {eventNote}
              </span>
            ) : (
              <span />
            )}
            {stale != null ? (
              <span className="ml-auto">{t('noUpdatesSince', { time: formatTimeZurich(new Date(stale)) })}</span>
            ) : lastReceivedAt && (
              <span className="ml-auto">{t('updatedAt', { time: formatTimeZurich(new Date(lastReceivedAt)) })}</span>
            )}
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-dashed bg-card p-10 text-center">
          <p className="text-base font-semibold text-foreground">{t('noMatch')}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{t('noMatchHint')}</p>
        </div>
      )}

      {/* Renders nothing until the board has finished at least one match. */}
      <RecentMatches channel={channel} />
    </div>
  )
}

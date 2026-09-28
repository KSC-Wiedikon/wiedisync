import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Eye, Minus, Plus, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import TruncatedText from '../../components/TruncatedText'
import { useConfirm } from '../../components/ConfirmProvider'
import { formatDateZurich, formatTimeZurich } from '../../utils/dateHelpers'
import {
  addPoint, closedWinner, currentSet, finish, isSetClosed, matchOver, nextSet, removePoint, reopen,
  type ScoreState, type Side,
} from './scoring'
import { useGameScoring, type SyncState } from './useGameScoring'

/**
 * Phone live scoring for one game — point-hub's console reduced to a phone at the side
 * of the court: Home and Away, a big "+" and a small "−" each, the sets, Undo and Next
 * set. No timeouts or substitutions. Publishes to `live_scores` channel `game-<id>`,
 * which `/live?channel=game-<id>` shows to everyone else.
 *
 * Home is always on the left and never swaps: the scorer is reading the score off a
 * phone, not a panel the teams stand under, so a change of ends would only move the
 * buttons under their thumb.
 */

const HOME = '#2563eb'
const AWAY = '#ef4444'

function SyncDot({ sync }: { sync: SyncState }) {
  const { t } = useTranslation('live')
  const tone = sync === 'synced' ? 'bg-green-500' : sync === 'offline' ? 'bg-red-500' : 'bg-amber-500 motion-safe:animate-pulse'
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn('h-2 w-2 rounded-full', tone)} />
      {t(`sync_${sync}`)}
    </span>
  )
}

function TeamPanel({
  side, name, color, state, disabled, onPlus, onMinus,
}: {
  side: Side
  name: string
  color: string
  state: ScoreState
  disabled: boolean
  onPlus: () => void
  onMinus: () => void
}) {
  const { t } = useTranslation('live')
  const points = side === 'a' ? state.points_a : state.points_b
  const sets = side === 'a' ? state.sets_won_a : state.sets_won_b
  const serving = state.serving_team === (side === 'a' ? 'left' : 'right')
  const won = closedWinner(state) === side
  return (
    <div
      className="flex min-w-0 flex-1 flex-col rounded-xl border-2 bg-card p-2 sm:p-3"
      style={{ borderColor: color }}
    >
      <div className="flex min-h-11 items-start gap-1.5">
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        {/* Primary name: wraps, never truncated. */}
        <span className="min-w-0 flex-1 break-words text-sm font-bold leading-tight text-foreground">
          {name || (side === 'a' ? t('home') : t('away'))}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>{side === 'a' ? t('home') : t('away')}</span>
        <span className="font-semibold text-foreground">{t('sets')} {sets}</span>
      </div>

      <button
        type="button"
        onClick={onPlus}
        disabled={disabled}
        aria-label={t('addPointFor', { team: name || (side === 'a' ? t('home') : t('away')) })}
        className={cn(
          'relative mt-2 flex min-h-[40vh] flex-1 flex-col items-center justify-center rounded-lg text-white transition-transform active:scale-[0.98] disabled:opacity-50',
          won && 'ring-4 ring-amber-400',
        )}
        style={{ backgroundColor: color }}
      >
        {serving && (
          <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-bold uppercase text-gray-900">
            {t('serving')}
          </span>
        )}
        <span className="text-7xl font-extrabold tabular-nums leading-none sm:text-8xl">{points}</span>
        <Plus className="mt-3 h-8 w-8 opacity-80" />
      </button>

      <Button
        variant="outline"
        onClick={onMinus}
        disabled={disabled || points === 0}
        className="mt-2 w-full"
        icon={<Minus />}
      >
        {t('minusPoint')}
      </Button>
    </div>
  )
}

export default function ScorePage() {
  const { t } = useTranslation('live')
  const { gameId } = useParams<{ gameId: string }>()
  const confirm = useConfirm()
  const { state, meta, sync, apply, undoLast, canUndo } = useGameScoring(gameId)

  // Keep the screen on while scoring — a phone that dims mid-rally costs a point.
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> }
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } }
    let lock: Sentinel | null = null
    const grab = () => { nav.wakeLock?.request('screen').then((l) => { lock = l }).catch(() => {}) }
    grab()
    const onVisible = () => { if (document.visibilityState === 'visible') grab() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release().catch(() => {})
    }
  }, [])

  const game = meta?.game
  const home = game?.home_team ?? ''
  const away = game?.away_team ?? ''
  const canScore = meta?.can_score === true
  const isFinal = state.status === 'final'
  const closed = isSetClosed(state)
  const over = matchOver(state)
  const scoringDisabled = !canScore || isFinal

  const onFinish = async () => {
    if (!over && !(await confirm({ message: t('finishEarlyConfirm'), danger: true }))) return
    apply(finish)
  }

  if (meta && !canScore) {
    return (
      <div className="mx-auto w-full max-w-md p-4">
        <div className="rounded-xl border border-dashed bg-card p-8 text-center">
          <p className="text-base font-semibold text-foreground">{t('cannotScoreTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t(`cannotScore_${meta.code ?? 'not_participant'}`, t('cannotScore_not_participant'))}</p>
          <Button asChild variant="outline" className="mt-4">
            <Link to={`/live?channel=${meta.channel}`}>{t('watchLive')}</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col p-3 sm:p-6">
      <header className="mb-3 flex items-start gap-2">
        <Button asChild variant="ghost" size="icon" className="shrink-0">
          <Link to={gameId ? `/games/${gameId}` : '/games'} aria-label={t('backToGame')}><ArrowLeft /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold leading-tight text-foreground">{t('scoringTitle')}</h1>
          {game && (
            <TruncatedText
              className="block text-xs text-muted-foreground"
              text={[game.league, game.date ? formatDateZurich(game.date) : null, game.time ? formatTimeZurich(game.time) : null].filter(Boolean).join(' · ')}
            />
          )}
        </div>
        <div className="shrink-0 pt-1"><SyncDot sync={sync} /></div>
      </header>

      {/* Set strip: finished sets as pills, then the set being played. */}
      <div className="mb-3 flex min-h-8 flex-wrap items-center gap-1.5">
        {state.set_results.map((r, i) => (
          <span key={i} className="rounded-full border bg-card px-2.5 py-1 text-xs font-semibold tabular-nums text-foreground">
            {r.a}:{r.b}
          </span>
        ))}
        <span className="ml-auto rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground">
          {isFinal ? t('statusFinal') : t('set', { n: currentSet(state) })}
        </span>
      </div>

      <div className="flex gap-2 sm:gap-3">
        <TeamPanel
          side="a" name={home} color={HOME} state={state} disabled={scoringDisabled}
          onPlus={() => apply((s) => addPoint(s, 'a'))}
          onMinus={() => apply((s) => removePoint(s, 'a'))}
        />
        <TeamPanel
          side="b" name={away} color={AWAY} state={state} disabled={scoringDisabled}
          onPlus={() => apply((s) => addPoint(s, 'b'))}
          onMinus={() => apply((s) => removePoint(s, 'b'))}
        />
      </div>

      {/* Set / match end prompt — not modal, like point-hub: a mis-scored rally can
          still be corrected with "−" before moving on. */}
      {closed && !isFinal && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-center dark:border-amber-700 dark:bg-amber-950/40">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {over ? t('eventMatchEnd') : t('eventSetEnd')}
          </p>
          <Button className="mt-2 w-full" onClick={() => apply(over ? finish : nextSet)}>
            {over ? t('finishMatch') : t('nextSet')}
          </Button>
        </div>
      )}

      {/* Toolbar: own line on phones. */}
      <div className="mt-3 flex gap-2">
        <Button variant="outline" size="tool" onClick={undoLast} disabled={!canUndo || !canScore} icon={<Undo2 />}>
          {t('undo')}
        </Button>
        {isFinal ? (
          <Button variant="outline" size="tool" onClick={() => apply(reopen)} disabled={!canScore}>
            {t('reopenMatch')}
          </Button>
        ) : (
          <Button variant="outline" size="tool" onClick={onFinish} disabled={!canScore || state.status === 'idle'}>
            {t('finishMatch')}
          </Button>
        )}
        {meta && (
          <Button asChild variant="outline" size="tool">
            <Link to={`/live?channel=${meta.channel}`}><Eye />{t('watchLive')}</Link>
          </Button>
        )}
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">{t('scoringHint')}</p>
    </div>
  )
}

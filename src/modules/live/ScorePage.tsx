import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowLeftRight, Eye, Minus, Pencil, Plus, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import TruncatedText from '../../components/TruncatedText'
import { useConfirm } from '../../components/ConfirmProvider'
import { formatDateZurich, formatTimeZurich } from '../../utils/dateHelpers'
import {
  addPoint, closedWinner, currentSet, decidingSwitchDue, editSetResults, endsChanged, finish, isSetClosed,
  isValidSetScore, matchOver, nextSet, removePoint, reopen, type ScoreState, type Side,
} from './scoring'
import { useGameScoring, type SyncState } from './useGameScoring'

/**
 * Phone live scoring for one game — point-hub's console reduced to a phone at the side
 * of the court: Home and Away, a big "+" and a small "−" each, the sets, Undo and Next
 * set. No timeouts or substitutions. Publishes to `live_scores` channel `game-<id>`,
 * which `/live?channel=game-<id>` shows to everyone else — unless the hall scoreboard
 * is publishing that game itself; then the page says so and offers "Watch live".
 *
 * Home starts on the left. The panels change ends like the teams, as on point-hub: on
 * NEXT SET after sets 1–3, not into the deciding fifth (coin toss); in the fifth, the first
 * team to 8 brings up a "Switch sides?" prompt instead of an automatic swap. The automatic
 * part is derived from the score (`endsChanged`), so Undo takes it back with the set. On
 * top, "Switch sides" flips this phone by hand (remembered per game on the device) — e.g.
 * to start with the teams where they stand. The published row always keeps home as team A.
 *
 * Wiedikon is always blue, home or away, the opponent red — same rule as the endpoint's
 * row colours (live-scoring.js `teamColors`). A derby keeps home blue.
 */

const KSCW_COLOR = '#2563eb'
const OPPONENT_COLOR = '#ef4444'
const swapKey = (gameId: string) => `live-score-swap:${gameId}`
const switch8Key = (gameId: string) => `live-score-switch8:${gameId}`
const readFlag = (key: string) => { try { return localStorage.getItem(key) === '1' } catch { return false } }
const writeFlag = (key: string, on: boolean) => { try { localStorage.setItem(key, on ? '1' : '0') } catch { /* private mode */ } }

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
  side, name, color, state, loading, disabled, onPlus, onMinus,
}: {
  side: Side
  name: string
  color: string
  state: ScoreState
  /** First read not back yet: no 0:0 that is not the score. */
  loading: boolean
  disabled: boolean
  onPlus: () => void
  onMinus: () => void
}) {
  const { t } = useTranslation('live')
  const points = side === 'a' ? state.points_a : state.points_b
  const serving = !loading && state.serving_team === (side === 'a' ? 'left' : 'right')
  const won = closedWinner(state) === side
  return (
    // svrz card; the team colour stays on the dot and the score button (data colours).
    <div className="flex min-w-0 flex-1 flex-col rounded-2xl border border-hairline bg-card p-2 shadow-card sm:p-3">
      <div className="flex min-h-11 items-start gap-1.5">
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        {/* Primary name: wraps, never truncated. */}
        <span className="min-w-0 flex-1 break-words text-sm font-bold leading-tight text-foreground">
          {name || (side === 'a' ? t('home') : t('away'))}
        </span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{side === 'a' ? t('home') : t('away')}</div>

      <button
        type="button"
        onClick={onPlus}
        disabled={disabled}
        aria-label={t('addPointFor', { team: name || (side === 'a' ? t('home') : t('away')) })}
        className={cn(
          'relative mt-2 flex h-[clamp(7.5rem,27dvh,16rem)] flex-col items-center justify-center rounded-xl text-white transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background active:scale-[0.98] disabled:opacity-50',
          won && 'ring-4 ring-amber-400',
        )}
        style={{ backgroundColor: color }}
      >
        {serving && (
          <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-bold uppercase text-stone-900">
            {t('serving')}
          </span>
        )}
        <span className="text-7xl font-bold tabular-nums leading-none sm:text-8xl">{loading ? '–' : points}</span>
        <Plus className="mt-2 h-7 w-7 opacity-80" />
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

function EditSetsDialog({
  open, onOpenChange, state, home, away, onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: ScoreState
  home: string
  away: string
  onSave: (results: { a: number; b: number }[]) => void
}) {
  const { t } = useTranslation('live')
  const { t: tc } = useTranslation('common')
  // Mounted only while open (see ScorePage), so each opening starts from the current sets.
  const [draft, setDraft] = useState(() => state.set_results.map((r) => ({ a: String(r.a), b: String(r.b) })))

  const parsed = draft.map((d) => ({ a: Number(d.a), b: Number(d.b) }))
  const invalid = parsed.map((r, i) => draft[i].a === '' || draft[i].b === '' || !isValidSetScore(r.a, r.b, i))
  const anyInvalid = invalid.some(Boolean)
  const next = anyInvalid ? state : editSetResults(state, parsed)
  // Valid scores the rules still refuse: they would end the match mid-set.
  const endsMatch = !anyInvalid && next === state
    && parsed.some((r, i) => r.a !== state.set_results[i]?.a || r.b !== state.set_results[i]?.b)

  const set = (i: number, side: 'a' | 'b', v: string) =>
    setDraft((d) => d.map((r, j) => (j === i ? { ...r, [side]: v.replace(/\D/g, '').slice(0, 2) } : r)))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-sm rounded-2xl p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{t('editSets')}</DialogTitle>
          <DialogDescription>{t('editSetsHint')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 gap-y-2">
          <span />
          <span className="min-w-0 break-words text-center text-xs font-semibold text-muted-foreground">{home || t('home')}</span>
          <span className="min-w-0 break-words text-center text-xs font-semibold text-muted-foreground">{away || t('away')}</span>
          {draft.map((r, i) => (
            <div key={i} className="contents">
              <span className="pr-1 text-sm font-semibold text-foreground">{t('set', { n: i + 1 })}</span>
              {(['a', 'b'] as const).map((side) => (
                <Input
                  key={side}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={r[side]}
                  onChange={(e) => set(i, side, e.target.value)}
                  aria-label={`${t('set', { n: i + 1 })} · ${side === 'a' ? home || t('home') : away || t('away')}`}
                  aria-invalid={invalid[i] || undefined}
                  className={cn('text-center tabular-nums', invalid[i] && 'border-destructive')}
                />
              ))}
            </div>
          ))}
        </div>
        {(anyInvalid || endsMatch) && (
          <p className="text-xs text-destructive">{anyInvalid ? t('editSetsInvalid') : t('editSetsEndsMatch')}</p>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
          <Button
            disabled={anyInvalid || endsMatch}
            onClick={() => { onSave(parsed); onOpenChange(false) }}
          >
            {tc('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function ScorePage() {
  const { t } = useTranslation('live')
  const { gameId } = useParams<{ gameId: string }>()
  const confirm = useConfirm()
  const { state, meta, sync, apply, undoLast, canUndo } = useGameScoring(gameId)
  const [editing, setEditing] = useState(false)
  const [manualSwap, setManualSwap] = useState(() => (gameId ? readFlag(swapKey(gameId)) : false))
  const [switch8Done, setSwitch8Done] = useState(() => (gameId ? readFlag(switch8Key(gameId)) : false))
  const toggleSwap = () => {
    setManualSwap((v) => {
      if (gameId) writeFlag(swapKey(gameId), !v)
      return !v
    })
  }
  const closeSwitch8 = (swap: boolean) => {
    if (swap) toggleSwap()
    if (gameId) writeFlag(switch8Key(gameId), true)
    setSwitch8Done(true)
  }
  const swapped = manualSwap !== endsChanged(state)

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
  const wiedikonAway = game?.type === 'away' && !/wiedikon/i.test(home)
  const homeColor = wiedikonAway ? OPPONENT_COLOR : KSCW_COLOR
  const awayColor = wiedikonAway ? KSCW_COLOR : OPPONENT_COLOR

  const onFinish = async () => {
    if (!over && !(await confirm({ message: t('finishEarlyConfirm'), danger: true }))) return
    apply(finish)
  }

  if (meta && !canScore) {
    return (
      <div className="mx-auto w-full max-w-md p-4">
        <div className="rounded-2xl border border-hairline bg-card p-8 text-center shadow-card">
          <p className="text-sm font-semibold text-foreground">{t(`cannotScoreTitle_${meta.code ?? ''}`, t('cannotScoreTitle'))}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t(`cannotScore_${meta.code ?? 'not_participant'}`, t('cannotScore_not_participant'))}</p>
          <Button asChild variant="outline" className="mt-4">
            <Link to={`/live?channel=${meta.channel}`}>{t('watchLive')}</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    // No own padding on a phone: the shell's is enough, and every pixel goes to the buttons.
    <div className="mx-auto flex w-full max-w-2xl flex-col sm:p-6">
      <header className="mb-2 flex items-start gap-2">
        <Button asChild variant="ghost" size="icon" className="shrink-0">
          <Link to={gameId ? `/games/${gameId}` : '/games'} aria-label={t('backToGame')}><ArrowLeft /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold leading-tight tracking-tight text-foreground">{t('scoringTitle')}</h1>
          {game && (
            <TruncatedText
              className="block text-xs text-muted-foreground"
              text={[game.league, game.date ? formatDateZurich(game.date) : null, game.time ? formatTimeZurich(game.time) : null].filter(Boolean).join(' · ')}
            />
          )}
        </div>
        <div className="shrink-0 pt-1"><SyncDot sync={sync} /></div>
      </header>

      {/* Set strip: the set score, the finished sets as pills (tap to correct them), then
          the set being played. Everything in panel order, like the pills. */}
      <div className="mb-2 flex min-h-8 flex-wrap items-center gap-1.5">
        <span className="mr-0.5 whitespace-nowrap text-sm font-bold tabular-nums text-foreground">
          {t('sets')} {!meta ? '–' : swapped ? `${state.sets_won_b}:${state.sets_won_a}` : `${state.sets_won_a}:${state.sets_won_b}`}
        </span>
        {state.set_results.map((r, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setEditing(true)}
            disabled={!canScore}
            aria-label={`${t('editSets')}: ${t('set', { n: i + 1 })} ${r.a}:${r.b}`}
            className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border bg-card px-2 text-xs font-semibold tabular-nums text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {/* In panel order, so a swapped phone reads its left team first. */}
            {swapped ? `${r.b}:${r.a}` : `${r.a}:${r.b}`}
            <Pencil className="h-3 w-3 text-muted-foreground" aria-hidden />
          </button>
        ))}
        {meta && (
          <span className="ml-auto rounded-full bg-selected px-2.5 py-1 text-xs font-semibold tabular-nums text-selected-foreground">
            {isFinal ? t('statusFinal') : t('set', { n: currentSet(state) })}
          </span>
        )}
      </div>

      <div className={cn('flex gap-2 sm:gap-3', swapped && 'flex-row-reverse')}>
        <TeamPanel
          side="a" name={home} color={homeColor} state={state} loading={!meta} disabled={scoringDisabled}
          onPlus={() => apply((s) => addPoint(s, 'a'))}
          onMinus={() => apply((s) => removePoint(s, 'a'))}
        />
        <TeamPanel
          side="b" name={away} color={awayColor} state={state} loading={!meta} disabled={scoringDisabled}
          onPlus={() => apply((s) => addPoint(s, 'b'))}
          onMinus={() => apply((s) => removePoint(s, 'b'))}
        />
      </div>

      {editing && <EditSetsDialog
        open={editing}
        onOpenChange={setEditing}
        state={state}
        home={home}
        away={away}
        onSave={(results) => apply((s) => editSetResults(s, results))}
      />}

      {/* Set / match end prompt — not modal, like point-hub: a mis-scored rally can
          still be corrected with "−" before moving on. */}
      {closed && !isFinal && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-center dark:border-amber-900/60 dark:bg-amber-950/40">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            {over ? t('eventMatchEnd') : t('eventSetEnd')}
          </p>
          <Button className="mt-2 w-full" onClick={() => apply(over ? finish : nextSet)}>
            {over ? t('finishMatch') : t('nextSet')}
          </Button>
        </div>
      )}

      {/* Deciding set, first to 8: point-hub asks too, it never swaps by itself. */}
      {decidingSwitchDue(state) && !switch8Done && !isFinal && canScore && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/60 dark:bg-amber-950/40">
          <p className="min-w-0 flex-1 text-sm font-semibold text-amber-800 dark:text-amber-300">{t('switchDue')}</p>
          <Button size="sm" onClick={() => closeSwitch8(true)} icon={<ArrowLeftRight />}>{t('switchSides')}</Button>
          <Button size="sm" variant="ghost" onClick={() => closeSwitch8(false)}>{t('notNow')}</Button>
        </div>
      )}

      {/* Toolbar: own line on phones. */}
      <div className="mt-2 flex gap-2">
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
        {/* Icon only on a phone, so the toolbar keeps one line. */}
        <Button
          variant="outline" size="tool" onClick={toggleSwap} aria-label={t('switchSides')} title={t('switchSides')}
          className="max-sm:w-11 max-sm:flex-none max-sm:basis-auto" icon={<ArrowLeftRight />}
        >
          <span className="max-sm:sr-only">{t('switchSides')}</span>
        </Button>
      </div>
    </div>
  )
}

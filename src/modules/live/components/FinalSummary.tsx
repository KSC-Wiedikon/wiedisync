import { Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { buildFinalView, formatDuration, type BasketballEnd } from '../final'
import { readableOn } from '../scoreboard'
import type { BoardState } from '../types'
import TeamIdentity from './TeamIdentity'

function basketballEndLabel(end: BasketballEnd, t: TFunction<'live'>): string {
  switch (end.kind) {
    case 'regulation': return t('finalAfterRegulation')
    case 'overtime': return t('finalAfterOvertime', { label: t('overtimeN', { n: end.n }) })
    case 'partial': return t('finalAfterQuarter', { label: t('quarter', { n: end.n }) })
  }
}

/**
 * The match-over view. When the row reports `final`, this REPLACES the live board
 * — the big last-set points, TO/Sub line and serve dot only describe the moment
 * the last rally was won, which is noise once the match is decided.
 *
 * It answers what a spectator arriving late actually wants: who won, by what, and
 * (volleyball/beach) how each set went and how long it took. Set durations come
 * from the board's monotonic clock and are optional per set — a missing one shows
 * "—", and the match total appears only when every set was timed. Basketball has
 * no per-quarter scores on the row, so it shows the final points and how many
 * periods were played.
 *
 * A draw is possible on a board that was stopped mid-match (or corrected by hand),
 * so it renders a neutral line rather than inventing a winner.
 */
export default function FinalSummary({ state }: { state: BoardState }) {
  const { t } = useTranslation('live')
  const view = buildFinalView(state)
  const [a, b] = view.teams
  const winner = view.winner === null ? null : view.teams[view.winner]
  const dur = (s: number) => formatDuration(s, (key, opts) => t(key, opts))

  return (
    // No "Final" label here: the header's status pill already says it, right above this card.
    <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      {winner ? (
        <p className="flex flex-wrap items-center justify-center gap-2 text-base font-bold text-foreground sm:text-lg">
          <Trophy className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span
            className="inline-flex max-w-full items-center rounded-md px-2 py-0.5 text-sm font-bold uppercase tracking-wide ring-1 ring-black/10 dark:ring-white/15"
            style={{ backgroundColor: winner.color, color: readableOn(winner.color) }}
          >
            <span className="min-w-0 break-words">{winner.short || t('teamFallback')}</span>
          </span>
          {t('wonMatch')}
        </p>
      ) : (
        <p className="text-center text-base font-bold text-foreground sm:text-lg">
          {t('finalNoWinner')}
        </p>
      )}

      {/* Both teams either side of the final result, aligned like the live board. */}
      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4">
        <TeamIdentity team={a} align="start" sport={view.sport} />
        <div className="px-1 text-center">
          <div className="text-3xl font-black tabular-nums text-foreground sm:text-4xl">
            {view.score[0]}
            <span className="mx-1 text-muted-foreground/60">:</span>
            {view.score[1]}
          </div>
          <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            {view.bySets ? t('sets') : t('points')}
          </div>
        </div>
        <TeamIdentity team={b} align="end" sport={view.sport} />
      </div>

      {view.basketballEnd && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          {basketballEndLabel(view.basketballEnd, t)}
        </p>
      )}

      {view.sets.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('finalSetCol')}</TableHead>
                <TableHead className="text-center">{t('finalScoreCol')}</TableHead>
                <TableHead className="text-right">{t('finalDurationCol')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.sets.map((s) => (
                <TableRow key={s.n} className="h-11">
                  <TableCell className="font-medium">{t('set', { n: s.n })}</TableCell>
                  <TableCell className="text-center font-semibold tabular-nums">
                    <span className={cn(s.winner !== 0 && 'text-muted-foreground')}>{s.a}</span>
                    <span className="mx-0.5 text-muted-foreground/60">:</span>
                    <span className={cn(s.winner !== 1 && 'text-muted-foreground')}>{s.b}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {s.dur === null ? '—' : dur(s.dur)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {view.totalDur !== null && (
              <TableFooter>
                <TableRow className="h-11">
                  <TableCell colSpan={2} className="font-semibold">
                    {t('finalMatchTime')}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {dur(view.totalDur)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      )}
    </div>
  )
}

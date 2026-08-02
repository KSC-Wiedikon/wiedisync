import { Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { readableOn, toTeams } from '../scoreboard'
import type { BoardState } from '../types'

/**
 * The match-end banner, shown above the board when the row reports `final`.
 *
 * The board below still carries the detail (set chips, fouls, timeouts) — this
 * only answers the one question a spectator arriving late actually has: who won,
 * and by what. Volleyball/beach are decided on SETS, basketball on points, so the
 * headline result differs by sport even though the winner logic doesn't.
 *
 * A draw is possible on a board that was stopped mid-match (or corrected by hand),
 * so it renders a neutral "Final" rather than inventing a winner.
 */
export default function FinalSummary({ state }: { state: BoardState }) {
  const { t } = useTranslation('live')
  const [a, b] = toTeams(state)
  const bySets = state.sport !== 'basketball'

  const scoreA = bySets ? a.sets : a.points
  const scoreB = bySets ? b.sets : b.points
  const winner = scoreA > scoreB ? a : scoreB > scoreA ? b : null

  return (
    <div className="mb-3 rounded-xl border bg-card p-4 text-center shadow-sm">
      <div className="flex items-center justify-center gap-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
        {t('statusFinal')}
      </div>

      {winner ? (
        <p className="mt-2 flex flex-wrap items-center justify-center gap-2 text-base font-bold text-foreground sm:text-lg">
          <span
            className="inline-flex max-w-full items-center rounded-md px-2 py-0.5 text-sm font-bold uppercase tracking-wide ring-1 ring-black/10 dark:ring-white/15"
            style={{ backgroundColor: winner.color, color: readableOn(winner.color) }}
          >
            <span className="truncate">{winner.short || t('teamFallback')}</span>
          </span>
          {t('wonMatch')}
        </p>
      ) : (
        <p className="mt-2 text-base font-bold text-foreground sm:text-lg">{t('finalNoWinner')}</p>
      )}

      <p className="mt-1 text-2xl font-black tabular-nums text-foreground sm:text-3xl">
        {scoreA}
        <span className="mx-1 text-muted-foreground/60">:</span>
        {scoreB}
      </p>
      <p className="text-[11px] text-muted-foreground">{bySets ? t('sets') : t('points')}</p>
    </div>
  )
}

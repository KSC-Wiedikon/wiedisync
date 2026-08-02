import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { cn } from '@/lib/utils'
import { toTeams } from '../scoreboard'
import type { BoardState, TeamView } from '../types'
import TeamIdentity from './TeamIdentity'

/**
 * 1..4 = Q1..Q4, 5+ = overtime (OT1, OT2, …). 0 means the board isn't publishing it.
 *
 * Mirrors `periodLabel()` in the board's basketballSource.js exactly — including
 * OT1 rather than a bare OT — so the phone and the LED panel in the hall never
 * disagree about which period is being played.
 */
function periodLabel(period: number, t: TFunction<'live'>): string | null {
  if (!period || period < 1) return null
  return period <= 4 ? t('quarter', { n: period }) : t('overtimeN', { n: period - 4 })
}

function TeamColumn({ team, align }: { team: TeamView; align: 'start' | 'end' }) {
  const { t } = useTranslation('live')
  const end = align === 'end'
  return (
    <div className={cn('min-w-0', end ? 'text-right' : 'text-left')}>
      {/* No indicator slot here: a badge beside the chip squeezes the team code to
          "BC…" on a phone. The bonus gets its own line under the meta instead. */}
      <TeamIdentity team={team} align={align} sport="basketball" />
      {/* Keyed on the score so a basket restarts the bump animation — see VolleyballBoard. */}
      <div
        key={team.points}
        className={cn(
          'mt-1 text-6xl font-black tabular-nums leading-none animate-score-bump sm:text-7xl',
          end ? 'origin-right' : 'origin-left',
        )}
      >
        {team.points}
      </div>
      <p className={cn('mt-2 text-[11px] text-muted-foreground', end ? 'text-right' : 'text-left')}>
        {t('foulsShort')} {team.fouls} · {t('toShort')} {team.timeouts}
      </p>
      <div className={cn('mt-1 flex min-h-4', end ? 'justify-end' : 'justify-start')}>
        {team.inBonus && (
          <span
            title={t('bonusHint')}
            className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400"
          >
            {t('bonus')}
          </span>
        )}
      </div>
    </div>
  )
}

/** Basketball: running score, period, team fouls + bonus, possession arrow. No sets. */
export default function BasketballBoard({ state }: { state: BoardState }) {
  const { t } = useTranslation('live')
  const [a, b] = toTeams(state)
  const period = periodLabel(state.period, t)
  // `serving_team` doubles as the possession arrow — same left/right semantics.
  const possession = state.serving_team

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4">
        <TeamColumn team={a} align="start" />

        <div className="px-1 text-center">
          <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            {t('period')}
          </div>
          <div className="text-2xl font-bold tabular-nums sm:text-4xl">{period ?? '—'}</div>
          {/* Possession arrow — points at the team that gets the next held-ball call. */}
          <div className="mt-1 flex h-6 items-center justify-center text-foreground">
            {possession === 'left' && (
              <ChevronLeft className="h-6 w-6" strokeWidth={3} aria-hidden="true" />
            )}
            {possession === 'right' && (
              <ChevronRight className="h-6 w-6" strokeWidth={3} aria-hidden="true" />
            )}
            {possession && (
              <span className="sr-only">
                {t('possessionOf', { team: (possession === 'left' ? a : b).short })}
              </span>
            )}
          </div>
        </div>

        <TeamColumn team={b} align="end" />
      </div>
    </div>
  )
}

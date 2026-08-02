import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { currentSetNumber, toTeams } from '../scoreboard'
import type { BoardState, TeamView } from '../types'
import TeamIdentity from './TeamIdentity'

/** The pulsing dot beside the team that is serving. */
function ServingDot({ label }: { label: string }) {
  return (
    <span
      title={label}
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-secondary ring-2 ring-secondary/40 motion-safe:animate-pulse"
    >
      <span className="sr-only">{label}</span>
    </span>
  )
}

function TeamColumn({
  team,
  align,
  isBeach,
}: {
  team: TeamView
  align: 'start' | 'end'
  isBeach: boolean
}) {
  const { t } = useTranslation('live')
  const end = align === 'end'
  return (
    <div className={cn('min-w-0', end ? 'text-right' : 'text-left')}>
      <TeamIdentity
        team={team}
        align={align}
        sport={isBeach ? 'beach' : 'volleyball'}
        indicator={team.serving ? <ServingDot label={t('serving')} /> : null}
      />
      {/* transition-colors keeps the number change gentle; disabled under reduced motion */}
      <div className="mt-1 text-6xl font-black tabular-nums leading-none transition-colors motion-reduce:transition-none sm:text-7xl">
        {team.points}
      </div>
      <p className={cn('mt-2 text-[11px] text-muted-foreground', end ? 'text-right' : 'text-left')}>
        {/* Beach has no substitutions — showing "Sub 0" forever would just be noise. */}
        {t('toShort')} {team.timeouts}
        {!isBeach && ` · ${t('subShort')} ${team.subs}`}
      </p>
    </div>
  )
}

/** Volleyball and beach: points in the current set, sets won, serve, set history. */
export default function VolleyballBoard({ state }: { state: BoardState }) {
  const { t } = useTranslation('live')
  const [a, b] = toTeams(state)
  const results = state.set_results ?? []
  const isBeach = state.sport === 'beach'

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      {/* Completed sets */}
      {results.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-center gap-1.5">
          {results.map((r, i) => (
            <span
              key={i}
              className="rounded-md border bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground"
              title={t('set', { n: i + 1 })}
            >
              <span className={cn(r.a > r.b && 'text-foreground')}>{r.a}</span>
              <span className="mx-0.5 text-muted-foreground/60">:</span>
              <span className={cn(r.b > r.a && 'text-foreground')}>{r.b}</span>
            </span>
          ))}
        </div>
      )}

      {/* Score row: big current-set points either side, set score in the middle */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4">
        <TeamColumn team={a} align="start" isBeach={isBeach} />
        <div className="px-1 text-center">
          <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            {t('sets')}
          </div>
          <div className="text-2xl font-bold tabular-nums sm:text-4xl">
            {a.sets}
            <span className="mx-1 text-muted-foreground/60">:</span>
            {b.sets}
          </div>
          <div className="mt-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            {t('set', { n: currentSetNumber(state) })}
          </div>
        </div>
        <TeamColumn team={b} align="end" isBeach={isBeach} />
      </div>
    </div>
  )
}

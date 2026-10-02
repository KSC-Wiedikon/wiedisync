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

/** A team's big current-set points. */
function TeamScore({ team, align }: { team: TeamView; align: 'start' | 'end' }) {
  const end = align === 'end'
  return (
    // `key` on the score remounts this node when a point lands, which restarts
    // the bump animation — no state, no timers. Honours reduced motion.
    <div
      key={team.points}
      className={cn(
        'text-6xl font-black tabular-nums leading-none animate-score-bump sm:text-7xl',
        end ? 'origin-right text-right' : 'origin-left text-left',
      )}
    >
      {team.points}
    </div>
  )
}

function TeamCounts({ team, align, isBeach }: { team: TeamView; align: 'start' | 'end'; isBeach: boolean }) {
  const { t } = useTranslation('live')
  return (
    <p className={cn('text-[11px] text-muted-foreground', align === 'end' ? 'text-right' : 'text-left')}>
      {/* Beach has no substitutions — showing "Sub 0" forever would just be noise. */}
      {t('toShort')} {team.timeouts}
      {!isBeach && ` · ${t('subShort')} ${team.subs}`}
    </p>
  )
}

/** Volleyball and beach: points in the current set, sets won, serve, set history. */
export default function VolleyballBoard({ state }: { state: BoardState }) {
  const { t } = useTranslation('live')
  const [a, b] = toTeams(state)
  const results = state.set_results ?? []
  const isBeach = state.sport === 'beach'
  const sport = isBeach ? 'beach' : 'volleyball'

  return (
    <div className="rounded-2xl border border-hairline bg-card p-4 shadow-card sm:p-6">
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

      {/* One grid, three rows: names on top, then the points with the set score
          between them, then TO · Sub. Each row is as tall as its taller side, so a
          long team name only makes the name row taller — the two scores and the
          TO · Sub lines stay level with each other whatever the names are. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-2 sm:gap-x-4">
        <div className="min-w-0 self-start">
          <TeamIdentity
            team={a}
            align="start"
            sport={sport}
            indicator={a.serving ? <ServingDot label={t('serving')} /> : null}
          />
        </div>
        <div aria-hidden="true" />
        <div className="min-w-0 self-start">
          <TeamIdentity
            team={b}
            align="end"
            sport={sport}
            indicator={b.serving ? <ServingDot label={t('serving')} /> : null}
          />
        </div>

        <TeamScore team={a} align="start" />
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
        <TeamScore team={b} align="end" />

        <div className="mt-1">
          <TeamCounts team={a} align="start" isBeach={isBeach} />
        </div>
        <div aria-hidden="true" />
        <div className="mt-1">
          <TeamCounts team={b} align="end" isBeach={isBeach} />
        </div>
      </div>
    </div>
  )
}

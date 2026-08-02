import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { BoardState, TeamView } from '../types'

/** Split a board snapshot into two side-agnostic team views (A=left by getState()). */
function toTeams(s: BoardState): [TeamView, TeamView] {
  return [
    {
      name: s.team_a_name, short: s.team_a_short || s.team_a_name, color: s.team_a_color,
      points: s.points_a, sets: s.sets_won_a, timeouts: s.timeouts_a, subs: s.subs_a,
      serving: s.serving_team === 'left',
    },
    {
      name: s.team_b_name, short: s.team_b_short || s.team_b_name, color: s.team_b_color,
      points: s.points_b, sets: s.sets_won_b, timeouts: s.timeouts_b, subs: s.subs_b,
      serving: s.serving_team === 'right',
    },
  ]
}

/** Pick a readable text colour (gray-900 or white) for a given team-colour background. */
function readableOn(hex: string): string {
  const h = (hex || '').replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return '#ffffff'
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#111827' : '#ffffff'
}

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

function TeamColumn({ team, align }: { team: TeamView; align: 'start' | 'end' }) {
  const { t } = useTranslation('live')
  const end = align === 'end'
  return (
    <div className={cn('min-w-0', end ? 'text-right' : 'text-left')}>
      <div className={cn('flex items-center gap-2', end && 'flex-row-reverse')}>
        {/* Short code on a chip in the team's own colour, with a contrast-picked text colour */}
        <span
          className="inline-flex min-w-0 items-center rounded-md px-2 py-1 text-base font-bold uppercase tracking-wide ring-1 ring-black/10 dark:ring-white/15 sm:text-lg"
          style={{ backgroundColor: team.color, color: readableOn(team.color) }}
        >
          <span className="truncate">{team.short || t('teamFallback')}</span>
        </span>
        {team.serving && <ServingDot label={t('serving')} />}
      </div>
      {team.name && team.name !== team.short && (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{team.name}</p>
      )}
      {/* transition-colors keeps the number change gentle; disabled under reduced motion */}
      <div className="mt-1 text-6xl font-black tabular-nums leading-none transition-colors motion-reduce:transition-none sm:text-7xl">
        {team.points}
      </div>
      <p className={cn('mt-2 text-[11px] text-muted-foreground', end ? 'text-right' : 'text-left')}>
        {t('toShort')} {team.timeouts} · {t('subShort')} {team.subs}
      </p>
    </div>
  )
}

export default function Scoreboard({ state }: { state: BoardState }) {
  const { t } = useTranslation('live')
  const [a, b] = toTeams(state)
  const results = state.set_results ?? []

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
        <TeamColumn team={a} align="start" />
        <div className="px-1 text-center">
          <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            {t('sets')}
          </div>
          <div className="text-2xl font-bold tabular-nums sm:text-4xl">
            {a.sets}
            <span className="mx-1 text-muted-foreground/60">:</span>
            {b.sets}
          </div>
        </div>
        <TeamColumn team={b} align="end" />
      </div>
    </div>
  )
}

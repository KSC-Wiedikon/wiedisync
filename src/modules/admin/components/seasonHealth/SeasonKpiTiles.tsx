// src/modules/admin/components/seasonHealth/SeasonKpiTiles.tsx
//
// Eight headline numbers for one sport tab, summed over its real squads
// (umbrella rows are skipped — they hold the same adults as the squads).
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { sportKpis, type TabTotals, type TeamSummaryRow } from '../../utils/seasonHealth'

function StatCard({ label, value, sub, tone = 'default' }: {
  label: string
  value: string | number
  sub?: string
  tone?: 'default' | 'danger' | 'warning' | 'success'
}) {
  const valueClass = tone === 'danger'
    ? 'text-red-600 dark:text-red-400'
    : tone === 'warning'
      ? 'text-amber-600 dark:text-amber-400'
      : tone === 'success'
        ? 'text-green-600 dark:text-green-400'
        : ''
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${valueClass}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

export default function SeasonKpiTiles({ teams, totals }: { teams: TeamSummaryRow[]; totals: TabTotals }) {
  const { t } = useTranslation('seasonHealth')
  const k = useMemo(() => sportKpis(teams), [teams])
  const ratio = (a: number, b: number) => `${a}/${b}`
  const ratioTone = (a: number, b: number): 'default' | 'warning' | 'success' =>
    b === 0 ? 'default' : a >= b ? 'success' : 'warning'
  const findings = totals.errors + totals.warnings

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard
        label={t('kpi_teams')}
        value={k.teams}
        sub={k.umbrellas > 0 ? t('kpi_teamsUmbrella', { count: k.umbrellas }) : undefined}
      />
      <StatCard
        label={t('kpi_players')}
        value={k.players}
        sub={k.guests > 0 ? t('kpi_playersGuests', { count: k.guests }) : undefined}
      />
      <StatCard
        label={t('kpi_licenceOk')}
        value={ratio(k.licenceOk, k.players)}
        tone={ratioTone(k.licenceOk, k.players)}
      />
      <StatCard
        label={t('kpi_duesPaid')}
        value={ratio(k.duesPaid, k.players)}
        tone={ratioTone(k.duesPaid, k.players)}
      />
      <StatCard
        label={t('kpi_teamsWithCoach')}
        value={ratio(k.teamsWithCoach, k.teams)}
        tone={k.teams > 0 && k.teamsWithCoach < k.teams ? 'danger' : ratioTone(k.teamsWithCoach, k.teams)}
      />
      <StatCard
        label={t('kpi_games')}
        value={k.games}
        sub={t('kpi_gamesSub', { played: k.gamesPlayed, upcoming: k.gamesUpcoming })}
      />
      <StatCard label={t('kpi_trainings')} value={k.trainings} sub={t('kpi_trainingsSub')} />
      <StatCard
        label={t('kpi_findings')}
        value={findings}
        sub={t('kpi_findingsSub', { errors: totals.errors, warnings: totals.warnings })}
        tone={totals.errors > 0 ? 'danger' : totals.warnings > 0 ? 'warning' : 'success'}
      />
    </div>
  )
}

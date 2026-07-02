import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Ranking } from '../../../types'
import TeamChip from '../../../components/TeamChip'
import { teamIds } from '../../../utils/teamColors'
import { formatNumberSwiss } from '../../../utils/formatNumber'

type SportKey = 'volleyball' | 'basketball'
type ScoreboardMode = 'absolute' | 'perGame'

interface KscwScoreboardProps {
  rankings: Ranking[]
}

interface MetricDef {
  key: string
  labelKey: string
  getValue: (row: Ranking) => number | null
}

interface MetricLeader {
  key: string
  labelKey: string
  value: number | null
  leaders: Ranking[]
}

interface MetricTotal {
  key: string
  labelKey: string
  value: number | null
}

interface ScoreboardSection {
  sportKey: SportKey
  season?: string
  rows: Ranking[]
  metrics: MetricDef[]
  leaders: MetricLeader[]
  totals: MetricTotal[]
  hasEnoughTeams: boolean
}

export default function KscwScoreboard({ rankings }: KscwScoreboardProps) {
  const { t } = useTranslation('games')
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})
  const [mode, setMode] = useState<ScoreboardMode>('perGame')

  const sections = useMemo<ScoreboardSection[]>(() => {
    const out: ScoreboardSection[] = []

    for (const sportKey of ['volleyball', 'basketball'] as const) {
      const metrics = getMetricsForSport(sportKey)
      const rows = rankings.filter((row) => {
        const isSport = sportKey === 'volleyball' ? row.team_id.startsWith('vb_') : row.team_id.startsWith('bb_')
        return isSport && !!teamIds[row.team_id]
      })

      if (rows.length < 2) {
        out.push({
          sportKey,
          rows: [],
          metrics,
          leaders: computeLeaders([], metrics),
          totals: computeTotals([], metrics),
          hasEnoughTeams: false,
        })
        continue
      }

      const latestSeason = rows
        .map((row) => row.season)
        .filter(Boolean)
        .sort((a, b) => b.localeCompare(a))[0]

      const seasonRows = latestSeason ? rows.filter((row) => row.season === latestSeason) : rows
      if (seasonRows.length < 2) {
        out.push({
          sportKey,
          season: latestSeason,
          rows: [],
          metrics,
          leaders: computeLeaders([], metrics),
          totals: computeTotals([], metrics),
          hasEnoughTeams: false,
        })
        continue
      }

      out.push({
        sportKey,
        season: latestSeason,
        rows: seasonRows,
        metrics,
        leaders: computeLeaders(seasonRows, metrics),
        totals: computeTotals(seasonRows, metrics),
        hasEnoughTeams: true,
      })
    }

    return out
  }, [rankings])

  // Derive the per-metric ranking rows + totals once per (sections, mode) instead
  // of recomputing them inside the JSX map on every render (e.g. row expand/collapse).
  const derivedBySection = useMemo(() => {
    const bySport = new Map<SportKey, Map<string, { rankingRows: Array<{ teamId: string; value: number }>; total: number | null }>>()
    for (const section of sections) {
      const perMetric = new Map<string, { rankingRows: Array<{ teamId: string; value: number }>; total: number | null }>()
      for (const metric of section.metrics) {
        const rankingRows = mode === 'perGame'
          ? computeMetricRankingPerGame(section.rows, metric.getValue)
          : computeMetricRanking(section.rows, metric.getValue)
        const total = mode === 'perGame'
          ? computePerGameAverage(section.rows, metric.getValue)
          : (section.totals.find((m) => m.key === metric.key)?.value ?? null)
        perMetric.set(metric.key, { rankingRows, total })
      }
      bySport.set(section.sportKey, perMetric)
    }
    return bySport
  }, [sections, mode])

  return (
    <div className="mb-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('scoreboardTitle')}</h2>
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-100 p-0.5 dark:border-gray-600 dark:bg-gray-700">
          <button
            type="button"
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${mode === 'absolute' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-600 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
            onClick={() => setMode('absolute')}
          >
            {t('scoreboardAbsolute')}
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${mode === 'perGame' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-600 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
            onClick={() => setMode('perGame')}
          >
            {t('scoreboardPerGame')}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {sections.map((section) => (
          <div key={section.sportKey} className="rounded-xl border border-gray-200 bg-white p-4 shadow-card dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                {`KSCW ${section.sportKey === 'volleyball' ? t('scoreboardVolleyball') : t('scoreboardBasketball')}`}
              </h3>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-200">
                {t('scoreboardTotalTeams', { count: section.rows.length })}
              </span>
            </div>

            {section.season && (
              <div className="mb-3">
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-200">
                  {t('scoreboardSeason', { season: section.season })}
                </span>
              </div>
            )}

            {!section.hasEnoughTeams ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('scoreboardNeedsTeams')}</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                      <th className="w-2/6 px-3 py-2 text-left">{t('scoreboardMetric')}</th>
                      <th className="w-1/6 px-3 py-2 text-center">{mode === 'perGame' ? t('scoreboardAvg') : t('breakdownTotal')}</th>
                      <th className="w-3/6 px-3 py-2 text-left">{t('scoreboardMost')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {section.metrics.map((metric) => {
                      const rowKey = `${section.sportKey}:${metric.key}`
                      const isExpanded = !!expandedRows[rowKey]
                      const derived = derivedBySection.get(section.sportKey)?.get(metric.key)
                      const rankingRows = derived?.rankingRows ?? []
                      const total = derived?.total ?? null
                      const topValue = rankingRows.length > 0 ? rankingRows[0].value : null
                      const topTeams = topValue === null ? [] : rankingRows.filter((entry) => entry.value === topValue)
                      const leaderPercent = mode === 'absolute' && topValue !== null && total !== null && total > 0
                        ? Math.round((topValue / total) * 100)
                        : null
                      return (
                        <Fragment key={metric.key}>
                          <tr
                            className="cursor-pointer transition-colors hover:bg-gray-50/70 dark:hover:bg-gray-700/30"
                            onClick={() =>
                              setExpandedRows((prev) => ({
                                ...prev,
                                [rowKey]: !prev[rowKey],
                              }))
                            }
                          >
                            <td className="w-2/6 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                              <span className="inline-flex items-center gap-1.5">
                                <span>{isExpanded ? '▾' : '▸'}</span>
                                {t(metric.labelKey)}
                              </span>
                            </td>
                            <td className="w-1/6 px-3 py-2 text-center font-semibold text-gray-900 dark:text-gray-100">
                            {total === null ? t('scoreboardUnavailable') : formatValue(total, mode)}
                            </td>
                            <td className="w-3/6 px-3 py-2">
                              {topValue === null || topTeams.length === 0 ? (
                                <span className="block text-center text-sm text-gray-500 dark:text-gray-400">{t('scoreboardUnavailable')}</span>
                              ) : (
                                <div className="flex min-w-0 flex-wrap justify-start gap-1.5">
                                  {topTeams.map((entry) => {
                                    const shortTeam = teamIds[entry.teamId]
                                    if (!shortTeam) return null
                                    const valueLabel = leaderPercent === null
                                      ? `${shortTeam} - ${formatValue(topValue, mode)}`
                                      : `${shortTeam} - ${formatValue(topValue, mode)} (${leaderPercent}%)`
                                    return <TeamChip key={entry.teamId} team={shortTeam} size="sm" label={valueLabel} />
                                  })}
                                </div>
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={3} className="bg-gray-50/60 px-3 py-2 dark:bg-gray-700/20">
                                {rankingRows.length === 0 || total === null || total <= 0 ? (
                                  <span className="text-sm text-gray-500 dark:text-gray-400">{t('scoreboardUnavailable')}</span>
                                ) : (
                                  <div>
                                    <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                                      <table className="w-full text-sm">
                                      <thead>
                                        <tr className="border-b border-gray-200 bg-gray-100/70 text-xs font-medium uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                                          <th className="px-3 py-1.5 text-center">{t('rank')}</th>
                                          <th className="px-3 py-1.5 text-left">{t('teamCol')}</th>
                                          <th className="px-3 py-1.5 text-center">{t(metric.labelKey)}</th>
                                          <th className="px-3 py-1.5 text-center">{t('scoreboardPercent')}</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                        {rankingRows.map((entry, idx) => {
                                          const shortTeam = teamIds[entry.teamId]
                                          if (!shortTeam) return null
                                          const prev = idx > 0 ? rankingRows[idx - 1] : null
                                          const rank = prev && prev.value === entry.value ? idx : idx + 1
                                          const pct = mode === 'absolute' && total > 0 ? Math.round((entry.value / total) * 100) : null
                                          return (
                                            <tr key={entry.teamId}>
                                              <td className="px-2 py-1.5 text-center text-xs text-gray-500 dark:text-gray-400">#{rank}</td>
                                              <td className="px-2 py-1.5 text-left">
                                                <span className="inline-flex">
                                                  <TeamChip team={shortTeam} size="sm" label={shortTeam} />
                                                </span>
                                              </td>
                                              <td className="px-2 py-1.5 text-center font-medium text-gray-700 dark:text-gray-300">
                                                {formatValue(entry.value, mode)}
                                              </td>
                                              <td className="px-2 py-1.5 text-center font-medium text-gray-700 dark:text-gray-300">
                                                {pct !== null ? `${pct}%` : '–'}
                                              </td>
                                            </tr>
                                          )
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function formatValue(value: number, mode: ScoreboardMode): string {
  if (mode === 'perGame') {
    return value.toFixed(1)
  }
  return formatNumberSwiss(value)
}

function computePerGameAverage(rows: Ranking[], getValue: (row: Ranking) => number | null): number | null {
  let totalValue = 0
  let totalPlayed = 0
  for (const row of rows) {
    const value = getValue(row)
    if (value === null) continue
    totalValue += value
    totalPlayed += row.played || 0
  }
  return totalPlayed > 0 ? totalValue / totalPlayed : null
}

function computeMetricRankingPerGame(rows: Ranking[], getValue: (row: Ranking) => number | null): Array<{ teamId: string; value: number }> {
  const sumByTeam = new Map<string, { totalValue: number; totalPlayed: number }>()

  for (const row of rows) {
    const value = getValue(row)
    if (value === null || row.played <= 0) continue
    const existing = sumByTeam.get(row.team_id)
    if (existing) {
      existing.totalValue += value
      existing.totalPlayed += row.played
    } else {
      sumByTeam.set(row.team_id, { totalValue: value, totalPlayed: row.played })
    }
  }

  return [...sumByTeam.entries()]
    .map(([teamId, { totalValue, totalPlayed }]) => ({ teamId, value: totalValue / totalPlayed }))
    .sort((a, b) => (b.value - a.value) || a.teamId.localeCompare(b.teamId))
}

function computeLeaders(rows: Ranking[], metrics: MetricDef[]): MetricLeader[] {
  return metrics.map((metric) => {
    // Aggregate per team first (sum), then find the leader
    const sumByTeam = new Map<string, { total: number; row: Ranking }>()
    for (const row of rows) {
      const value = metric.getValue(row)
      if (value === null) continue
      const existing = sumByTeam.get(row.team_id)
      if (existing) {
        existing.total += value
      } else {
        sumByTeam.set(row.team_id, { total: value, row })
      }
    }

    if (sumByTeam.size === 0) return { key: metric.key, labelKey: metric.labelKey, value: null, leaders: [] }

    const maxValue = Math.max(...[...sumByTeam.values()].map((e) => e.total))
    const leaders = [...sumByTeam.values()]
      .filter((e) => e.total === maxValue)
      .map((e) => e.row)
      .sort((a, b) => a.rank - b.rank)

    return { key: metric.key, labelKey: metric.labelKey, value: maxValue, leaders }
  })
}

function computeTotals(rows: Ranking[], metrics: MetricDef[]): MetricTotal[] {
  return metrics.map((metric) => {
    // Aggregate per team first (sum), then sum across teams
    const sumByTeam = new Map<string, number>()
    for (const row of rows) {
      const value = metric.getValue(row)
      if (value === null) continue
      sumByTeam.set(row.team_id, (sumByTeam.get(row.team_id) ?? 0) + value)
    }
    if (sumByTeam.size === 0) return { key: metric.key, labelKey: metric.labelKey, value: null }
    const total = [...sumByTeam.values()].reduce((acc, v) => acc + v, 0)
    return { key: metric.key, labelKey: metric.labelKey, value: total }
  })
}

function computeMetricRanking(rows: Ranking[], getValue: (row: Ranking) => number | null): Array<{ teamId: string; value: number }> {
  const sumByTeam = new Map<string, number>()

  for (const row of rows) {
    const value = getValue(row)
    if (value === null) continue
    sumByTeam.set(row.team_id, (sumByTeam.get(row.team_id) ?? 0) + value)
  }

  return [...sumByTeam.entries()]
    .map(([teamId, value]) => ({ teamId, value }))
    .sort((a, b) => (b.value - a.value) || a.teamId.localeCompare(b.teamId))
}

function safeNumber(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function optionalNumber(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}


const VOLLEYBALL_METRICS: MetricDef[] = [
  { key: 'points', labelKey: 'scoreboardRankingPoints', getValue: (row) => safeNumber(row.points) },
  { key: 'won', labelKey: 'scoreboardWins', getValue: (row) => safeNumber(row.won) },
  { key: 'wins_narrow', labelKey: 'scoreboardNarrowWins', getValue: (row) => optionalNumber(row.wins_narrow) },
  { key: 'lost', labelKey: 'scoreboardLosses', getValue: (row) => safeNumber(row.lost) },
  { key: 'defeats_narrow', labelKey: 'scoreboardNarrowLosses', getValue: (row) => optionalNumber(row.defeats_narrow) },
  { key: 'sets_won', labelKey: 'scoreboardSetsWon', getValue: (row) => safeNumber(row.sets_won) },
  { key: 'sets_lost', labelKey: 'scoreboardSetsLost', getValue: (row) => safeNumber(row.sets_lost) },
  { key: 'points_won', labelKey: 'scoreboardPointsWon', getValue: (row) => safeNumber(row.points_won) },
  { key: 'points_lost', labelKey: 'scoreboardPointsLost', getValue: (row) => safeNumber(row.points_lost) },
]

const BASKETBALL_METRICS: MetricDef[] = [
  { key: 'points', labelKey: 'scoreboardRankingPoints', getValue: (row) => safeNumber(row.points) },
  { key: 'won', labelKey: 'scoreboardWins', getValue: (row) => safeNumber(row.won) },
  { key: 'lost', labelKey: 'scoreboardLosses', getValue: (row) => safeNumber(row.lost) },
  { key: 'points_won', labelKey: 'scoreboardPointsWon', getValue: (row) => safeNumber(row.points_won) },
  { key: 'points_lost', labelKey: 'scoreboardPointsLost', getValue: (row) => safeNumber(row.points_lost) },
]

function getMetricsForSport(sportKey: SportKey): MetricDef[] {
  return sportKey === 'volleyball' ? VOLLEYBALL_METRICS : BASKETBALL_METRICS
}

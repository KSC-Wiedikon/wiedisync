import { Fragment, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import type { Game, Ranking } from '../../../types'
import TeamChip from '../../../components/TeamChip'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { useKscwRankingTeams } from '../../../hooks/useKscwRankingTeams'
import { getPromotionColor, promotionBorderColors } from '../../../utils/leaguePromotion'
import { formatNumberSwiss } from '../../../utils/formatNumber'
import { useCollection } from '../../../lib/query'
import { formatDayMonthZurich, formatTime, formatWeekday, todayLocal } from '../../../utils/dateHelpers'
import { DateRail, RowChip, RowList, RowStripe } from '../../../components/ActivityRow'
import type { RowTone } from '../../../components/activityRowTokens'
import { applyProvisionalToRankings, type RankingRow } from '../../../utils/gameResult'
import { ProvisionalPill } from './GameResultPanel'

interface RankingsTableProps {
  league: string
  rankings: Ranking[]
  /** Hide sets/points/quotient columns (homepage sidebar) */
  compact?: boolean
  /** Played KSCW games with a provisional result (migration 395), not yet official.
   *  Counted into the standings and marked, until the SV feed catches up. */
  provisionalGames?: Game[]
  /** Ranking team_ids (`vb_…`/`bb_…`) of the KSCW teams picked in the team filter.
   *  When set, the drill-down only lists games involving one of those teams —
   *  an opponent row of a league shared by H1 + H3 shows only H3's fixtures. */
  focusTeamIds?: ReadonlySet<string>
}

export default function RankingsTable({ league, rankings, compact, provisionalGames, focusTeamIds }: RankingsTableProps) {
  const { t } = useTranslation('games')
  const { t: tl } = useTranslation('live')
  const navigate = useNavigate()
  const rows: RankingRow[] = useMemo(
    () => (provisionalGames?.length ? applyProvisionalToRankings(rankings, provisionalGames) : rankings),
    [rankings, provisionalGames],
  )
  const hasProvisional = rows.some((r) => r.provisional)
  const sorted = [...rows].sort((a, b) => a.rank - b.rank)
  const isBasketball = rankings.some((r) => r.team_id.startsWith('bb_'))
  const totalTeams = sorted.length
  const [breakdown, setBreakdown] = useState<{ row: Ranking; mode: 'win' | 'loss' } | null>(null)
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null)
  const kscwTeams = useKscwRankingTeams()

  // Fetch all games for this league (skip in compact/homepage mode — no accordion).
  // Deferred until the first row is expanded: the games only feed the accordion
  // drill-down, so an unexpanded table (the common case, one per league on the
  // rankings tab) never fires this 500-row query.
  // Scope to the season of the table being shown so old-season games don't leak in.
  const tableSeason = rankings[0]?.season
  const { data: leagueGamesRaw, isLoading: leagueGamesLoading } = useCollection<Game>('games', {
    filter: tableSeason
      ? { _and: [{ league: { _eq: league } }, { season: { _eq: tableSeason } }] }
      : { league: { _eq: league } },
    sort: ['-date', '-time'],
    limit: 500,
    enabled: !compact && expandedTeamId !== null,
  })
  // An intra-club derby is two `games` rows sharing a game_id (one per side) —
  // list it once, preferring the row that already carries the result.
  const leagueGames = useMemo(() => {
    const byKey = new Map<string, Game>()
    for (const g of leagueGamesRaw ?? []) {
      const key = g.game_id || g.id
      const cur = byKey.get(key)
      if (!cur || (cur.status !== 'completed' && g.status === 'completed')) byKey.set(key, g)
    }
    return [...byKey.values()]
  }, [leagueGamesRaw])

  // Names of the KSCW teams whose games the drill-down is about: the teams picked
  // in the filter when any of them play in this league, otherwise every KSCW team.
  const kscwTeamNames = useMemo(() => {
    const all = rankings.filter((r) => kscwTeams.has(r.team_id))
    const focused = focusTeamIds?.size ? all.filter((r) => focusTeamIds.has(r.team_id)) : []
    return new Set((focused.length ? focused : all).map((r) => r.team_name))
  }, [rankings, focusTeamIds, kscwTeams])
  const today = todayLocal()

  function getTeamLabel(row: Ranking): string {
    return row.team_name || `Team ${row.team_id}`
  }

  function hasBreakdownData(row: Ranking): boolean {
    return (
      typeof row.wins_clear === 'number'
      && typeof row.wins_narrow === 'number'
      && typeof row.defeats_clear === 'number'
      && typeof row.defeats_narrow === 'number'
    )
  }

  /** Get games to show for an expanded row */
  function getGamesForRow(row: Ranking): Game[] {
    const teamName = row.team_name

    if (kscwTeamNames.has(teamName)) {
      // Focused KSCW team: show ALL their games
      return leagueGames.filter(
        (g) => g.home_team === teamName || g.away_team === teamName,
      )
    } else {
      // Opponent (or a KSCW team outside the filter): only games against a focused KSCW team
      return leagueGames.filter(
        (g) =>
          (g.home_team === teamName && kscwTeamNames.has(g.away_team)) ||
          (g.away_team === teamName && kscwTeamNames.has(g.home_team)),
      )
    }
  }

  function toggleExpanded(teamId: string) {
    setExpandedTeamId((prev) => (prev === teamId ? null : teamId))
  }

  const winsClear = breakdown?.row.wins_clear ?? 0
  const winsNarrow = breakdown?.row.wins_narrow ?? 0
  const lossesClear = breakdown?.row.defeats_clear ?? 0
  const lossesNarrow = breakdown?.row.defeats_narrow ?? 0

  // Count visible columns for the expanded row colspan
  const colCount = isBasketball ? 7 : 6 + 2 /* sets+SQ on sm */ + 2 /* pf:pa+PQ on lg */

  return (
    <>
      <div className="rounded-2xl border border-hairline bg-card shadow-card overflow-hidden">
        <div className="border-b border-border/60 bg-surface-sunken px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">{league}</h3>
          {hasProvisional && (
            <p className="mt-0.5 text-xs text-muted-foreground">{tl('result_rankingsNote')}</p>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className={`${compact ? 'w-10 px-3' : 'w-8 px-2'} py-2.5 text-center`}>{t('rank')}</th>
                <th className={`${compact ? 'w-12 px-3' : 'w-10 px-2'} py-2.5 text-center`}>{t('points')}</th>
                <th className={`${compact ? 'px-3' : 'px-2'} py-2.5`}>{t('teamCol')}</th>
                <th className={`${compact ? 'w-12 px-3' : 'w-10 px-2'} py-2.5 text-center`}>{t('played')}</th>
                <th className={`${compact ? 'w-12 px-3' : 'w-10 px-2'} py-2.5 text-center ${isBasketball ? 'hidden sm:table-cell' : ''}`}>{t('won')}</th>
                <th className={`${compact ? 'w-12 px-3' : 'w-10 px-2'} py-2.5 text-center ${isBasketball ? 'hidden sm:table-cell' : ''}`}>{t('lost')}</th>
                {!compact && (isBasketball ? (
                  <>
                    <th className="w-16 px-2 py-2.5 text-center">{t('pointsFor')} : {t('pointsAgainst')}</th>
                  </>
                ) : (
                  <>
                    <th className="hidden w-20 px-2 py-2.5 text-center sm:table-cell">{t('sets')}</th>
                    <th className="hidden w-12 px-2 py-2.5 text-center sm:table-cell">{t('setsQuotient', { defaultValue: 'SQ' })}</th>
                    <th className="hidden w-24 px-2 py-2.5 text-center lg:table-cell">{t('pointsFor')} : {t('pointsAgainst')}</th>
                    <th className="hidden w-12 px-2 py-2.5 text-center lg:table-cell">{t('pointsQuotient', { defaultValue: 'PQ' })}</th>
                  </>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {sorted.map((row) => {
                const kscwTeam = kscwTeams.get(row.team_id)
                const isKscw = !!kscwTeam
                const promoColor = getPromotionColor(league, row.rank, totalTeams, row.team_name, sorted)
                const promoBorder = promoColor ? promotionBorderColors[promoColor] : ''
                const canShowBreakdown = !compact && !isBasketball && hasBreakdownData(row)
                const isExpanded = !compact && expandedTeamId === row.team_id
                const rowGames = isExpanded ? getGamesForRow(row) : []

                return (
                  <Fragment key={row.id}>
                    <tr
                      className={`cursor-pointer select-none transition-colors hover:bg-muted/70 ${isKscw ? 'bg-brand-50 dark:bg-brand-900/20 font-semibold' : ''} ${promoBorder}`}
                      onClick={() => compact ? navigate('/games?tab=rankings') : toggleExpanded(row.team_id)}
                    >
                      <td className={`${compact ? 'px-3 py-3' : 'px-2 py-2'} text-center text-muted-foreground`}>{row.rank}</td>
                      <td className={`${compact ? 'px-3 py-3' : 'px-2 py-2'} text-center font-bold text-foreground`}>{row.points}</td>
                      <td className={`${compact ? 'px-3 py-3' : 'max-w-0 px-2 py-2'}`}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          {kscwTeam ? (
                            <TeamChip team={kscwTeam.colorKey} label={`KSC Wiedikon ${kscwTeam.label}`} size="sm" />
                          ) : (
                            <span
                              title={row.team_name || `Team ${row.team_id}`}
                              className={`${compact ? 'whitespace-nowrap' : 'truncate'} text-foreground/85`}
                            >
                              {row.team_name || `Team ${row.team_id}`}
                            </span>
                          )}
                          {row.provisional && <ProvisionalPill className="shrink-0" />}
                          {!compact && <ChevronDown className={`ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground/80 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />}
                        </div>
                      </td>
                      <td className={`${compact ? 'px-3 py-3' : 'px-2 py-2'} text-center text-foreground/85`}>{row.played}</td>
                      <td className={`${compact ? 'px-3 py-3' : 'px-2 py-2'} text-center text-green-600 dark:text-green-400 ${isBasketball ? 'hidden sm:table-cell' : ''}`}>
                        {canShowBreakdown ? (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="mx-auto px-1.5 text-sm font-normal sm:hidden"
                              onClick={(e) => { e.stopPropagation(); setBreakdown({ row, mode: 'win' }) }}
                              aria-label={`${t('won')} ${getTeamLabel(row)}`}
                            >
                              {row.won}
                            </Button>
                            <div className="hidden flex-col items-center leading-tight sm:flex">
                              <span>{row.won}</span>
                              <span className="text-[10px] font-normal text-muted-foreground">
                                {`${row.wins_clear ?? 0}/${row.wins_narrow ?? 0}`}
                              </span>
                            </div>
                          </>
                        ) : row.won}
                      </td>
                      <td className={`${compact ? 'px-3 py-3' : 'px-2 py-2'} text-center text-red-500 dark:text-red-400 ${isBasketball ? 'hidden sm:table-cell' : ''}`}>
                        {canShowBreakdown ? (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="mx-auto px-1.5 text-sm font-normal sm:hidden"
                              onClick={(e) => { e.stopPropagation(); setBreakdown({ row, mode: 'loss' }) }}
                              aria-label={`${t('lost')} ${getTeamLabel(row)}`}
                            >
                              {row.lost}
                            </Button>
                            <div className="hidden flex-col items-center leading-tight sm:flex">
                              <span>{row.lost}</span>
                              <span className="text-[10px] font-normal text-muted-foreground">
                                {`${row.defeats_clear ?? 0}/${row.defeats_narrow ?? 0}`}
                              </span>
                            </div>
                          </>
                        ) : row.lost}
                      </td>
                      {!compact && (isBasketball ? (
                        <>
                          <td className="px-2 py-2 text-center text-foreground/85">
                            {formatNumberSwiss(row.points_won)}&nbsp;:&nbsp;{formatNumberSwiss(row.points_lost)}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="hidden px-2 py-2 text-center text-foreground/85 sm:table-cell">
                            {row.sets_won}&nbsp;:&nbsp;{row.sets_lost}
                          </td>
                          <td className="hidden px-2 py-2 text-center tabular-nums text-muted-foreground sm:table-cell">
                            {row.sets_lost > 0 ? (row.sets_won / row.sets_lost).toFixed(2) : row.sets_won > 0 ? '∞' : '–'}
                          </td>
                          <td className="hidden px-2 py-2 text-center text-foreground/85 lg:table-cell">
                            {formatNumberSwiss(row.points_won)}&nbsp;:&nbsp;{formatNumberSwiss(row.points_lost)}
                          </td>
                          <td className="hidden px-2 py-2 text-center tabular-nums text-muted-foreground lg:table-cell">
                            {row.points_lost > 0 ? (row.points_won / row.points_lost).toFixed(2) : row.points_won > 0 ? '∞' : '–'}
                          </td>
                        </>
                      ))}
                    </tr>
                    {isExpanded && (
                      <tr key={`${row.id}-games`}>
                        <td colSpan={colCount} className="p-0">
                          <div className="bg-surface-sunken px-2 py-1 sm:px-3">
                            {/* `rowGames` is empty both while the deferred games query is
                                in flight and when the team really has no fixtures. The query
                                only starts on this tap (`enabled` above), so without this gate
                                the first expansion of every league table claims "No data". */}
                            {leagueGamesLoading ? (
                              <div className="space-y-1" aria-busy="true">
                                {[0, 1, 2].map((i) => (
                                  <div key={i} className="h-8 animate-pulse rounded bg-stone-200/80 dark:bg-muted" />
                                ))}
                              </div>
                            ) : rowGames.length === 0 ? (
                              <p className="py-2 text-center text-xs text-muted-foreground/80">{t('common:noData')}</p>
                            ) : (
                              <RowList>
                                {rowGames.map((g) => {
                                  const teamName = row.team_name
                                  const isHome = g.home_team === teamName
                                  const opponent = isHome ? g.away_team : g.home_team
                                  const completed = g.status === 'completed'
                                  const own = completed ? (isHome ? g.home_score : g.away_score) : 0
                                  const other = completed ? (isHome ? g.away_score : g.home_score) : 0
                                  const isFuture = !completed && !!g.date && g.date >= today
                                  const tone: RowTone = completed
                                    ? (own > other ? 'green' : own < other ? 'red' : 'gray')
                                    : isFuture ? (isHome ? 'brand' : 'sky') : 'gray'

                                  return (
                                    <div key={g.id} className="flex items-stretch gap-2.5 px-1.5 py-2 sm:gap-3 sm:px-2">
                                      <DateRail
                                        eyebrow={g.date ? formatWeekday(g.date) : undefined}
                                        main={g.date ? `${formatDayMonthZurich(g.date)}.` : '–'}
                                        sub={g.time ? formatTime(g.time) : undefined}
                                        tone={tone}
                                      />
                                      <RowStripe tone={tone} />
                                      <div className="min-w-0 flex-1 self-center">
                                        <div className="break-words text-sm font-normal leading-snug text-foreground">{opponent}</div>
                                        <div className="mt-1 flex flex-wrap gap-1.5">
                                          <RowChip tone={isHome ? 'brand' : 'sky'}>{isHome ? t('home') : t('away')}</RowChip>
                                          {isFuture && <RowChip tone="violet">{t('comeAndSupport')}</RowChip>}
                                        </div>
                                      </div>
                                      <div className={`shrink-0 self-center text-base font-bold tabular-nums ${
                                        tone === 'green' ? 'text-green-600 dark:text-green-400'
                                          : tone === 'red' ? 'text-red-500 dark:text-red-400'
                                          : 'text-muted-foreground'
                                      }`}>
                                        {completed ? `${own}:${other}` : isFuture ? '' : '–'}
                                      </div>
                                    </div>
                                  )
                                })}
                              </RowList>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      <Modal
        open={!!breakdown}
        onClose={() => setBreakdown(null)}
        title={breakdown ? `${getTeamLabel(breakdown.row)} - ${breakdown.mode === 'win' ? t('won') : t('lost')}` : ''}
        size="sm"
      >
        {!breakdown ? null : !hasBreakdownData(breakdown.row) ? (
          <p className="text-sm text-muted-foreground">{t('breakdownUnavailable')}</p>
        ) : (
          <div className="space-y-3">
            {breakdown.mode === 'win' ? (
              <>
                <div className="flex items-center justify-between rounded-xl border border-hairline px-3 py-2 text-sm">
                  <span className="text-foreground/85">{t('winsClear')}</span>
                  <strong className="tabular-nums text-foreground">{winsClear}</strong>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-hairline px-3 py-2 text-sm">
                  <span className="text-foreground/85">{t('winsNarrow')}</span>
                  <strong className="tabular-nums text-foreground">{winsNarrow}</strong>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-surface-sunken px-3 py-2 text-sm">
                  <span className="text-foreground/85">{t('breakdownTotal')}</span>
                  <strong className="tabular-nums text-foreground">{breakdown.row.won}</strong>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between rounded-xl border border-hairline px-3 py-2 text-sm">
                  <span className="text-foreground/85">{t('lossesClear')}</span>
                  <strong className="tabular-nums text-foreground">{lossesClear}</strong>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-hairline px-3 py-2 text-sm">
                  <span className="text-foreground/85">{t('lossesNarrow')}</span>
                  <strong className="tabular-nums text-foreground">{lossesNarrow}</strong>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-surface-sunken px-3 py-2 text-sm">
                  <span className="text-foreground/85">{t('breakdownTotal')}</span>
                  <strong className="tabular-nums text-foreground">{breakdown.row.lost}</strong>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}

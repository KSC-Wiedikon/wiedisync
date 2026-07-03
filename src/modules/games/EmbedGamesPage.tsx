import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import type { Game, Ranking } from '../../types'
import { useCollection } from '../../lib/query'
import { teamIds } from '../../utils/teamColors'
import { todayLocal } from '../../utils/dateHelpers'
import { useEffectiveSeason } from '../../hooks/useEffectiveSeason'
import GameTabs from './components/GameTabs'
import type { TabKey } from './components/GameTabs'
import GameCard from './components/GameCard'
import RankingsTable from './components/RankingsTable'
import LoadingSpinner from '../../components/LoadingSpinner'

function buildTeamFilter(team: string): Record<string, unknown> | null {
  if (!team) return null
  const sanitized = team.replace(/[^a-zA-Z0-9\s\-]/g, '')
  if (!sanitized) return null
  return { kscw_team: { name: { _contains: sanitized } } }
}

export default function EmbedGamesPage() {
  const { t } = useTranslation('games')
  const [searchParams] = useSearchParams()
  const teamParam = (searchParams.get('team') ?? '').toUpperCase()
  const [activeTab, setActiveTab] = useState<TabKey>('upcoming')

  const today = useMemo(() => todayLocal(), [])
  const teamFilter = buildTeamFilter(teamParam)
  const effGameSeason = useEffectiveSeason('games')
  const effRankSeason = useEffectiveSeason('rankings')

  const gameQuery = useMemo(() => {
    if (activeTab === 'rankings') return null

    const conditions: Record<string, unknown>[] = [{ season: { _eq: effGameSeason } }]
    switch (activeTab) {
      case 'upcoming':
        conditions.push({ status: { _eq: 'scheduled' } }, { date: { _gte: today } })
        break
      case 'results':
        conditions.push({ status: { _in: ['completed', 'live'] } })
        break
    }
    if (teamFilter) conditions.push(teamFilter)

    return {
      filter: conditions.length === 1 ? conditions[0] : { _and: conditions },
      sort: activeTab === 'upcoming' ? 'date,time' : '-date,-time',
    }
  }, [activeTab, teamFilter, today, effGameSeason])

  // On the rankings tab gameQuery is null — gate the games query via `enabled`
  // instead of firing a sentinel `{ id: { _eq: -1 } }` fetch.
  const { data: gamesRaw, isLoading: gamesLoading } = useCollection<Game>('games', {
    filter: gameQuery?.filter ?? {},
    sort: gameQuery ? gameQuery.sort.split(',') : ['date'],
    limit: 50,
    enabled: !!gameQuery,
  })
  const games = gamesRaw ?? []

  const { data: allRankingsRaw, isLoading: rankingsLoading } = useCollection<Ranking>('rankings', {
    filter: { season: { _eq: effRankSeason } },
    sort: ['league', 'rank'],
    limit: 2000,
  })
  const allRankings = allRankingsRaw ?? []

  const leagueGroups = useMemo(() => {
    const grouped = new Map<string, Ranking[]>()
    for (const r of allRankings) {
      const existing = grouped.get(r.league) ?? []
      existing.push(r)
      grouped.set(r.league, existing)
    }

    if (!teamParam) return grouped

    // Filter to leagues containing the selected team
    const selectedSvIds = new Set(
      Object.entries(teamIds)
        .filter(([, code]) => code.replace(/-\d+$/, '') === teamParam)
        .map(([id]) => id),
    )

    const filtered = new Map<string, Ranking[]>()
    for (const [league, rows] of grouped) {
      if (rows.some((r) => selectedSvIds.has(r.team_id))) {
        filtered.set(league, rows)
      }
    }
    return filtered
  }, [allRankings, teamParam])

  const isLoading = activeTab === 'rankings' ? rankingsLoading : gamesLoading

  return (
    <div className="min-h-screen bg-white dark:bg-gray-800 p-4">
      {teamParam && (
        <h2 className="mb-4 text-lg font-bold text-gray-900 dark:text-gray-100">{t('embedTeamGames', { team: teamParam })}</h2>
      )}

      <GameTabs activeTab={activeTab} onChange={setActiveTab} />

      <div className="mt-4">
        {isLoading && <LoadingSpinner size="sm" />}

        {!isLoading && activeTab !== 'rankings' && (
          <>
            {games.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">{t('embedNoGames')}</p>
            ) : (
              <div className="space-y-3">
                {games.map((g) => (
                  <GameCard key={g.id} game={g} variant="compact" />
                ))}
              </div>
            )}
          </>
        )}

        {!isLoading && activeTab === 'rankings' && (
          <>
            {leagueGroups.size === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">{t('embedNoRankings')}</p>
            ) : (
              <div className="space-y-6">
                {[...leagueGroups.entries()].map(([league, rows]) => (
                  <RankingsTable key={league} league={league} rankings={rows} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

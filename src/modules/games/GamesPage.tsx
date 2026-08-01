import { useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../hooks/useAuth'
import { useAdminMode } from '../../hooks/useAdminMode'
import { useSportPreference } from '../../hooks/useSportPreference'
import { useMutation } from '../../hooks/useMutation'
import type { Game, Ranking, Team, Participation, ParticipationWithMember } from '../../types'
import { useCollection, useActivitiesWithParticipations } from '../../lib/query'
import { useRealtime } from '../../hooks/useRealtime'
import { useEffectiveSeason } from '../../hooks/useEffectiveSeason'
import { useQuery } from '@tanstack/react-query'
import { teamIds } from '../../utils/teamColors'
import { todayLocal, getCurrentSeason, formatSeasonLong } from '../../utils/dateHelpers'
import { fetchSeasons } from '../../lib/api'
import { isCupGame } from '../../utils/leagueClassification'
import { asObj } from '../../utils/relations'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import SportToggle from '../../components/SportToggle'
import TeamFilterBar from './components/TeamFilterBar'
import GameTabs from './components/GameTabs'
import type { TabKey } from './components/GameTabs'
import GameCard from './components/GameCard'
import RankingsTable from './components/RankingsTable'
import KscwScoreboard from './components/KscwScoreboard'
import GameDetailModal from './components/GameDetailModal'
import GameCoachDashboard from './components/GameCoachDashboard'
import SharedEmptyState from '../../components/EmptyState'
import ParticipationRosterModal from '../../components/ParticipationRosterModal'
import ConfirmDialog from '@/components/ConfirmDialog'
import { getGameWarnings, type Warning } from '../../utils/participationWarnings'
import { Calendar, Trophy, BarChart3, LayoutGrid } from 'lucide-react'
import { TourPageButton } from '../guide/TourPageButton'
import { useReportPageLoading } from '../../hooks/usePageReady'
import { useUserVisibleGameIds } from '../../hooks/useUserVisibleGameIds'

/**
 * `guestGameIds` are the fixtures this member was invited to as a guest (migration
 * 271). They belong to another team, so the team filter drops them — but only the
 * IMPLICIT scope ("games of my teams", what a member sees by default) should carry
 * them. When the user has explicitly picked teams in the filter bar, that selection
 * is answered literally; quietly adding another team's fixture to an explicit "H3"
 * filter would read as a bug.
 */
function buildTeamFilter(teamPbIds: string[], guestGameIds: string[] = []): Record<string, unknown> | null {
  const teamPart = teamPbIds.length === 0
    ? null
    : teamPbIds.length === 1
      ? { kscw_team: { _eq: teamPbIds[0] } }
      : { kscw_team: { _in: teamPbIds } }
  if (guestGameIds.length === 0) return teamPart
  if (!teamPart) return null
  return { _or: [teamPart, { id: { _in: guestGameIds } }] }
}

export default function GamesPage() {
  const { t } = useTranslation('games')
  const { user, memberTeamIds, memberTeamNames, coachTeamIds, coachTeamNames, isCoach, primarySport, teamsLoading } = useAuth()
  // Merge member + coach teams for visibility (coaches see teams they manage)
  const allUserTeamIds = useMemo(() => [...new Set([...memberTeamIds, ...coachTeamIds])], [memberTeamIds, coachTeamIds])
  const allUserTeamNames = useMemo(() => [...new Set([...memberTeamNames, ...coachTeamNames])], [memberTeamNames, coachTeamNames])
  const { effectiveIsAdmin, effectiveIsVorstand } = useAdminMode()
  const { sport, setSport } = useSportPreference()
  const showSportToggle = !teamsLoading && (effectiveIsAdmin || effectiveIsVorstand || !user || primarySport === 'both')
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const tab = searchParams.get('tab')
    return tab === 'rankings' || tab === 'results' || tab === 'scoreboard' || tab === 'dashboard' ? tab : 'upcoming'
  })
  const [selectedTeams, setSelectedTeams] = useState<string[]>([])
  const [selectedGame, setSelectedGame] = useState<Game | null>(null)
  const [rosterGame, setRosterGame] = useState<Game | null>(null)
  const [deletingGameId, setDeletingGameId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [autoSelected, setAutoSelected] = useState(false)

  // The two blocks below used to be effects; they are now adjust-state-during-
  // render (react-hooks/set-state-in-effect). They fire on exactly the same
  // triggers, in the same source order, so on a render where both apply the
  // sport-reset still wins the last write — same as when they were two effects
  // flushed in declaration order.

  // Auto-select user's teams on initial load
  if (!autoSelected && allUserTeamNames.length > 0) {
    setSelectedTeams(allUserTeamNames)
    setAutoSelected(true)
  }

  // Reset team selection when sport changes (old selections may not match new sport).
  // `''` is not a valid SportView, so this also runs once on mount — as the old
  // effect (deps: [sport]) did.
  const [syncedSport, setSyncedSport] = useState<string>('')
  if (syncedSport !== sport) {
    setSyncedSport(sport)
    // Non-admin users: reset to their own teams; admins: show all
    setSelectedTeams((effectiveIsAdmin || effectiveIsVorstand) ? [] : allUserTeamNames)
  }

  const INITIAL_LIMIT = 20

  // Fetch all KSCW teams to map name → id
  // Active teams only: after a rollover both the archived and the new team
  // share a name, and an arbitrary tie-break could resolve name→archived id,
  // making the games filter return nothing (games re-sync onto the active team).
  const { data: allTeamsRaw, isLoading: allTeamsLoading } = useCollection<Team>('teams', { sort: ['name'], all: true, fields: ['id', 'name'], filter: { active: { _eq: true } } })
  const allTeams = allTeamsRaw ?? []
  const teamNameToId = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of allTeams) map.set(t.name, t.id)
    return map
  }, [allTeams])

  const today = useMemo(() => todayLocal(), [])
  // For non-admins, always scope to their teams (even if filter cleared)
  const effectiveTeams = selectedTeams.length > 0
    ? selectedTeams
    : (!(effectiveIsAdmin || effectiveIsVorstand) && allUserTeamNames.length > 0 ? allUserTeamNames : [])
  // Convert name codes to record IDs for the kscw_team filter
  const effectiveTeamIds = effectiveTeams
    .map((name) => teamNameToId.get(name))
    .filter((id): id is string => !!id)
  // For non-admins, also include their team IDs as fallback
  const filterTeamIds = effectiveTeamIds.length > 0
    ? effectiveTeamIds
    : (!(effectiveIsAdmin || effectiveIsVorstand) && allUserTeamIds.length > 0 ? allUserTeamIds : [])
  // Only the implicit personal scope carries guest invitations — see buildTeamFilter.
  const { guestGameIds } = useUserVisibleGameIds(user?.id, !!user)
  const teamFilter = buildTeamFilter(filterTeamIds, selectedTeams.length > 0 ? [] : guestGameIds)

  // Dashboard team ID resolution (priority: first selected → first coached → null).
  // Note: selectedTeams holds team NAMES; effectiveTeamIds is the resolved ID array
  // from name→id lookup above. coachTeamIds (from useAuth) is always ID-typed.
  const dashboardTeamId = useMemo<string | null>(() => {
    if (effectiveTeamIds.length > 0) return effectiveTeamIds[0] ?? null
    return coachTeamIds[0] ?? null
  }, [effectiveTeamIds, coachTeamIds])

  const visibleTabs = useMemo<TabKey[]>(() => {
    const base: TabKey[] = ['upcoming', 'results', 'rankings', 'scoreboard']
    if (isCoach || effectiveIsAdmin) base.push('dashboard')
    return base
  }, [isCoach, effectiveIsAdmin])

  // Preserve the user's multi-select while they're on the dashboard tab,
  // so switching back to upcoming/results restores it. Snapshot when entering
  // the dashboard tab; restore when leaving. Adjust-state-during-render, keyed on
  // `activeTab` alone — exactly the old effect's dep array (a selection change
  // made *while* on the dashboard must not re-snapshot). `null` seeds a first
  // pass on mount, matching the effect's mount run. The snapshot moved from a ref
  // to state because refs may not be read or written during render.
  const [preservedSelection, setPreservedSelection] = useState<string[] | null>(null)
  const [syncedTab, setSyncedTab] = useState<TabKey | null>(null)
  if (syncedTab !== activeTab) {
    setSyncedTab(activeTab)
    if (activeTab === 'dashboard') {
      if (preservedSelection === null) {
        setPreservedSelection(selectedTeams)
      }
      if (selectedTeams.length > 1) {
        // Collapse to single team on entering dashboard.
        setSelectedTeams(selectedTeams.slice(0, 1))
      }
    } else if (preservedSelection !== null) {
      setSelectedTeams(preservedSelection)
      setPreservedSelection(null)
    }
  }

  // Sport filter clause for Directus queries
  const sportFilter = useMemo((): Record<string, unknown> | null => {
    if (sport === 'vb') return { kscw_team: { sport: { _eq: 'volleyball' } } }
    if (sport === 'bb') return { kscw_team: { sport: { _eq: 'basketball' } } }
    return null
  }, [sport])

  // Season-scoped so games + rankings flip to the new season once its data lands
  // (falls back to the latest season with data until then).
  const effGameSeason = useEffectiveSeason('games')
  const effRankSeason = useEffectiveSeason('rankings')

  // Rankings season selector. The list of seasons that actually have rows
  // (shared cache with useEffectiveSeason) plus the current season, which is
  // always offered even before Swiss Volley publishes its data — selecting it
  // shows the "coming soon" placeholder until the sync lands real rows. User
  // choice (rankSeason) overrides the auto-resolved latest-with-data default.
  const { data: rankSeasonsRaw } = useQuery<string[]>({
    queryKey: ['effective-season', 'rankings'],
    queryFn: () => fetchSeasons('rankings'),
    staleTime: 60_000,
  })
  const [rankSeason, setRankSeason] = useState<string | null>(null)
  const selectedRankSeason = rankSeason ?? effRankSeason
  const rankSeasonOptions = useMemo(() => {
    const set = new Set<string>(rankSeasonsRaw ?? [])
    set.add(getCurrentSeason())
    set.add(selectedRankSeason)
    return [...set].sort().reverse()
  }, [rankSeasonsRaw, selectedRankSeason])

  // Build game filter/sort based on active tab
  const gameQuery = useMemo(() => {
    if (activeTab === 'rankings' || activeTab === 'scoreboard') return null

    // Exclude incomplete games (no date, time, or opponent)
    const conditions: Record<string, unknown>[] = [
      { date: { _nnull: true } },
      { time: { _nnull: true } },
      { away_team: { _nnull: true } },
    ]
    switch (activeTab) {
      case 'upcoming':
        conditions.push({ status: { _eq: 'scheduled' } }, { date: { _gte: today } })
        break
      case 'results':
        conditions.push({ status: { _in: ['completed', 'live'] } })
        break
    }
    if (teamFilter) conditions.push(teamFilter)
    if (sportFilter) conditions.push(sportFilter)
    conditions.push({ season: { _eq: effGameSeason } })

    return {
      filter: conditions.length === 1 ? conditions[0] : { _and: conditions },
      sort: activeTab === 'upcoming' ? 'date,time' : '-date,-time',
    }
  }, [activeTab, teamFilter, sportFilter, today, effGameSeason])

  const perPage = showAll ? 500 : INITIAL_LIMIT

  // Single round-trip: games + their participations in one request.
  // Eliminates the old waterfall (games → gameIds → participations) that
  // caused ~1s of empty cards on mobile.
  const {
    data: combined,
    isLoading: gamesLoading,
    refetch: refetchCombined,
  } = useActivitiesWithParticipations<Game, Participation>('game', {
    filter: gameQuery?.filter,
    sort: gameQuery?.sort.split(','),
    limit: perPage,
    fields: ['*', 'kscw_team.*', 'kscw_team.coach.members_id', 'kscw_team.team_responsible.members_id', 'hall.*'],
    enabled: !!gameQuery && !teamsLoading,
  })
  const games = combined?.items ?? []
  const allParticipations = combined?.participations ?? []

  useRealtime('participations', () => refetchCombined())

  const { remove: removeGame } = useMutation<Game>('games')

  const handleEdit = (g: Game) => {
    setSelectedGame(g)
  }
  const handleDelete = (id: string) => {
    setDeletingGameId(id)
  }
  const confirmDelete = async () => {
    if (!deletingGameId) return
    await removeGame(deletingGameId)
    setDeletingGameId(null)
    refetchCombined()
  }

  // Build maps: gameId → participations[], gameId → user's participation
  const { participationsByGame, myParticipationByGame, warningsByGame } = useMemo(() => {
    const byGame = new Map<string, Participation[]>()
    const myByGame = new Map<string, Participation>()
    for (const p of allParticipations) {
      const list = byGame.get(p.activity_id) ?? []
      list.push(p)
      byGame.set(p.activity_id, list)
      if (user && p.member === user.id) {
        myByGame.set(p.activity_id, p)
      }
    }
    // Compute warnings per game
    const warnsByGame = new Map<string, Warning[]>()
    for (const g of games) {
      const kscwTeamObj = asObj<Team>(g.kscw_team)
      const sport = kscwTeamObj?.sport as 'volleyball' | 'basketball' | undefined
      if (!sport) continue
      const parts = (byGame.get(g.id) ?? []) as ParticipationWithMember[]
      const warnings = getGameWarnings(parts, sport, g.min_participants || undefined)
      if (warnings.length > 0) warnsByGame.set(g.id, warnings)
    }
    return { participationsByGame: byGame, myParticipationByGame: myByGame, warningsByGame: warnsByGame }
  }, [allParticipations, user, games])

  // Rankings — always fetch (small dataset), group client-side
  const { data: allRankingsRaw, isLoading: rankingsLoading } = useCollection<Ranking>('rankings', {
    filter: { season: { _eq: selectedRankSeason } },
    sort: ['league', 'rank'],
    fields: ['id', 'league', 'rank', 'team_id', 'team_name', 'points', 'won', 'lost', 'wins_clear', 'wins_narrow', 'defeats_clear', 'defeats_narrow', 'sets_won', 'sets_lost', 'points_won', 'points_lost', 'played', 'season'],
    limit: 2000,
  })
  const allRankings = allRankingsRaw ?? []

  const leagueGroups = useMemo(() => {
    const grouped = new Map<string, Ranking[]>()
    for (const r of allRankings) {
      // Skip cup/tournament/match-group leagues — not regular season standings
      if (/^Group \d+$|Cup|Turnier|Pokal|Final|Runde \d|Spiel \d|Tour \d/i.test(r.league)) continue

      // Sport filter: bb_ prefix = basketball, vb_ = volleyball
      if (!r.team_id) continue
      const isBbRanking = r.team_id.startsWith('bb_')
      if (sport === 'vb' && isBbRanking) continue
      if (sport === 'bb' && !isBbRanking) continue

      const existing = grouped.get(r.league) ?? []
      existing.push(r)
      grouped.set(r.league, existing)
    }

    // For basketball: only show leagues that contain at least one KSCW team
    if (sport === 'bb' || sport === 'all') {
      for (const [league, rows] of grouped) {
        const isBbLeague = rows.some((r) => r.team_id.startsWith('bb_'))
        if (isBbLeague && !rows.some((r) => teamIds[r.team_id])) {
          grouped.delete(league)
        }
      }
    }

    if (effectiveTeams.length === 0) return grouped

    // Filter to leagues containing a selected team
    const selectedSvIds = new Set(
      effectiveTeams.flatMap((t) =>
        Object.entries(teamIds)
          .filter(([, code]) => code.replace(/-\d+$/, '') === t)
          .map(([id]) => id),
      ),
    )

    const filtered = new Map<string, Ranking[]>()
    for (const [league, rows] of grouped) {
      if (rows.some((r) => selectedSvIds.has(r.team_id))) {
        filtered.set(league, rows)
      }
    }
    return filtered
  }, [allRankings, effectiveTeams, sport])

  // Games tabs render from games + the active-teams map (name→id) + auth team
  // context — gate on ALL of them so cards never pop in over a half-built view.
  // Rankings/scoreboard keep their own loading flag.
  const gamesGateLoading = gamesLoading || allTeamsLoading || teamsLoading
  const isLoading = (activeTab === 'rankings' || activeTab === 'scoreboard') ? rankingsLoading : gamesGateLoading
  const showGames = activeTab !== 'rankings' && activeTab !== 'scoreboard' && !isLoading

  // Report to app boot gate — see usePageReady.tsx
  useReportPageLoading(isLoading)

  // Shared renderer for the upcoming (card grid) and results (compact list)
  // tabs — both split games into league vs Cup sections and render GameCard.
  const renderGameSections = (variant: 'card' | 'compact') => {
    const leagueGames = games.filter((g) => !isCupGame(g.league))
    const cupGames = games.filter((g) => isCupGame(g.league))
    const showHeadings = leagueGames.length > 0 && cupGames.length > 0
    const sections: Array<{ key: 'league' | 'cup'; label: string; items: typeof games }> = []
    if (leagueGames.length > 0) sections.push({ key: 'league', label: t('sectionLeague'), items: leagueGames })
    if (cupGames.length > 0) sections.push({ key: 'cup', label: t('sectionCup'), items: cupGames })
    return sections.map((section) => (
      <div key={section.key} className="mb-6 last:mb-0">
        {showHeadings && (
          <h2 className={variant === 'compact'
            ? 'mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 md:text-center dark:text-gray-400'
            : 'mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400'}>
            {section.label}
          </h2>
        )}
        {variant === 'compact' ? (
          <div data-tour={section.key === 'league' ? 'game-results' : undefined} className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white md:mx-auto md:w-fit dark:bg-gray-800 md:grid md:grid-cols-[auto_auto_auto_auto_auto_auto_auto_1fr]">
            {section.items.map((g) => (
              <GameCard
                key={g.id}
                game={g}
                onClick={setSelectedGame}
                onOpenRoster={setRosterGame}
                onEdit={handleEdit}
                onDelete={handleDelete}
                variant="compact"
                participations={participationsByGame.get(g.id)}
                myParticipation={myParticipationByGame.get(g.id)}
                warnings={warningsByGame.get(g.id)}
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-tour={section.key === 'league' ? 'game-card' : undefined}>
            {section.items.map((g) => (
              <GameCard
                key={g.id}
                game={g}
                onClick={setSelectedGame}
                onOpenRoster={setRosterGame}
                onEdit={handleEdit}
                onDelete={handleDelete}
                participations={participationsByGame.get(g.id)}
                myParticipation={myParticipationByGame.get(g.id)}
                warnings={warningsByGame.get(g.id)}
                onParticipationSaved={refetchCombined}
              />
            ))}
          </div>
        )}
      </div>
    ))
  }

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-gray-100">{t('title')}</h1>
        <TourPageButton />
      </div>

      <div className="mt-6 space-y-4">
        {showSportToggle && (
          <div className="flex items-center gap-4">
            <SportToggle value={sport} onChange={setSport} />
          </div>
        )}
        <div data-tour="team-filter">
          <TeamFilterBar selected={selectedTeams} onChange={setSelectedTeams} sport={sport} limitToTeams={effectiveIsAdmin || effectiveIsVorstand || !user ? undefined : allUserTeamNames} singleSelect={activeTab === 'dashboard'} />
        </div>
        <div data-tour="game-tabs">
          <GameTabs activeTab={activeTab} onChange={(tab) => { setActiveTab(tab); setShowAll(false) }} tabs={visibleTabs} />
        </div>
      </div>

      <div className="mt-6">
        {isLoading && null}

        {/* Upcoming: card grid, split by league vs Cup */}
        {showGames && activeTab === 'upcoming' && (
          <>
            {games.length === 0 ? (
              <EmptyState tab={activeTab} />
            ) : (
              <>
                {renderGameSections('card')}
                {!showAll && games.length >= INITIAL_LIMIT && (
                  <button
                    onClick={() => setShowAll(true)}
                    className="mt-4 w-full cursor-pointer rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                  >
                    {t('showMore')}
                  </button>
                )}
              </>
            )}
          </>
        )}

        {/* Results: compact list, split by league vs Cup */}
        {showGames && activeTab === 'results' && (
          <>
            {games.length === 0 ? (
              <EmptyState tab={activeTab} />
            ) : (
              <>
                {renderGameSections('compact')}
                {!showAll && games.length >= INITIAL_LIMIT && (
                  <button
                    onClick={() => setShowAll(true)}
                    className="mt-4 w-full cursor-pointer rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                  >
                    {t('showMore')}
                  </button>
                )}
              </>
            )}
          </>
        )}

        {/* Rankings */}
        {activeTab === 'rankings' && !rankingsLoading && (
          <>
            <div className="mb-4 flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('season')}</span>
              <Select value={selectedRankSeason} onValueChange={setRankSeason}>
                <SelectTrigger className="min-h-[44px] w-[160px]" aria-label={t('season')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {rankSeasonOptions.map((s) => (
                    <SelectItem key={s} value={s}>{formatSeasonLong(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {allRankings.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700">
                <Trophy className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{formatSeasonLong(selectedRankSeason)}</p>
                <p className="mx-auto mt-1 max-w-xs text-sm text-gray-500 dark:text-gray-400">{t('rankingsUpcoming')}</p>
              </div>
            ) : leagueGroups.size === 0 ? (
              <EmptyState tab="rankings" />
            ) : (
              <div className="grid gap-6 lg:grid-cols-2" data-tour="game-rankings">
                {[...leagueGroups.entries()].map(([league, rows]) => (
                  <RankingsTable key={league} league={league} rankings={rows} />
                ))}
              </div>
            )}
          </>
        )}

        {/* Scoreboard */}
        {activeTab === 'scoreboard' && !rankingsLoading && (
          <div data-tour="game-scoreboard"><KscwScoreboard rankings={allRankings} /></div>
        )}

        {/* Coach Dashboard */}
        {activeTab === 'dashboard' && (
          <GameCoachDashboard teamId={dashboardTeamId} />
        )}
      </div>

      <GameDetailModal game={selectedGame} onClose={() => setSelectedGame(null)} />

      <ParticipationRosterModal
        open={rosterGame !== null}
        onClose={() => setRosterGame(null)}
        activityType="game"
        activityId={rosterGame?.id ?? ''}
        activityDate={rosterGame?.date ?? ''}
        teamIds={rosterGame ? [String(typeof rosterGame.kscw_team === 'object' ? (rosterGame.kscw_team as Team).id : rosterGame.kscw_team)] : []}
        title={t('participation')}
        activityKind={rosterGame ? `${rosterGame.home_team ?? ''} vs ${rosterGame.away_team ?? ''}`.trim() : undefined}
      />

      <ConfirmDialog
        open={deletingGameId !== null}
        onClose={() => setDeletingGameId(null)}
        onConfirm={confirmDelete}
        title={t('deleteGame')}
        message={t('deleteConfirm')}
        confirmLabel={t('deleteGame')}
        danger
      />
    </div>
  )
}

const tabIcons: Record<string, React.ReactNode> = {
  upcoming: <Calendar className="h-10 w-10" />,
  results: <Trophy className="h-10 w-10" />,
  rankings: <BarChart3 className="h-10 w-10" />,
  scoreboard: <LayoutGrid className="h-10 w-10" />,
  dashboard: <BarChart3 className="h-10 w-10" />,
}

function EmptyState({ tab }: { tab: string }) {
  const { t } = useTranslation('games')

  const messages: Record<string, string> = {
    upcoming: t('noUpcoming'),
    results: t('noResults'),
    rankings: t('noRankings'),
    scoreboard: t('noScoreboard'),
  }

  return (
    <SharedEmptyState
      icon={tabIcons[tab]}
      title={messages[tab] ?? t('common:noData')}
      description={t('common:tryAdjustingFilter')}
    />
  )
}

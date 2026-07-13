import { Fragment, useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { kscwApi } from '../../lib/api'
import { formatDateZurich, getCurrentSeason } from '../../utils/dateHelpers'
import { useReportPageLoading } from '../../hooks/usePageReady'
import DashboardSection from './components/DashboardSection'
import TeamChip from '../../components/TeamChip'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'

// ── Types ────────────────────────────────────────────────────────

interface StatsOverview {
  active_members: string
  vb_active_members: string
  bb_active_members: string
  vb_total_members: string
  bb_total_members: string
  active_teams: string
  vb_teams: string
  bb_teams: string
  upcoming_games: string
  vb_upcoming_games: string
  bb_upcoming_games: string
  completed_games: string
  vb_completed_games: string
  bb_completed_games: string
  upcoming_trainings: string
  upcoming_events: string
  upcoming_home_games: string
  upcoming_home_games_no_schreiber: string
  // Sport-filtered member stats
  vb_registered: string
  bb_registered: string
  vb_shell: string
  bb_shell: string
  vb_lic_scorer: string
  vb_lic_referee: string
  bb_lic_otr1: string
  bb_lic_otr2: string
  vb_vorstand: string
  bb_vorstand: string
  vb_admins: string
  bb_admins: string
}

interface StatsMembers {
  total_members: string
  active_wiedisync: string
  shell_accounts: string
  registered_users: string
  licence_scorer_vb: string
  licence_referee_vb: string
  licence_otr1_bb: string
  licence_otr2_bb: string
  role_superuser: string
  role_admin: string
  role_vb_admin: string
  role_bb_admin: string
  role_vorstand: string
}

interface TeamRoster {
  team_id: number
  team_name: string
  sport: string
  league: string
  roster_size: string
  active_roster_size: string
  guest_count: string
  lic_scorer_vb: string
  lic_referee_vb: string
  lic_otr1_bb: string
  lic_otr2_bb: string
  lic_referee_bb: string
  coach_count: string
  captain_count: string
  team_responsible_count: string
}

interface SchreiberCoverage {
  team_id: number
  team_name: string
  sport: string
  season: string | null
  total_home_games: string
  vb_any_duty_assigned: string
  vb_no_duty_assigned: string
  bb_any_duty_assigned: string
  bb_no_duty_assigned: string
}

interface MissingSchreiber {
  game_id: number
  game_date: string
  game_time: string
  home_team: string
  away_team: string
  league: string
  team_id: number
  team_name: string
  sport: string
  missing_roles: string
}

interface Participation {
  team_id: number
  team_name: string
  sport: string
  games_total: string
  games_responses: string
  games_confirmed: string
  games_declined: string
  games_tentative: string
  trainings_total: string
  trainings_responses: string
  trainings_confirmed: string
  trainings_declined: string
  trainings_tentative: string
}

interface GameResult {
  team_id: number
  team_name: string
  sport: string
  season: string
  games_played: string
  total_wins: string
  total_losses: string
  home_wins: string
  home_losses: string
  away_wins: string
  away_losses: string
}

interface Delegation {
  team_id: number
  team_name: string
  sport: string
  total_delegations: string
  accepted: string
  declined_count: string
  pending: string
  expired: string
  same_team_transfers: string
  cross_team_transfers: string
}

interface AllStats {
  overview: StatsOverview
  members: StatsMembers
  roster: TeamRoster[]
  schreiber: SchreiberCoverage[]
  missing: MissingSchreiber[]
  participation: Participation[]
  results: GameResult[]
  delegations: Delegation[]
}

// ── Helpers ──────────────────────────────────────────────────────

const n = (v: string | number) => Number(v) || 0
const pct = (a: number, b: number) => b > 0 ? `${Math.round((a / b) * 100)}%` : '–'

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  )
}


function SportHeading({ sport }: { sport: string }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={99} className="pt-4 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {sport === 'volleyball' ? '🏐 Volleyball' : '🏀 Basketball'}
      </TableCell>
    </TableRow>
  )
}

/** Insert sport heading rows into a sorted-by-sport list */
function groupBySport<T extends { sport: string }>(items: T[]): { sport: string; items: T[] }[] {
  const vb = items.filter(i => i.sport === 'volleyball')
  const bb = items.filter(i => i.sport === 'basketball')
  const groups: { sport: string; items: T[] }[] = []
  if (vb.length > 0) groups.push({ sport: 'volleyball', items: vb })
  if (bb.length > 0) groups.push({ sport: 'basketball', items: bb })
  return groups
}

// ── Main ─────────────────────────────────────────────────────────

export default function ClubStatsPage() {
  const { t } = useTranslation('admin')
  const [data, setData] = useState<AllStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sportFilter, setSportFilter] = useState<'all' | 'volleyball' | 'basketball'>('all')
  // Season-scoped sections (Schreiber coverage, W/L results) default to the
  // current season; the rest of the page is current-state / rolling-window.
  const [seasonFilter, setSeasonFilter] = useState<string>(getCurrentSeason())

  async function loadStats() {
    try {
      const resp = await kscwApi<{ data: AllStats }>('/stats/all')
      setData(resp.data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats')
    }
  }

  // Retry button — clears the error straight away (event handler), then reloads.
  function fetchStats() {
    setError(null)
    void loadStats()
  }

  // Initial load: `error` is already null here, so the old setError(null) at the
  // top of the fetch was a no-op. Runs from an effect-local async function
  // (React's documented data-fetching shape).
  useEffect(() => {
    async function run() { await loadStats() }
    void run()
  }, [])

  // Seasons that actually have data (from the two season-scoped views).
  const availableSeasons = useMemo(() => {
    if (!data) return [] as string[]
    const set = new Set<string>()
    for (const r of data.results) if (r.season) set.add(r.season)
    for (const s of data.schreiber) if (s.season) set.add(s.season)
    return Array.from(set).sort().reverse()
  }, [data])

  // The season actually shown: the user's pick if it has data, else the latest
  // season that does. Derived (no effect) so the current-season default falls
  // back cleanly before this season has any games.
  const effectiveSeason = availableSeasons.includes(seasonFilter)
    ? seasonFilter
    : (availableSeasons[0] ?? seasonFilter)

  const filtered = useMemo(() => {
    if (!data) return data
    const bySport = <T extends { sport: string }>(arr: T[]) =>
      sportFilter === 'all' ? arr : arr.filter(x => x.sport === sportFilter)
    return {
      ...data,
      roster: bySport(data.roster),
      // Season-scoped: only the selected season's rows.
      schreiber: bySport(data.schreiber).filter(s => s.season === effectiveSeason),
      missing: bySport(data.missing),
      participation: bySport(data.participation),
      results: bySport(data.results).filter(r => r.season === effectiveSeason),
      delegations: bySport(data.delegations),
    }
  }, [data, sportFilter, effectiveSeason])

  // Sport-aware KPI values for header cards
  const kpis = useMemo(() => {
    if (!filtered) return null
    const ov = filtered.overview
    const mem = filtered.members
    if (sportFilter === 'all') {
      return {
        membersLabel: t('clubStatsActiveMembers'),
        members: n(ov.active_members),
        membersSub: `${n(mem.total_members)} ${t('clubStatsTotal')}`,
        teams: n(ov.active_teams),
        teamsSub: `VB ${n(ov.vb_teams)} · BB ${n(ov.bb_teams)}`,
        games: n(ov.upcoming_games),
        gamesSub: `${n(ov.completed_games)} ${t('clubStatsCompleted')}`,
        gaps: n(ov.upcoming_home_games_no_schreiber),
        gapsSub: `${t('clubStatsOf')} ${n(ov.upcoming_home_games)} ${t('clubStatsHomeGames')}`,
      }
    }
    // Sport-filtered: use distinct counts from overview (avoids double-counting multi-team members)
    const isVB = sportFilter === 'volleyball'
    const activeMembers = isVB ? n(ov.vb_active_members) : n(ov.bb_active_members)
    const totalMembers = isVB ? n(ov.vb_total_members) : n(ov.bb_total_members)
    const teams = filtered.roster.length
    const homeGames = filtered.schreiber.reduce((sum, s) => sum + n(s.total_home_games), 0)
    const gaps = filtered.missing.length
    const sportLabel = isVB ? 'VB' : 'BB'
    return {
      membersLabel: t('clubStatsActiveMembers'),
      members: activeMembers,
      membersSub: `${totalMembers} ${t('clubStatsTotal')}`,
      teams,
      teamsSub: sportLabel,
      games: isVB ? n(ov.vb_upcoming_games) : n(ov.bb_upcoming_games),
      gamesSub: `${isVB ? n(ov.vb_completed_games) : n(ov.bb_completed_games)} ${t('clubStatsCompleted')}`,
      gaps,
      gapsSub: `${t('clubStatsOf')} ${homeGames} ${t('clubStatsHomeGames')}`,
    }
  }, [filtered, sportFilter, t])

  // Sport-filtered member stats (must be before early returns to satisfy hook rules)
  const isVB = sportFilter === 'volleyball'
  const memStats = useMemo(() => {
    if (!filtered) return null
    const mem = filtered.members
    const ov = filtered.overview
    if (sportFilter === 'all') {
      return {
        registered: n(mem.registered_users),
        shell: n(mem.shell_accounts),
        scorerVB: n(mem.licence_scorer_vb),
        refereeVB: n(mem.licence_referee_vb),
        otr1BB: n(mem.licence_otr1_bb),
        otr2BB: n(mem.licence_otr2_bb),
        vorstand: n(mem.role_vorstand),
        admins: n(mem.role_admin) + n(mem.role_superuser),
        adminsSub: `VB ${n(mem.role_vb_admin)} · BB ${n(mem.role_bb_admin)}`,
      }
    }
    return {
      registered: isVB ? n(ov.vb_registered) : n(ov.bb_registered),
      shell: isVB ? n(ov.vb_shell) : n(ov.bb_shell),
      scorerVB: n(ov.vb_lic_scorer),
      refereeVB: n(ov.vb_lic_referee),
      otr1BB: n(ov.bb_lic_otr1),
      otr2BB: n(ov.bb_lic_otr2),
      vorstand: isVB ? n(ov.vb_vorstand) : n(ov.bb_vorstand),
      admins: isVB ? n(ov.vb_admins) : n(ov.bb_admins),
      adminsSub: isVB ? `VB ${n(mem.role_vb_admin)}` : `BB ${n(mem.role_bb_admin)}`,
    }
  }, [filtered, sportFilter, isVB])

  // Report to app boot gate — see usePageReady.tsx
  useReportPageLoading(!filtered && !error)

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold mb-4">{t('clubStatsTitle')}</h1>
        <div className="text-destructive">{error}</div>
        <button onClick={fetchStats} className="mt-2 text-sm underline">{t('retry')}</button>
      </div>
    )
  }

  // Full-page loading — Layout's app boot gate shows the spinner instead.
  if (!filtered) return null

  const ms = memStats!

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl font-bold">{t('clubStatsTitle')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
            {(['all', 'volleyball', 'basketball'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSportFilter(s)}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  sportFilter === s ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {s === 'all' ? t('clubStatsAll') : s === 'volleyball' ? 'VB' : 'BB'}
              </button>
            ))}
          </div>
          {availableSeasons.length > 0 && (
            <select
              value={effectiveSeason}
              onChange={e => setSeasonFilter(e.target.value)}
              aria-label={t('clubStatsSeason')}
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm dark:bg-gray-800"
            >
              {availableSeasons.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      {kpis && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label={kpis.membersLabel} value={kpis.members} sub={kpis.membersSub} />
          <StatCard label={t('clubStatsTeams')} value={kpis.teams} sub={kpis.teamsSub} />
          <StatCard label={t('clubStatsUpcomingGames')} value={kpis.games} sub={kpis.gamesSub} />
          <StatCard label={t('clubStatsSchreiberGaps')} value={kpis.gaps} sub={kpis.gapsSub} />
        </div>
      )}

      {/* Members & Licences */}
      <DashboardSection id="stats-members" title={t('clubStatsMembersLicences')} icon="👥">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label={t('clubStatsRegistered')} value={ms.registered} />
          <StatCard label={t('clubStatsShell')} value={ms.shell} />
          {sportFilter !== 'basketball' && <StatCard label={t('clubStatsScorerVB')} value={ms.scorerVB} />}
          {sportFilter !== 'basketball' && <StatCard label={t('clubStatsRefereeVB')} value={ms.refereeVB} />}
          {sportFilter !== 'volleyball' && <StatCard label={t('clubStatsOTR1BB')} value={ms.otr1BB} />}
          {sportFilter !== 'volleyball' && <StatCard label={t('clubStatsOTR2BB')} value={ms.otr2BB} />}
          <StatCard label={t('clubStatsVorstand')} value={ms.vorstand} />
          <StatCard label={t('clubStatsAdmins')} value={ms.admins} sub={ms.adminsSub} />
        </div>
      </DashboardSection>

      {/* Team Roster */}
      <DashboardSection id="stats-roster" title={t('clubStatsRoster')} icon="📋">
        {groupBySport(filtered.roster).map(group => (
          <div key={group.sport} className="mb-4 last:mb-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {group.sport === 'volleyball' ? '🏐 Volleyball' : '🏀 Basketball'}
            </p>
            <div className="-mx-4 px-4">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow className="border-b border-border text-left text-muted-foreground hover:bg-transparent">
                    <TableHead className="py-2 pr-3 font-medium">{t('clubStatsTeam')}</TableHead>
                    <TableHead className="py-2 pr-3 font-medium text-center">{t('clubStatsRosterSize')}</TableHead>
                    {group.sport === 'volleyball' ? (
                      <>
                        <TableHead className="py-2 pr-3 font-medium text-center">{t('clubStatsScorerVB')}</TableHead>
                        <TableHead className="py-2 pr-3 font-medium text-center">{t('clubStatsRefereeVB')}</TableHead>
                      </>
                    ) : (
                      <>
                        <TableHead className="py-2 pr-3 font-medium text-center">OTR1</TableHead>
                        <TableHead className="py-2 pr-3 font-medium text-center">OTR2</TableHead>
                        <TableHead className="py-2 pr-3 font-medium text-center">{t('clubStatsRefereeBB')}</TableHead>
                      </>
                    )}
                    <TableHead className="py-2 pr-3 font-medium text-center">{t('clubStatsCoach')}</TableHead>
                    <TableHead className="py-2 font-medium text-center">{t('clubStatsCaptain')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.items.map(r => (
                    <TableRow key={r.team_id} className="border-b border-border/50 hover:bg-muted/30">
                      <TableCell className="py-2 pr-3"><TeamChip team={r.team_name} size="sm" /></TableCell>
                      <TableCell className="py-2 pr-3 text-center tabular-nums">{n(r.roster_size)}{n(r.guest_count) > 0 && <span className="text-muted-foreground"> +{n(r.guest_count)}</span>}</TableCell>
                      {group.sport === 'volleyball' ? (
                        <>
                          <TableCell className="py-2 pr-3 text-center tabular-nums">{n(r.lic_scorer_vb)}</TableCell>
                          <TableCell className="py-2 pr-3 text-center tabular-nums">{n(r.lic_referee_vb)}</TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell className="py-2 pr-3 text-center tabular-nums">{n(r.lic_otr1_bb)}</TableCell>
                          <TableCell className="py-2 pr-3 text-center tabular-nums">{n(r.lic_otr2_bb)}</TableCell>
                          <TableCell className="py-2 pr-3 text-center tabular-nums">{n(r.lic_referee_bb)}</TableCell>
                        </>
                      )}
                      <TableCell className="py-2 pr-3 text-center tabular-nums">{n(r.coach_count)}</TableCell>
                      <TableCell className="py-2 text-center tabular-nums">{n(r.captain_count)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ))}
      </DashboardSection>

      {/* Schreiber Coverage */}
      <DashboardSection id="stats-schreiber" title={t('clubStatsSchreiberCoverage')} icon="✍️">
        {groupBySport(filtered.schreiber.filter(s => n(s.total_home_games) > 0)).map(group => (
          <div key={group.sport} className="mb-4 last:mb-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {group.sport === 'volleyball' ? '🏐 Volleyball' : '🏀 Basketball'}
            </p>
            <div className="-mx-4 px-4">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow className="border-b border-border text-left text-muted-foreground hover:bg-transparent">
                    <TableHead className="py-2 pr-3 font-medium">{t('clubStatsTeam')}</TableHead>
                    <TableHead className="py-2 pr-3 font-medium text-center">{t('clubStatsHomeGamesShort')}</TableHead>
                    <TableHead className="py-2 pr-3 font-medium text-center">{t('clubStatsAssigned')}</TableHead>
                    <TableHead className="py-2 pr-3 font-medium text-center">{t('clubStatsMissing')}</TableHead>
                    <TableHead className="py-2 font-medium text-center">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.items.map(s => {
                    const assigned = s.sport === 'volleyball' ? n(s.vb_any_duty_assigned) : n(s.bb_any_duty_assigned)
                    const missing = s.sport === 'volleyball' ? n(s.vb_no_duty_assigned) : n(s.bb_no_duty_assigned)
                    const total = n(s.total_home_games)
                    const full = assigned === total && total > 0
                    return (
                      <TableRow key={s.team_id} className="border-b border-border/50 hover:bg-muted/30">
                        <TableCell className="py-2 pr-3"><TeamChip team={s.team_name} size="sm" /></TableCell>
                        <TableCell className="py-2 pr-3 text-center tabular-nums">{total}</TableCell>
                        <TableCell className="py-2 pr-3 text-center tabular-nums text-green-600 dark:text-green-400">{assigned}</TableCell>
                        <TableCell className={`py-2 pr-3 text-center tabular-nums ${missing > 0 ? 'text-red-600 dark:text-red-400 font-medium' : ''}`}>{missing}</TableCell>
                        <TableCell className={`py-2 text-center tabular-nums ${full ? 'text-green-600 dark:text-green-400' : ''}`}>{pct(assigned, total)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        ))}
      </DashboardSection>

      {/* Missing Schreiber (upcoming) */}
      {filtered.missing.length > 0 && (
        <DashboardSection id="stats-missing" title={t('clubStatsMissingSchreiber')} icon="⚠️">
          <div className="space-y-2">
            {filtered.missing.map(m => (
              <div key={m.game_id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 p-2 rounded-lg bg-destructive/10 border border-destructive/20">
                <span className="text-sm font-medium">{formatDateZurich(m.game_date)} {m.game_time?.slice(0, 5)}</span>
                <TeamChip team={m.team_name} size="sm" />
                <span className="text-sm">{m.home_team} vs {m.away_team}</span>
                <span className="text-xs text-destructive font-medium ml-auto">{m.missing_roles}</span>
              </div>
            ))}
          </div>
        </DashboardSection>
      )}

      {/* Participation Rates */}
      <DashboardSection id="stats-participation" title={t('clubStatsParticipation')} icon="📊">
        <div className="-mx-4 px-4">
          <Table className="text-sm">
            <TableHeader>
              <TableRow className="border-b border-border text-left text-muted-foreground hover:bg-transparent">
                <TableHead className="py-2 pr-3 font-medium">{t('clubStatsTeam')}</TableHead>
                <TableHead className="py-2 pr-3 font-medium text-center">{t('clubStatsGamesRSVP')}</TableHead>
                <TableHead className="py-2 pr-3 font-medium text-center">{t('clubStatsTrainingsRSVP')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupBySport(filtered.participation.filter(p => n(p.games_total) > 0 || n(p.trainings_total) > 0)).map(group => (
                <Fragment key={group.sport}>
                  <SportHeading sport={group.sport} />
                  {group.items.map(p => (
                    <TableRow key={p.team_id} className="border-b border-border/50 hover:bg-muted/30">
                      <TableCell className="py-2 pr-3"><TeamChip team={p.team_name} size="sm" /></TableCell>
                      <TableCell className="py-2 pr-3 text-center tabular-nums">
                        {n(p.games_total) > 0
                          ? <span title={`${n(p.games_confirmed)}✓ ${n(p.games_declined)}✗ ${n(p.games_tentative)}?`}>
                              {n(p.games_responses)} / {n(p.games_total)} {t('clubStatsGames')}
                            </span>
                          : '–'}
                      </TableCell>
                      <TableCell className="py-2 text-center tabular-nums">
                        {n(p.trainings_total) > 0
                          ? <span title={`${n(p.trainings_confirmed)}✓ ${n(p.trainings_declined)}✗ ${n(p.trainings_tentative)}?`}>
                              {n(p.trainings_responses)} / {n(p.trainings_total)} {t('clubStatsTrainings')}
                            </span>
                          : '–'}
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      </DashboardSection>

      {/* Game Results */}
      <DashboardSection id="stats-results" title={t('clubStatsResults')} icon="🏆">
        <div className="-mx-4 px-4">
          <Table className="text-sm">
            <TableHeader>
              <TableRow className="border-b border-border text-left text-muted-foreground hover:bg-transparent">
                <TableHead className="py-2 pr-3 font-medium">{t('clubStatsTeam')}</TableHead>
                <TableHead className="py-2 pr-3 font-medium">{t('clubStatsSeason')}</TableHead>
                <TableHead className="py-2 pr-3 font-medium text-center">{t('clubStatsPlayed')}</TableHead>
                <TableHead className="py-2 pr-3 font-medium text-center">{t('clubStatsW')}</TableHead>
                <TableHead className="py-2 font-medium text-center">{t('clubStatsL')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupBySport(filtered.results).map(group => (
                <Fragment key={group.sport}>
                  <SportHeading sport={group.sport} />
                  {group.items.map(r => (
                    <TableRow key={`${r.team_id}-${r.season}`} className="border-b border-border/50 hover:bg-muted/30">
                      <TableCell className="py-2 pr-3"><TeamChip team={r.team_name} size="sm" /></TableCell>
                      <TableCell className="py-2 pr-3 text-sm text-muted-foreground">{r.season}</TableCell>
                      <TableCell className="py-2 pr-3 text-center tabular-nums">{n(r.games_played)}</TableCell>
                      <TableCell className="py-2 pr-3 text-center tabular-nums text-green-600 dark:text-green-400">{n(r.total_wins)}</TableCell>
                      <TableCell className="py-2 text-center tabular-nums text-red-600 dark:text-red-400">{n(r.total_losses)}</TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      </DashboardSection>

      {/* Delegations */}
      {filtered.delegations.length > 0 && (
        <DashboardSection id="stats-delegations" title={t('clubStatsDelegations')} icon="🔄">
          <div className="-mx-4 px-4">
            <Table className="text-sm">
              <TableHeader>
                <TableRow className="border-b border-border text-left text-muted-foreground hover:bg-transparent">
                  <TableHead className="py-2 pr-3 font-medium">{t('clubStatsTeam')}</TableHead>
                  <TableHead className="py-2 pr-3 font-medium text-center">{t('clubStatsTotal')}</TableHead>
                  <TableHead className="py-2 pr-3 font-medium text-center">{t('clubStatsAccepted')}</TableHead>
                  <TableHead className="py-2 pr-3 font-medium text-center">{t('clubStatsDeclined')}</TableHead>
                  <TableHead className="py-2 font-medium text-center">{t('clubStatsPending')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupBySport(filtered.delegations).map(group => (
                  <Fragment key={group.sport}>
                    <SportHeading sport={group.sport} />
                    {group.items.map(d => (
                      <TableRow key={d.team_id} className="border-b border-border/50 hover:bg-muted/30">
                        <TableCell className="py-2 pr-3"><TeamChip team={d.team_name} size="sm" /></TableCell>
                        <TableCell className="py-2 pr-3 text-center tabular-nums">{n(d.total_delegations)}</TableCell>
                        <TableCell className="py-2 pr-3 text-center tabular-nums text-green-600 dark:text-green-400">{n(d.accepted)}</TableCell>
                        <TableCell className="py-2 pr-3 text-center tabular-nums text-red-600 dark:text-red-400">{n(d.declined_count)}</TableCell>
                        <TableCell className="py-2 text-center tabular-nums text-amber-600 dark:text-amber-400">{n(d.pending)}</TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </DashboardSection>
      )}
    </div>
  )
}

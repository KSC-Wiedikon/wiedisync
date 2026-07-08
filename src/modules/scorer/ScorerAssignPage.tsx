import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router-dom'
import type { Game, Team, Training, Member, MemberTeam, Hall } from '../../types'
import { useCollection } from '../../lib/query'
import { useAuth } from '../../hooks/useAuth'
import { getCurrentSeason, getSeasonDateRange, formatDateCompact, formatTime } from '../../utils/dateHelpers'
import { logActivity } from '../../utils/logActivity'
import { Button } from '@/components/ui/button'
import LoadingSpinner from '../../components/LoadingSpinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import TeamSelect from '../../components/TeamSelect'
import TeamChip from '../../components/TeamChip'
import SportToggle from '../../components/SportToggle'
import { runAssignment, getTeamCounts, EXCLUDED_DUTY_TEAM_NAMES, type GameAssignment } from './components/AssignmentAlgorithm'
import { runBbAssignment, getBbTeamCounts, type BbGameAssignment } from './components/AssignmentAlgorithmBb'
import { buildAssignmentXlsx, buildTeamColors, downloadBytes, XLSX_MIME, type XlsxGameRow, type XlsxSummaryRow, type XlsxLabels } from './lib/assignmentExport'
import { updateRecord } from '../../lib/api'
import { useReportPageLoading } from '../../hooks/usePageReady'
import { TourPageButton } from '../guide/TourPageButton'

type SportTab = 'volleyball' | 'basketball'

// Rule labels shown in the collapsible "Algorithm rules" panel. The order and
// point values mirror AssignmentAlgorithm.ts (VB) / AssignmentAlgorithmBb.ts
// (BB) — keep them in sync if the engines change.
const VB_HARD_RULES = ['ruleVbHardGame', 'ruleVbHardDuty', 'ruleVbHardLicence']
const VB_SOFT_RULES = ['ruleVbSoftSequence', 'ruleVbSoftHu20', 'ruleVbSoftLegends', 'ruleVbSoftWeekend', 'ruleVbSoftTraining', 'ruleVbSoftRotation']
const BB_HARD_RULES = ['ruleBbHardGame', 'ruleBbHardDuty', 'ruleBbHardOtr1']
const BB_SOFT_RULES = ['ruleBbSoftFullCrew', 'ruleBbSoftSequence', 'ruleBbSoftTraining', 'ruleBbSoftRotation', 'ruleBbSoftWeekend']

export default function ScorerAssignPage() {
  const { t } = useTranslation('scorerAssign')
  const { user, hasAdminAccessToSport } = useAuth()

  const season = getCurrentSeason()
  const { start: seasonStart, end: seasonEnd } = getSeasonDateRange(season)

  const canVb = hasAdminAccessToSport('volleyball')
  const canBb = hasAdminAccessToSport('basketball')

  // Data loading
  const { data: allGamesRaw, isLoading: gamesLoading } = useCollection<Game>('games', {
    filter: { _and: [{ date: { _gte: seasonStart } }, { date: { _lte: seasonEnd } }, { status: { _neq: 'cancelled' } }] },
    sort: ['date', 'time'],
    all: true,
  })
  const allGames = useMemo(() => allGamesRaw ?? [], [allGamesRaw])

  // All active teams (both sports); each engine filters to its own sport.
  const { data: teamsRaw, isLoading: teamsLoading } = useCollection<Team>('teams', {
    filter: { active: { _eq: true } },
    sort: ['name'],
    all: true,
  })
  const teams = useMemo(() => teamsRaw ?? [], [teamsRaw])

  const { data: trainingsRaw, isLoading: trainingsLoading } = useCollection<Training>('trainings', {
    filter: { _and: [{ date: { _gte: seasonStart } }, { date: { _lte: seasonEnd } }, { cancelled: { _eq: false } }] },
    fields: ['id', 'team', 'date', 'start_time', 'end_time'],
    all: true,
  })
  const trainings = trainingsRaw ?? []

  // Fetch the per-flag licence booleans (migration 067) — the legacy
  // `licences` JSON array is no longer the source of truth.
  const { data: membersRaw, isLoading: membersLoading } = useCollection<Member>('members', {
    filter: { kscw_membership_active: { _eq: true } },
    fields: ['id', 'first_name', 'last_name', 'scorer_vb', 'otr1_bb', 'otr2_bb', 'otn_bb'],
    all: true,
  })
  const members = membersRaw ?? []

  const { data: memberTeamsRaw, isLoading: memberTeamsLoading } = useCollection<MemberTeam>('member_teams', {
    all: true,
    enabled: !!user,
  })
  const memberTeams = memberTeamsRaw ?? []

  // Hall names (the Döltschi rule needs them; games carry only the hall id).
  const { data: hallsRaw, isLoading: hallsLoading } = useCollection<Hall>('halls', {
    fields: ['id', 'name'],
    all: true,
  })

  // The auto-assign algorithm consumes games + teams + trainings + members +
  // member_teams + halls. Gate the whole page on ALL of them so the spinner,
  // "games loaded" banner, Run button and empty state never flash a half-loaded
  // view (e.g. "0 games" before teams/halls land).
  const dataLoading = gamesLoading || teamsLoading || trainingsLoading || membersLoading || memberTeamsLoading || hallsLoading

  // Report to the app boot gate — see usePageReady.tsx
  useReportPageLoading(dataLoading)

  // State
  const [sportTab, setSportTab] = useState<SportTab>(canVb ? 'volleyball' : 'basketball')
  const [vbAssignments, setVbAssignments] = useState<GameAssignment[]>([])
  const [bbAssignments, setBbAssignments] = useState<BbGameAssignment[]>([])
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ text: string; error: boolean } | null>(null)
  const [running, setRunning] = useState(false)

  // Lookups
  const teamSportById = useMemo(() => {
    const m = new Map<string, 'volleyball' | 'basketball'>()
    for (const t of teams) m.set(t.id, t.sport)
    return m
  }, [teams])

  const getGameSport = (g: Game): 'volleyball' | 'basketball' =>
    teamSportById.get(String(g.kscw_team)) ?? (g.source === 'basketplan' ? 'basketball' : 'volleyball')

  const halls = useMemo(
    () => (hallsRaw ?? []).map((h) => ({ id: h.id, name: h.name })),
    [hallsRaw],
  )

  // Exclude MiniVB / DU20 from the VB duty dropdowns — they're out of the duty
  // system entirely (never an assignee, never in the summary).
  const vbTeams = useMemo(() => teams.filter((tm) => tm.sport === 'volleyball' && !EXCLUDED_DUTY_TEAM_NAMES.includes(tm.name)), [teams])
  const bbTeams = useMemo(() => teams.filter((tm) => tm.sport === 'basketball'), [teams])

  const sportGames = useMemo(
    () => allGames.filter((g) => getGameSport(g) === sportTab),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allGames, sportTab, teamSportById],
  )

  const homeGames = useMemo(
    () => sportGames.filter((g) => g.type === 'home' && g.status !== 'postponed'),
    [sportGames],
  )

  const teamNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const tm of teams) m.set(tm.id, tm.name)
    return m
  }, [teams])

  // Games carry a bare hall ID (not expanded), so resolve names from the halls
  // list rather than asObj (which would render blank).
  const hallNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const h of halls) m.set(String(h.id), h.name)
    return m
  }, [halls])

  const vbTeamCounts = useMemo(() => getTeamCounts(vbAssignments, teams, sportGames), [vbAssignments, teams, sportGames])
  const bbTeamCounts = useMemo(() => getBbTeamCounts(bbAssignments, teams, sportGames), [bbAssignments, teams, sportGames])

  const assignments = sportTab === 'volleyball' ? vbAssignments : bbAssignments

  // Actions
  function handleRunAlgorithm() {
    setRunning(true)
    setSaveMsg(null)
    setTimeout(() => {
      if (sportTab === 'volleyball') {
        setVbAssignments(runAssignment({ games: sportGames, teams, trainings, members, memberTeams, halls }))
      } else {
        setBbAssignments(runBbAssignment({ games: sportGames, teams, trainings, members, memberTeams }))
      }
      setRunning(false)
    }, 50)
  }

  async function handleSaveAll() {
    setSaving(true)
    setSaveMsg(null)
    try {
      const tasks: Array<{ gameId: string; fields: Partial<Game> }> = []
      if (sportTab === 'volleyball') {
        for (const a of vbAssignments) {
          if (a.conflicts.some((c) => c.key === 'existingKept')) continue
          if (!a.scorerTeamId && !a.scoreboardTeamId && !a.combinedTeamId && !a.refereeTeamId) continue
          const fields: Partial<Game> = {}
          if (a.scorerTeamId) fields.scorer_duty_team = a.scorerTeamId
          if (a.scoreboardTeamId) fields.scoreboard_duty_team = a.scoreboardTeamId
          if (a.combinedTeamId) fields.scorer_scoreboard_duty_team = a.combinedTeamId
          if (a.refereeTeamId) fields.referee_duty_team = a.refereeTeamId
          tasks.push({ gameId: a.gameId, fields })
        }
      } else {
        for (const a of bbAssignments) {
          if (a.conflicts.some((c) => c.key === 'existingKept')) continue
          if (!a.dutyTeamId) continue
          tasks.push({ gameId: a.gameId, fields: { bb_duty_team: a.dutyTeamId } })
        }
      }
      // Save in parallel chunks instead of a serial await loop (a whole season is
      // hundreds of sequential PATCHes).
      const CHUNK_SIZE = 10
      for (let i = 0; i < tasks.length; i += CHUNK_SIZE) {
        await Promise.all(
          tasks.slice(i, i + CHUNK_SIZE).map(async ({ gameId, fields }) => {
            await updateRecord('games', gameId, fields)
            logActivity('update', 'games', gameId, fields)
          }),
        )
      }
      setSaveMsg({ text: t('saveSuccess', { count: tasks.length }), error: false })
    } catch {
      setSaveMsg({ text: t('saveError'), error: true })
    } finally {
      setSaving(false)
    }
  }

  async function handleDownloadXlsx() {
    const isVb = sportTab === 'volleyball'
    const teamColors = buildTeamColors((isVb ? vbTeams : bbTeams).map((tm) => tm.name))
    const conflictText = (cs: { key: string; params?: Record<string, string | number> }[]) =>
      cs.filter((c) => c.key !== 'existingKept').map((c) => t(c.key, c.params ?? {})).join('; ')
    const blank = { scorer: '', scoreboard: '', combined: '', referee: '', dutyTeam: '' }
    const meta = (gameId: string) => {
      const g = homeGames.find((x) => x.id === gameId)
      return {
        date: g ? formatDateCompact(g.date) : '', time: g?.time ? formatTime(g.time) : '',
        hall: g ? (hallNameById.get(String(g.hall)) ?? '') : '',
        home: g?.home_team ?? '', away: g?.away_team ?? '', league: g?.league ?? '',
      }
    }
    const gameRows: XlsxGameRow[] = isVb
      ? vbAssignments.map((a) => ({
          ...meta(a.gameId), ...blank,
          scorer: a.scorerTeamName ?? '', scoreboard: a.scoreboardTeamName ?? '',
          combined: a.combinedTeamName ?? '', referee: a.refereeTeamName ?? '',
          conflicts: conflictText(a.conflicts),
          status: a.conflicts.some((c) => c.key === 'existingKept') ? 'existing'
            : (!a.scorerTeamId && !a.scoreboardTeamId && !a.combinedTeamId && !a.refereeTeamId) ? 'unassigned' : 'ok',
        }))
      : bbAssignments.map((a) => ({
          ...meta(a.gameId), ...blank, dutyTeam: a.dutyTeamName ?? '',
          conflicts: conflictText(a.conflicts),
          status: a.conflicts.some((c) => c.key === 'existingKept') ? 'existing' : !a.dutyTeamId ? 'unassigned' : 'ok',
        }))
    const summaryRows: XlsxSummaryRow[] = isVb
      ? Array.from(vbTeamCounts.entries()).sort(([x], [y]) => x.localeCompare(y)).map(([team, c]) => ({
          team, games: c.ownGames, scorer: c.scorer, scoreboard: c.scoreboard, combined: c.combined, referee: c.referee, duties: c.totalDuties, total: c.totalDuties }))
      : Array.from(bbTeamCounts.entries()).sort(([x], [y]) => x.localeCompare(y)).map(([team, c]) => ({
          team, games: c.ownGames, scorer: 0, scoreboard: 0, combined: 0, referee: 0, duties: c.duties, total: c.duties }))
    const L: XlsxLabels = {
      sheetGames: t('title'), sheetSummary: t('teamSummary'),
      date: t('date'), time: t('time'), hall: t('hall'), home: t('home'), away: t('away'), league: t('league'),
      scorer: t('autoScorer'), scoreboard: t('autoTaefeler'), combined: t('combinedCount'),
      referee: t('refereeCount'), dutyTeam: t('autoDutyTeam'), conflicts: t('conflicts'),
      team: t('teamName'), games: t('ownGames'), total: t('totalCount'),
    }
    const bytes = await buildAssignmentXlsx(sportTab, gameRows, summaryRows, teamColors, L)
    downloadBytes(bytes, XLSX_MIME, `kscw_schreiber_zuteilung_${isVb ? 'vb' : 'bb'}_${season.replace('/', '-')}.xlsx`)
  }

  function handleVbOverride(gameId: string, role: 'scorer' | 'scoreboard' | 'combined' | 'referee', teamId: string) {
    setVbAssignments((prev) =>
      prev.map((a) => {
        if (a.gameId !== gameId) return a
        const teamName = teamNameById.get(teamId) ?? null
        if (role === 'combined') return { ...a, combinedTeamId: teamId || null, combinedTeamName: teamName }
        if (role === 'scorer') return { ...a, scorerTeamId: teamId || null, scorerTeamName: teamName }
        if (role === 'referee') return { ...a, refereeTeamId: teamId || null, refereeTeamName: teamName }
        return { ...a, scoreboardTeamId: teamId || null, scoreboardTeamName: teamName }
      }),
    )
  }

  function handleBbOverride(gameId: string, teamId: string) {
    setBbAssignments((prev) =>
      prev.map((a) =>
        a.gameId === gameId ? { ...a, dutyTeamId: teamId || null, dutyTeamName: teamNameById.get(teamId) ?? null } : a,
      ),
    )
  }

  const assignedCount = sportTab === 'volleyball'
    ? vbAssignments.filter((a) => a.scorerTeamId || a.scoreboardTeamId || a.combinedTeamId || a.refereeTeamId).length
    : bbAssignments.filter((a) => a.dutyTeamId).length

  if (!canVb && !canBb) {
    return <Navigate to="/" replace />
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 sm:text-2xl">{t('title')}</h1>
        <TourPageButton />
      </div>
      <p className="mt-1 text-gray-600 dark:text-gray-400">
        {sportTab === 'volleyball' ? t('subtitle') : t('subtitleBb')}
      </p>

      {/* Actions bar */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {canVb && canBb && (
          <SportToggle
            value={sportTab === 'volleyball' ? 'vb' : 'bb'}
            onChange={(v) => setSportTab(v === 'bb' ? 'basketball' : 'volleyball')}
            showAll={false}
          />
        )}

        <div data-tour="season-select" className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
          {t('season')}: {season}
        </div>

        <Button
          data-tour="auto-assign"
          size="sm"
          onClick={handleRunAlgorithm}
          loading={running}
          disabled={dataLoading || homeGames.length === 0}
        >
          {running ? t('running') : t('runAlgorithm')}
        </Button>

        {assignments.length > 0 && (
          <Button size="sm" onClick={handleSaveAll} loading={saving}>
            {saving ? t('saving') : t('saveAll')}
          </Button>
        )}

        {assignments.length > 0 && (
          <Button size="sm" variant="outline" onClick={handleDownloadXlsx}>
            {t('downloadXlsx')}
          </Button>
        )}
      </div>

      {/* Status messages */}
      <div className="mt-2 flex flex-wrap gap-2">
        {dataLoading && <LoadingSpinner />}
        {!dataLoading && homeGames.length > 0 && assignments.length === 0 && (
          <span className="text-sm text-gray-500">{t('gamesLoaded', { count: homeGames.length })}</span>
        )}
        {assignments.length > 0 && (
          <span className="text-sm text-green-600 dark:text-green-400">
            {t('assignmentsDone', { assigned: assignedCount, total: homeGames.length })}
          </span>
        )}
        {saveMsg && (
          <span className={`text-sm ${saveMsg.error ? 'text-red-600' : 'text-green-600 dark:text-green-400'}`}>
            {saveMsg.text}
          </span>
        )}
      </div>

      {/* Algorithm rules — collapsible; content switches with the sport
          because VB and BB use different engines (AssignmentAlgorithm.ts vs
          AssignmentAlgorithmBb.ts). */}
      <details className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm dark:border-gray-700 dark:bg-gray-800/40">
        <summary className="cursor-pointer select-none font-medium text-gray-700 dark:text-gray-300">
          {t('rulesTitle')}
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-gray-600 dark:text-gray-400">
            {sportTab === 'volleyball' ? t('rulesModeVb') : t('rulesModeBb')}
          </p>
          <div>
            <h3 className="font-semibold text-gray-800 dark:text-gray-200">{t('rulesHardTitle')}</h3>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-gray-600 dark:text-gray-400">
              {(sportTab === 'volleyball' ? VB_HARD_RULES : BB_HARD_RULES).map((k) => (
                <li key={k}>{t(k)}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-gray-800 dark:text-gray-200">{t('rulesSoftTitle')}</h3>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-gray-600 dark:text-gray-400">
              {(sportTab === 'volleyball' ? VB_SOFT_RULES : BB_SOFT_RULES).map((k) => (
                <li key={k}>{t(k)}</li>
              ))}
            </ul>
          </div>
          <p className="text-xs italic text-gray-500 dark:text-gray-400">{t('rulesExisting')}</p>
        </div>
      </details>

      {/* Team summary — kept at the top so the "who got how many duties"
          overview is visible before the per-game detail table. Split by sport
          via sportTab (each engine only fills its own sport's counts). */}
      {sportTab === 'volleyball' && vbTeamCounts.size > 0 && (
        <div className="mt-6" data-tour="team-summary">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('teamSummary')}</h2>
          <div className="mt-3 overflow-x-auto">
            <Table className="w-fit text-left text-sm">
              <TableHeader>
                <TableRow className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <TableHead className="px-3 py-2">{t('teamName')}</TableHead>
                  <TableHead className="px-3 py-2 text-center">{t('ownGames')}</TableHead>
                  <TableHead className="px-3 py-2 text-center">{t('scorerCount')}</TableHead>
                  <TableHead className="px-3 py-2 text-center">{t('scoreboardCount')}</TableHead>
                  <TableHead className="px-3 py-2 text-center">{t('combinedCount')}</TableHead>
                  <TableHead className="px-3 py-2 text-center">{t('refereeCount')}</TableHead>
                  <TableHead className="px-3 py-2 text-center">{t('totalCount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(vbTeamCounts.entries())
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([name, counts]) => (
                    <TableRow key={name} className="border-b border-gray-100 dark:border-gray-700/50">
                      <TableCell className="px-3 py-2"><TeamChip team={name} size="sm" /></TableCell>
                      <TableCell className="px-3 py-2 text-center text-gray-500 dark:text-gray-400">{counts.ownGames}</TableCell>
                      <TableCell className="px-3 py-2 text-center text-gray-600 dark:text-gray-400">{counts.scorer || '—'}</TableCell>
                      <TableCell className="px-3 py-2 text-center text-gray-600 dark:text-gray-400">{counts.scoreboard || '—'}</TableCell>
                      <TableCell className="px-3 py-2 text-center text-gray-600 dark:text-gray-400">{counts.combined || '—'}</TableCell>
                      <TableCell className="px-3 py-2 text-center text-gray-600 dark:text-gray-400">{counts.referee || '—'}</TableCell>
                      <TableCell className="px-3 py-2 text-center font-medium text-gray-900 dark:text-gray-100">{counts.totalDuties || '—'}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {sportTab === 'basketball' && bbTeamCounts.size > 0 && (
        <div className="mt-6" data-tour="team-summary">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('teamSummary')}</h2>
          <div className="mt-3 overflow-x-auto">
            <Table className="w-fit text-left text-sm">
              <TableHeader>
                <TableRow className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <TableHead className="px-3 py-2">{t('teamName')}</TableHead>
                  <TableHead className="px-3 py-2 text-center">{t('ownGames')}</TableHead>
                  <TableHead className="px-3 py-2 text-center">{t('dutyCount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(bbTeamCounts.entries())
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([name, counts]) => (
                    <TableRow key={name} className="border-b border-gray-100 dark:border-gray-700/50">
                      <TableCell className="px-3 py-2"><TeamChip team={name} size="sm" /></TableCell>
                      <TableCell className="px-3 py-2 text-center text-gray-500 dark:text-gray-400">{counts.ownGames}</TableCell>
                      <TableCell className="px-3 py-2 text-center font-medium text-gray-900 dark:text-gray-100">{counts.duties || '—'}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Results table */}
      {assignments.length > 0 && (
        <div data-tour="manual-assign" className="mt-6 overflow-x-auto">
          <Table className="w-full text-left text-sm">
            <TableHeader>
              <TableRow className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                <TableHead className="px-2 py-2">{t('date')}</TableHead>
                <TableHead className="px-2 py-2">{t('hall')}</TableHead>
                <TableHead className="px-2 py-2">{t('home')}</TableHead>
                <TableHead className="px-2 py-2">{t('away')}</TableHead>
                <TableHead className="px-2 py-2">{t('league')}</TableHead>
                {sportTab === 'volleyball' ? (
                  <>
                    <TableHead className="px-2 py-2">{t('autoScorer')}</TableHead>
                    <TableHead className="px-2 py-2">{t('autoTaefeler')}</TableHead>
                    <TableHead className="px-2 py-2">{t('refereeCount')}</TableHead>
                  </>
                ) : (
                  <TableHead className="px-2 py-2">{t('autoDutyTeam')}</TableHead>
                )}
                <TableHead className="px-2 py-2">{t('conflicts')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sportTab === 'volleyball'
                ? vbAssignments.map((a) => {
                    const game = homeGames.find((g) => g.id === a.gameId)
                    if (!game) return null
                    const hallName = hallNameById.get(String(game.hall)) ?? ''
                    const isExisting = a.conflicts.some((c) => c.key === 'existingKept')
                    const hasNoAssignment = !a.scorerTeamId && !a.scoreboardTeamId && !a.combinedTeamId && !a.refereeTeamId

                    return (
                      <TableRow
                        key={a.gameId}
                        className={`border-b border-gray-100 dark:border-gray-700/50 ${
                          hasNoAssignment ? 'bg-red-50 dark:bg-red-900/10' :
                          isExisting ? 'bg-gray-50 dark:bg-gray-800/50' : ''
                        }`}
                      >
                        <TableCell className="whitespace-nowrap px-2 py-2 text-gray-700 dark:text-gray-300">
                          <div>{formatDateCompact(game.date)}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{game.time ? formatTime(game.time) : ''}</div>
                        </TableCell>
                        <TableCell className="px-2 py-2 text-gray-600 dark:text-gray-400">{hallName}</TableCell>
                        <TableCell className="px-2 py-2 font-medium text-gray-900 dark:text-gray-100">{game.home_team}</TableCell>
                        <TableCell className="px-2 py-2 text-gray-700 dark:text-gray-300">{game.away_team}</TableCell>
                        <TableCell className="px-2 py-2 text-gray-500 dark:text-gray-400">
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-700">{game.league}</span>
                        </TableCell>
                        {a.mode === 'combined' ? (
                          <>
                            <TableCell className="px-2 py-2" colSpan={2}>
                              <TeamSelect value={a.combinedTeamId ?? ''} onChange={(v) => handleVbOverride(a.gameId, 'combined', v)} teams={vbTeams} placeholder={t('selectTeam')} compact />
                            </TableCell>
                            <TableCell className="px-2 py-2 text-center text-gray-300 dark:text-gray-600">—</TableCell>
                          </>
                        ) : a.mode === 'referee' ? (
                          <>
                            <TableCell className="px-2 py-2 text-center text-gray-300 dark:text-gray-600">—</TableCell>
                            <TableCell className="px-2 py-2 text-center text-gray-300 dark:text-gray-600">—</TableCell>
                            <TableCell className="px-2 py-2">
                              <TeamSelect value={a.refereeTeamId ?? ''} onChange={(v) => handleVbOverride(a.gameId, 'referee', v)} teams={vbTeams} placeholder={t('selectTeam')} compact />
                            </TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="px-2 py-2">
                              <TeamSelect value={a.scorerTeamId ?? ''} onChange={(v) => handleVbOverride(a.gameId, 'scorer', v)} teams={vbTeams} placeholder={t('selectTeam')} compact />
                            </TableCell>
                            <TableCell className="px-2 py-2">
                              <TeamSelect value={a.scoreboardTeamId ?? ''} onChange={(v) => handleVbOverride(a.gameId, 'scoreboard', v)} teams={vbTeams} placeholder={t('selectTeam')} compact />
                            </TableCell>
                            <TableCell className="px-2 py-2 text-center text-gray-300 dark:text-gray-600">—</TableCell>
                          </>
                        )}
                        <TableCell className="max-w-[200px] px-2 py-2">
                          {a.conflicts.length > 0 && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {a.conflicts.map((c, i) => {
                                const text = t(c.key, c.params ?? {})
                                return <div key={i} className="truncate" title={text}>{text}</div>
                              })}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                : bbAssignments.map((a) => {
                    const game = homeGames.find((g) => g.id === a.gameId)
                    if (!game) return null
                    const hallName = hallNameById.get(String(game.hall)) ?? ''
                    const isExisting = a.conflicts.some((c) => c.key === 'existingKept')
                    const hasNoAssignment = !a.dutyTeamId

                    return (
                      <TableRow
                        key={a.gameId}
                        className={`border-b border-gray-100 dark:border-gray-700/50 ${
                          hasNoAssignment ? 'bg-red-50 dark:bg-red-900/10' :
                          isExisting ? 'bg-gray-50 dark:bg-gray-800/50' : ''
                        }`}
                      >
                        <TableCell className="whitespace-nowrap px-2 py-2 text-gray-700 dark:text-gray-300">
                          <div>{formatDateCompact(game.date)}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{game.time ? formatTime(game.time) : ''}</div>
                        </TableCell>
                        <TableCell className="px-2 py-2 text-gray-600 dark:text-gray-400">{hallName}</TableCell>
                        <TableCell className="px-2 py-2 font-medium text-gray-900 dark:text-gray-100">{game.home_team}</TableCell>
                        <TableCell className="px-2 py-2 text-gray-700 dark:text-gray-300">{game.away_team}</TableCell>
                        <TableCell className="px-2 py-2 text-gray-500 dark:text-gray-400">
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-700">{game.league}</span>
                        </TableCell>
                        <TableCell className="px-2 py-2">
                          <div className="flex items-center gap-1">
                            <span className="rounded bg-orange-100 px-1 py-0.5 text-[10px] font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">{t('dutyTeamTag')}</span>
                            <TeamSelect value={a.dutyTeamId ?? ''} onChange={(v) => handleBbOverride(a.gameId, v)} teams={bbTeams} placeholder={t('selectTeam')} compact />
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[200px] px-2 py-2">
                          {a.conflicts.length > 0 && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {a.conflicts.map((c, i) => {
                                const text = t(c.key, c.params ?? {})
                                return <div key={i} className="truncate" title={text}>{text}</div>
                              })}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Empty state */}
      {!dataLoading && homeGames.length === 0 && (
        <div className="mt-12 py-12 text-center text-gray-500 dark:text-gray-400">
          <p>{t('noGames')}</p>
        </div>
      )}
    </div>
  )
}

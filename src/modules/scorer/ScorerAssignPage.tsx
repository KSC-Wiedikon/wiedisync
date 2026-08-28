import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router-dom'
import type { Game, Team, Training, Member, MemberTeam, Hall, LicenceType } from '../../types'
import { memberDisplayName, relId } from '../../utils/relations'
import { useCollection } from '../../lib/query'
import { useAuth } from '../../hooks/useAuth'
import { getCurrentSeason, getSeasonDateRange, formatDateCompact, formatTime } from '../../utils/dateHelpers'
import { logActivity } from '../../utils/logActivity'
import { Button } from '@/components/ui/button'
import LoadingSpinner from '../../components/LoadingSpinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import TeamChip from '../../components/TeamChip'
import { useConfirm } from '../../components/ConfirmProvider'
import AssignmentEditor from './components/AssignmentEditor'
import DutyOverview from './components/DutyOverview'
import SportToggle from '../../components/SportToggle'
import TabBar from '../../components/TabBar'
import { runAssignment, getTeamCounts, buildTeamGameTimes, buildTrainingDates, buildGamesByDateHall, getAdjacentTeams, timeToMin, classifyVbMode, EXCLUDED_DUTY_TEAM_NAMES, type GameAssignment } from './components/AssignmentAlgorithm'
import { runBbAssignment, getBbTeamCounts, type BbGameAssignment } from './components/AssignmentAlgorithmBb'
import { buildAssignmentXlsx, buildTeamColors, downloadBytes, XLSX_MIME, type XlsxGameRow, type XlsxSummaryRow, type XlsxLabels } from './lib/assignmentExport'
import { weekdayShort } from './lib/dutySpots'
import { updateRecord } from '../../lib/api'
import { maybeReloadOnStaleChunk } from '../../lib/chunkReload'
import { captureApiError } from '../../lib/sentry'
import { useReportPageLoading } from '../../hooks/usePageReady'
import { TourPageButton } from '../guide/TourPageButton'

type SportTab = 'volleyball' | 'basketball'
// 'plan' = the auto-assign planner (draft → roll out); 'overview' = the saved
// duty picture (team assigned + who signed up).
type Tab = 'plan' | 'overview'

// The working matching is a DRAFT — auto-persisted to localStorage (per sport +
// season) so it survives reloads. "Roll out" writes the duties to the games.
const DRAFT_KEY = (sport: SportTab, season: string) => `kscw:scorer-assign-draft:${sport}:${season}`
function loadDraft<T>(sport: SportTab, season: string): T[] {
  try { const raw = localStorage.getItem(DRAFT_KEY(sport, season)); return raw ? (JSON.parse(raw) as T[]) : [] } catch { return [] }
}
function saveDraft(sport: SportTab, season: string, data: unknown[]) {
  try {
    if (data.length) localStorage.setItem(DRAFT_KEY(sport, season), JSON.stringify(data))
    else localStorage.removeItem(DRAFT_KEY(sport, season))
  } catch { /* storage full / disabled — draft just won't persist */ }
}

// Rule labels shown in the collapsible "Algorithm rules" panel. The order and
// point values mirror AssignmentAlgorithm.ts (VB) / AssignmentAlgorithmBb.ts
// (BB) — keep them in sync if the engines change.
const VB_HARD_RULES = ['ruleVbHardGame', 'ruleVbHardDuty', 'ruleVbHardLicence']
const VB_SOFT_RULES = ['ruleVbSoftSequence', 'ruleVbSoftOnSite', 'ruleVbSoftHu20', 'ruleVbSoftLegends', 'ruleVbSoftTraining', 'ruleVbSoftRotation', 'ruleVbSoftRefereeCredit', 'ruleVbSoftManualCredit']
const BB_HARD_RULES = ['ruleBbHardGame', 'ruleBbHardDuty', 'ruleBbHardOtr1']
const BB_SOFT_RULES = ['ruleBbSoftFullCrew', 'ruleBbSoftSequence', 'ruleBbSoftTraining', 'ruleBbSoftRotation', 'ruleBbSoftWeekend']

export default function ScorerAssignPage() {
  const { t, i18n } = useTranslation('scorerAssign')
  // Exports are ALWAYS English, whatever the UI language (app-wide convention).
  const tEn = useMemo(() => i18n.getFixedT('en', 'scorerAssign'), [i18n])
  const { user, hasAdminAccessToSport } = useAuth()
  const confirm = useConfirm()

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
  const trainings = useMemo(() => trainingsRaw ?? [], [trainingsRaw])

  // Fetch the per-flag licence booleans (migration 067) — the legacy
  // `licences` JSON array is no longer the source of truth.
  const { data: membersRaw, isLoading: membersLoading } = useCollection<Member>('members', {
    filter: { kscw_membership_active: { _eq: true } },
    // kscw_membership_active is selected (not just filtered) because the person
    // editor (AssignmentEditor) filters members on that field.
    // otn1_bb/otn2_bb must be selected too — an unfetched column arrives
    // undefined and reads as false, silently hiding eligible 24s officials.
    fields: ['id', 'first_name', 'last_name', 'nickname', 'scorer_vb', 'referee_vb', 'otr1_bb', 'otr2_bb', 'otn1_bb', 'otn2_bb', 'kscw_membership_active'],
    all: true,
  })
  const members = useMemo(() => membersRaw ?? [], [membersRaw])

  // Active teams only — see ScorerPage: an all-seasons read lets a stale guest
  // flag permanently exclude a member from the duty pickers.
  const { data: memberTeamsRaw, isLoading: memberTeamsLoading } = useCollection<MemberTeam>('member_teams', {
    filter: { team: { active: { _eq: true } } },
    all: true,
    enabled: !!user,
  })
  const memberTeams = useMemo(() => memberTeamsRaw ?? [], [memberTeamsRaw])

  // Team → member ids, and guest member ids — for the per-duty person editor.
  const teamMemberIds = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const mt of memberTeams) {
      const tid = String(mt.team)
      let set = m.get(tid)
      if (!set) { set = new Set(); m.set(tid, set) }
      set.add(String(mt.member))
    }
    return m
  }, [memberTeams])
  const guestMemberIds = useMemo(() => {
    const s = new Set<string>()
    for (const mt of memberTeams) if ((mt.guest_level ?? 0) > 0) s.add(String(mt.member))
    return s
  }, [memberTeams])

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
  // Tab is reflected in the URL (?tab=overview) so it's deep-linkable + survives
  // a refresh; the default (plan) keeps the URL clean. Same pattern as /scorer.
  const [tab, setTabState] = useState<Tab>(
    () => (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tab') === 'overview' ? 'overview' : 'plan'),
  )
  const setTab = useCallback((next: Tab) => {
    setTabState(next)
    const url = new URL(window.location.href)
    if (next === 'overview') url.searchParams.set('tab', 'overview')
    else url.searchParams.delete('tab')
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  }, [])
  const [sportTab, setSportTab] = useState<SportTab>(canVb ? 'volleyball' : 'basketball')
  const [vbAssignments, setVbAssignments] = useState<GameAssignment[]>(() => loadDraft<GameAssignment>('volleyball', season))
  const [bbAssignments, setBbAssignments] = useState<BbGameAssignment[]>(() => loadDraft<BbGameAssignment>('basketball', season))
  // Auto-save the draft whenever it changes (external system → effect is correct).
  useEffect(() => { saveDraft('volleyball', season, vbAssignments) }, [vbAssignments, season])
  useEffect(() => { saveDraft('basketball', season, bbAssignments) }, [bbAssignments, season])
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ text: string; error: boolean } | null>(null)
  const [running, setRunning] = useState(false)
  // Manual per-team duty credits, edited inline in the team summary. Applied to
  // the next run immediately (local override) and persisted to teams.duty_credit
  // in the background. Keyed by team id.
  const [creditOverrides, setCreditOverrides] = useState<Record<string, number>>({})
  const [savingCredit, setSavingCredit] = useState<string | null>(null)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)

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

  // Game start-times per team/day — for the render-time "plays a match then" note.
  const teamGameTimes = useMemo(() => buildTeamGameTimes(sportGames), [sportGames])
  // Training days + hall schedule — recomputed notes read these so a manual
  // dropdown change re-derives the notes for the NEWLY picked team.
  const trainingDateSet = useMemo(() => buildTrainingDates(trainings), [trainings])
  const gamesByDateHall = useMemo(() => buildGamesByDateHall(sportGames), [sportGames])

  type Note = { text: string; tone: 'danger' | 'warn' | 'ok' | 'muted' }

  // Curated, human-readable notes for a game's assignment. Derived entirely from
  // the CURRENT assigned teams (not the frozen algorithm conflicts), so editing a
  // dropdown immediately refreshes them: training clash, on-site (before/after own
  // game), and the safety check that no assigned team actually plays at that time.
  // Row-level status notes (existing kept / unfilled slot) are passed in.
  const notesFor = (tr: typeof t, assigned: Array<[string | null, string | null]>, game: Game, statusNotes: Note[] = []): Note[] => {
    const out: Note[] = []
    const seen = new Set<string>()
    const add = (text: string, tone: Note['tone']) => { if (text && !seen.has(text)) { seen.add(text); out.push({ text, tone }) } }
    const adjacent = getAdjacentTeams(game, gamesByDateHall)
    const dutyMin = timeToMin(game.time)
    for (const [tid, tname] of assigned) {
      if (!tid) continue
      const team = tname ?? ''
      if (trainingDateSet.has(`${tid}|${game.date}`)) add(tr('noteTraining', { team }), 'warn')
      if (adjacent.has(tid)) add(tr('noteAdjacent', { team }), 'ok')
      if (dutyMin != null && (teamGameTimes.get(`${tid}|${game.date}`) ?? []).some((m) => Math.abs(m - dutyMin) < 120)) {
        add(tr('noteMatchConflict', { team }), 'danger')
      }
    }
    for (const n of statusNotes) add(n.text, n.tone)
    return out
  }

  // Row-level status notes (existing-kept banner + unfilled required slots).
  // Recomputed from the current assignment so filling/clearing a slot toggles them.
  const vbStatusNotes = (tr: typeof t, a: GameAssignment): Note[] => {
    const s: Note[] = []
    // Cup games are on-call/Pikett slots: nobody is summoned automatically, but
    // the planner may assign somebody by hand. Say "on call" only while the row is
    // still empty, and never warn about an unfilled slot nobody owes.
    if (a.mode === 'cup') {
      const picked = a.scorerTeamId || a.scoreboardTeamId || a.combinedTeamId || a.refereeTeamId
      return picked ? [] : [{ text: tr('cupOnCall'), tone: 'muted' }]
    }
    if (a.conflicts.some((c) => c.key === 'existingKept')) s.push({ text: tr('existingKept'), tone: 'muted' })
    if (a.mode === 'combined') { if (!a.combinedTeamId) s.push({ text: tr('noTeamAvailable'), tone: 'warn' }) }
    else if (a.mode === 'referee') { if (!a.refereeTeamId) s.push({ text: tr('noRefereeAvailable'), tone: 'warn' }) }
    else {
      if (!a.scorerTeamId) s.push({ text: tr('noScorerAvailable'), tone: 'warn' })
      if (!a.scoreboardTeamId) s.push({ text: tr('noTaefelerAvailable'), tone: 'warn' })
    }
    return s
  }
  const bbStatusNotes = (tr: typeof t, a: BbGameAssignment): Note[] => {
    const s: Note[] = []
    if (a.conflicts.some((c) => c.key === 'existingKept')) s.push({ text: tr('existingKept'), tone: 'muted' })
    if (!a.dutyTeamId) s.push({ text: tr('noTeamAvailable'), tone: 'warn' })
    return s
  }

  // member id → display name, and team id → member ids — for the roll-out
  // integrity clear and the "already signed up" highlight below.
  const memberNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const mb of members) m.set(String(mb.id), memberDisplayName(mb))
    return m
  }, [members])
  // A game that already has a person signed up — highlighted so the admin knows
  // that changing this game's duty team on roll-out resets a person who isn't in
  // the new team (the integrity rule enforced in handleSaveAll).
  const signedUpNote = (tr: typeof t, game: Game | undefined): Note[] => {
    if (!game) return []
    const ids = [game.scorer_member, game.scoreboard_member, game.scorer_scoreboard_member, game.referee_member,
      game.bb_scorer_member, game.bb_timekeeper_member, game.bb_24s_official].filter(Boolean).map((x) => String(x))
    if (!ids.length) return []
    return [{ text: tr('signedUp', { names: ids.map((id) => memberNameById.get(id) ?? '?').join(', ') }), tone: 'ok' }]
  }

  const noteToneClass = (tone: Note['tone']) =>
    tone === 'danger' ? 'text-red-600 dark:text-red-400 font-medium'
      : tone === 'warn' ? 'text-amber-600 dark:text-amber-400'
        : tone === 'ok' ? 'text-green-600 dark:text-green-400'
          : 'text-gray-400 dark:text-gray-500'

  // Teams with any pending manual-credit edits merged in, so the next run and the
  // summary reflect the change instantly (the DB write happens in the background).
  const teamsWithCredit = useMemo(
    () => teams.map((tm) => (tm.id in creditOverrides ? { ...tm, duty_credit: creditOverrides[tm.id] } : tm)),
    [teams, creditOverrides],
  )

  // Commit a manual credit edit: apply locally + persist to teams.duty_credit.
  async function commitCredit(teamId: string, raw: number) {
    const value = Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0
    setCreditOverrides((prev) => ({ ...prev, [teamId]: value }))
    setSavingCredit(teamId)
    try {
      await updateRecord('teams', teamId, { duty_credit: value })
    } catch {
      setSaveMsg({ text: t('creditSaveError'), error: true })
    } finally {
      setSavingCredit(null)
    }
  }

  const vbTeamCounts = useMemo(() => getTeamCounts(vbAssignments, teamsWithCredit, sportGames, members, memberTeams), [vbAssignments, teamsWithCredit, sportGames, members, memberTeams])
  const bbTeamCounts = useMemo(() => getBbTeamCounts(bbAssignments, teams, sportGames), [bbAssignments, teams, sportGames])

  const assignments = sportTab === 'volleyball' ? vbAssignments : bbAssignments

  // Actions
  function handleRunAlgorithm() {
    setRunning(true)
    setSaveMsg(null)
    setTimeout(() => {
      if (sportTab === 'volleyball') {
        setVbAssignments(runAssignment({ games: sportGames, teams: teamsWithCredit, trainings, members, memberTeams, halls }))
      } else {
        setBbAssignments(runBbAssignment({ games: sportGames, teams, trainings, members, memberTeams }))
      }
      setRunning(false)
    }, 50)
  }

  // Re-running recomputes from the games' CURRENT saved state — already-rolled-out
  // duties are kept (existingKept), but any unsaved manual edits in this view are
  // discarded. The Run button is locked once a situation is loaded (below), so a
  // deliberate recompute goes through this confirm instead.
  async function handleRerun() {
    if (!(await confirm({ message: t('rerunConfirm'), danger: true }))) return
    handleRunAlgorithm()
  }

  async function handleSaveAll() {
    setSaving(true)
    setSaveMsg(null)
    try {
      const tasks: Array<{ gameId: string; fields: Record<string, unknown> }> = []
      // When a duty team is (re)assigned, a person previously signed up who is
      // NOT in the new team is reset — otherwise the game keeps an assignee who
      // doesn't belong to the duty team (the integrity check we audit for).
      const clearOrphan = (fields: Record<string, unknown>, g: Game | undefined, teamId: string, memberField: keyof Game) => {
        const mem = g && g[memberField] ? String(g[memberField]) : null
        if (mem && !teamMemberIds.get(teamId)?.has(mem)) fields[memberField] = null
      }
      if (sportTab === 'volleyball') {
        for (const a of vbAssignments) {
          if (a.conflicts.some((c) => c.key === 'existingKept')) continue
          if (!a.scorerTeamId && !a.scoreboardTeamId && !a.combinedTeamId && !a.refereeTeamId) continue
          const g = homeGames.find((x) => x.id === a.gameId)
          const fields: Record<string, unknown> = {}
          // Each role: write the duty team; write the assignee if the person
          // editor set one (undefined = untouched → just reset an orphan).
          const roleOut = (teamId: string, draftMember: string | null | undefined, teamField: string, memberField: keyof Game) => {
            fields[teamField] = teamId
            if (draftMember !== undefined) fields[memberField] = draftMember
            else clearOrphan(fields, g, teamId, memberField)
          }
          if (a.scorerTeamId) roleOut(a.scorerTeamId, a.scorerMemberId, 'scorer_duty_team', 'scorer_member')
          if (a.scoreboardTeamId) roleOut(a.scoreboardTeamId, a.scoreboardMemberId, 'scoreboard_duty_team', 'scoreboard_member')
          if (a.combinedTeamId) roleOut(a.combinedTeamId, a.combinedMemberId, 'scorer_scoreboard_duty_team', 'scorer_scoreboard_member')
          if (a.refereeTeamId) roleOut(a.refereeTeamId, a.refereeMemberId, 'referee_duty_team', 'referee_member')
          tasks.push({ gameId: a.gameId, fields })
        }
      } else {
        for (const a of bbAssignments) {
          if (a.conflicts.some((c) => c.key === 'existingKept')) continue
          if (!a.dutyTeamId) continue
          const g = homeGames.find((x) => x.id === a.gameId)
          const fields: Record<string, unknown> = { bb_duty_team: a.dutyTeamId }
          const bbRoleOut = (draftMember: string | null | undefined, memberField: keyof Game) => {
            if (draftMember !== undefined) fields[memberField] = draftMember
            else clearOrphan(fields, g, a.dutyTeamId as string, memberField)
          }
          bbRoleOut(a.bbScorerMemberId, 'bb_scorer_member')
          bbRoleOut(a.bbTimekeeperMemberId, 'bb_timekeeper_member')
          bbRoleOut(a.bb24sMemberId, 'bb_24s_official')
          tasks.push({ gameId: a.gameId, fields })
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
    const blank = { scorer: '', scoreboard: '', combined: '', referee: '', dutyTeam: '' }
    const meta = (gameId: string) => {
      const g = homeGames.find((x) => x.id === gameId)
      return {
        gameNo: g?.game_id ?? '', weekday: g ? weekdayShort(g.date) : '',
        date: g ? formatDateCompact(g.date) : '', time: g?.time ? formatTime(g.time) : '',
        hall: g ? (hallNameById.get(String(g.hall)) ?? '') : '',
        home: g?.home_team ?? '', away: g?.away_team ?? '', league: g?.league ?? '',
      }
    }
    // Same curated notes as the table, but ALWAYS in English (export convention).
    const noteText = (assigned: Array<[string | null, string | null]>, gameId: string, statusNotes: Note[]) => {
      const g = homeGames.find((x) => x.id === gameId)
      return g ? notesFor(tEn, assigned, g, [...statusNotes, ...signedUpNote(tEn, g)]).map((n) => n.text).join('; ') : ''
    }
    const gameRows: XlsxGameRow[] = isVb
      ? vbAssignments.map((a) => ({
          ...meta(a.gameId), ...blank,
          scorer: a.scorerTeamName ?? '', scoreboard: a.scoreboardTeamName ?? '',
          combined: a.combinedTeamName ?? '', referee: a.refereeTeamName ?? '',
          conflicts: noteText([[a.scorerTeamId, a.scorerTeamName], [a.scoreboardTeamId, a.scoreboardTeamName], [a.combinedTeamId, a.combinedTeamName], [a.refereeTeamId, a.refereeTeamName]], a.gameId, vbStatusNotes(tEn, a)),
          status: a.mode === 'cup' ? 'cup'
            : a.conflicts.some((c) => c.key === 'existingKept') ? 'existing'
            : (!a.scorerTeamId && !a.scoreboardTeamId && !a.combinedTeamId && !a.refereeTeamId) ? 'unassigned' : 'ok',
        }))
      : bbAssignments.map((a) => ({
          ...meta(a.gameId), ...blank, dutyTeam: a.dutyTeamName ?? '',
          conflicts: noteText([[a.dutyTeamId, a.dutyTeamName]], a.gameId, bbStatusNotes(tEn, a)),
          status: a.conflicts.some((c) => c.key === 'existingKept') ? 'existing' : !a.dutyTeamId ? 'unassigned' : 'ok',
        }))
    const summaryRows: XlsxSummaryRow[] = isVb
      ? Array.from(vbTeamCounts.entries()).sort(([x], [y]) => x.localeCompare(y)).map(([team, c]) => ({
          team, games: c.ownGames, scorer: c.scorer, scoreboard: c.scoreboard, combined: c.combined, referee: c.referee, duties: c.totalDuties, total: c.totalDuties }))
      : Array.from(bbTeamCounts.entries()).sort(([x], [y]) => x.localeCompare(y)).map(([team, c]) => ({
          team, games: c.ownGames, scorer: 0, scoreboard: 0, combined: 0, referee: 0, duties: c.duties, total: c.duties }))
    const L: XlsxLabels = {
      sheetGames: tEn('title'), sheetSummary: tEn('teamSummary'),
      gameNo: tEn('gameNo'), weekday: tEn('weekday'),
      date: tEn('date'), time: tEn('time'), hall: tEn('hall'), home: tEn('home'), away: tEn('away'), league: tEn('league'),
      scorer: tEn('autoScorer'), scoreboard: tEn('autoTaefeler'), combined: tEn('combinedCount'),
      referee: tEn('refereeCount'), dutyTeam: tEn('autoDutyTeam'), conflicts: tEn('notes'),
      team: tEn('teamName'), games: tEn('ownGames'), total: tEn('totalCount'),
    }
    const bytes = await buildAssignmentXlsx(sportTab, gameRows, summaryRows, teamColors, L)
    downloadBytes(bytes, XLSX_MIME, `kscw_scorer_assignment_${isVb ? 'vb' : 'bb'}_${season.replace('/', '-')}.xlsx`)
  }

  // A manually edited row is no longer an untouched "existing" assignment — drop
  // the existingKept flag so it (a) loses the "kept" note/greyout and (b) is
  // actually written by Roll out (which skips existingKept rows).
  const stripExisting = <T extends { conflicts: GameAssignment['conflicts'] }>(a: T): T =>
    a.conflicts.some((c) => c.key === 'existingKept') ? { ...a, conflicts: a.conflicts.filter((c) => c.key !== 'existingKept') } : a

  function handleVbOverride(gameId: string, role: 'scorer' | 'scoreboard' | 'combined' | 'referee', teamId: string) {
    setVbAssignments((prev) =>
      prev.map((a) => {
        if (a.gameId !== gameId) return a
        const teamName = teamNameById.get(teamId) ?? null
        const b = stripExisting(a)
        if (role === 'combined') return { ...b, combinedTeamId: teamId || null, combinedTeamName: teamName }
        if (role === 'scorer') return { ...b, scorerTeamId: teamId || null, scorerTeamName: teamName }
        if (role === 'referee') return { ...b, refereeTeamId: teamId || null, refereeTeamName: teamName }
        return { ...b, scoreboardTeamId: teamId || null, scoreboardTeamName: teamName }
      }),
    )
  }

  function handleBbOverride(gameId: string, teamId: string) {
    setBbAssignments((prev) =>
      prev.map((a) =>
        a.gameId === gameId ? { ...stripExisting(a), dutyTeamId: teamId || null, dutyTeamName: teamNameById.get(teamId) ?? null } : a,
      ),
    )
  }

  // Per-duty assignee edits (Phase 2 person editor). memberId '' clears it.
  function handleVbPerson(gameId: string, role: 'scorer' | 'scoreboard' | 'combined' | 'referee', memberId: string) {
    setVbAssignments((prev) => prev.map((a) => {
      if (a.gameId !== gameId) return a
      const b = stripExisting(a)
      const v = memberId || null
      if (role === 'combined') return { ...b, combinedMemberId: v }
      if (role === 'scorer') return { ...b, scorerMemberId: v }
      if (role === 'referee') return { ...b, refereeMemberId: v }
      return { ...b, scoreboardMemberId: v }
    }))
  }
  function handleBbPerson(gameId: string, role: 'scorer' | 'timekeeper' | '24s', memberId: string) {
    setBbAssignments((prev) => prev.map((a) => {
      if (a.gameId !== gameId) return a
      const b = stripExisting(a)
      const v = memberId || null
      if (role === 'scorer') return { ...b, bbScorerMemberId: v }
      if (role === 'timekeeper') return { ...b, bbTimekeeperMemberId: v }
      return { ...b, bb24sMemberId: v }
    }))
  }
  // The draft assignee for a role, falling back to the game's current member when
  // the draft hasn't touched it (undefined). '' when there's no assignee.
  const personValueOf = (draft: string | null | undefined, current: unknown): string =>
    draft !== undefined ? (draft ?? '') : (current ? String(current) : '')

  // One duty's team+person editor in the results table (reuses the /scorer editor
  // so the person-first linking, team→member filtering and orphan-reset match).
  // A cup row has no mode of its own (runAssignment gives every cup game mode
  // 'cup'), so its duty cells are laid out by the PLAYING team's mode.
  // classifyVbMode reads that team's own name + league, which is why the game's
  // "Züri Cup — Runde 2, Spiel 3" league string does not throw it off.
  const cupLayoutMode = (gameId: string): 'separate' | 'combined' | 'referee' => {
    const g = homeGames.find((x) => x.id === gameId)
    const tm = g ? vbTeams.find((x) => String(x.id) === relId(g.kscw_team)) : undefined
    return classifyVbMode(tm?.name ?? '', tm?.league ?? '')
  }

  const renderVbDuty = (
    gameId: string,
    role: 'scorer' | 'scoreboard' | 'combined' | 'referee',
    teamId: string | null,
    draftMember: string | null | undefined,
    currentMember: unknown,
    licence?: LicenceType,
  ) => (
    <AssignmentEditor
      label=""
      requiredLicence={licence}
      teamValue={teamId ?? ''}
      personValue={personValueOf(draftMember, currentMember)}
      members={members}
      teams={vbTeams}
      teamMemberIds={teamMemberIds}
      sport="volleyball"
      onTeamChange={(v) => handleVbOverride(gameId, role, v)}
      onPersonChange={(v) => handleVbPerson(gameId, role, v)}
      disabled={false}
      canEdit
      guestMemberIds={guestMemberIds}
    />
  )

  // BB duty cell: one shared duty team + up to 3 officials (scorer + timekeeper,
  // plus 24s when the game needs it). The scorer editor carries the team; the
  // other two hide the team dropdown and share it (person-first still derives it).
  const renderBbPerson = (
    a: BbGameAssignment,
    role: 'scorer' | 'timekeeper' | '24s', label: string,
    draftMember: string | null | undefined, currentMember: unknown,
    licence: LicenceType | LicenceType[], hideTeam: boolean,
  ) => (
    <AssignmentEditor
      label={label}
      requiredLicence={licence}
      hideTeam={hideTeam}
      teamValue={a.dutyTeamId ?? ''}
      personValue={personValueOf(draftMember, currentMember)}
      members={members}
      teams={bbTeams}
      teamMemberIds={teamMemberIds}
      sport="basketball"
      onTeamChange={(v) => handleBbOverride(a.gameId, v)}
      onPersonChange={(v) => handleBbPerson(a.gameId, role, v)}
      disabled={false}
      canEdit
      guestMemberIds={guestMemberIds}
    />
  )
  const renderBbDuty = (a: BbGameAssignment, game: Game) => (
    <div className="space-y-2 min-w-[220px]">
      {renderBbPerson(a, 'scorer', t('bbScorer'), a.bbScorerMemberId, game.bb_scorer_member, 'otr1_bb', false)}
      {renderBbPerson(a, 'timekeeper', t('bbTimekeeper'), a.bbTimekeeperMemberId, game.bb_timekeeper_member, 'otr1_bb', true)}
      {renderBbPerson(a, '24s', t('bb24sOfficial'), a.bb24sMemberId, game.bb_24s_official, ['otr2_bb', 'otn1_bb', 'otn2_bb'], true)}
    </div>
  )

  // Upload a corrected export (.xlsx): match each row to a game by its Swiss
  // Volley / Basketplan number (games.game_id, the "Game no." column) and apply
  // the team columns to the draft. Team names map back to ids; unknown names and
  // unmatched rows are reported. The draft can then be rolled out as usual.
  async function handleUploadXlsx(file: File) {
    const isVb = sportTab === 'volleyball'
    // The Upload button renders as soon as a draft exists (restored from
    // localStorage), which can be BEFORE the season's games finish loading. With
    // no games loaded, every row matches nothing → a misleading "no matches".
    // Guard with a clear "still loading" message instead.
    if (dataLoading || homeGames.length === 0) {
      setSaveMsg({ text: t('uploadNotReady'), error: true })
      return
    }
    // exceljs is a large lazy chunk. After a deploy its hash rotates; a tab still
    // on the old bundle then imports a now-missing chunk (CF Pages serves the SPA
    // fallback) → hard-reload to pick up the current bundle, the same recovery
    // every other lazy export uses. Swallowing this into "could not read the
    // file" (the old bare catch) both hid the cause and skipped the reload.
    let ExcelJS: typeof import('exceljs')
    try {
      ExcelJS = await import('exceljs')
    } catch (err) {
      if (maybeReloadOnStaleChunk(err)) return // stale chunk → reloading now
      setSaveMsg({ text: t('uploadStale'), error: true }) // reload on cooldown
      return
    }
    try {
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(await file.arrayBuffer())
      const ws = wb.worksheets[0]
      if (!ws) { setSaveMsg({ text: t('uploadError'), error: true }); return }

      // Header labels are the English export headers.
      const headerIdx = new Map<string, number>()
      ws.getRow(1).eachCell((cell, c) => { const k = String(cell.value ?? '').trim(); if (k) headerIdx.set(k, c) })
      const col = (label: string) => headerIdx.get(label) ?? -1
      const gameNoCol = col(tEn('gameNo'))
      if (gameNoCol < 0) { setSaveMsg({ text: t('uploadNoIdColumn'), error: true }); return }
      const scorerCol = col(tEn('autoScorer')), scoreboardCol = col(tEn('autoTaefeler')),
        combinedCol = col(tEn('combinedCount')), refereeCol = col(tEn('refereeCount')), dutyCol = col(tEn('autoDutyTeam'))

      const internalIdByGameNo = new Map<string, string>()
      for (const g of homeGames) if (g.game_id) internalIdByGameNo.set(String(g.game_id).trim(), g.id)
      const teamIdByName = new Map<string, string>()
      for (const tm of teams) teamIdByName.set(tm.name.trim(), tm.id)

      const unknownTeams = new Set<string>()
      const cellStr = (row: import('exceljs').Row, c: number) => (c > 0 ? String(row.getCell(c).value ?? '').trim() : '')
      const nameToId = (name: string) => {
        if (!name) return null
        const id = teamIdByName.get(name)
        if (!id) { unknownTeams.add(name); return null }
        return id
      }

      const vbUpdates = new Map<string, { scorer: string | null; scoreboard: string | null; combined: string | null; referee: string | null }>()
      const bbUpdates = new Map<string, string | null>()
      let unmatched = 0
      ws.eachRow((row, rn) => {
        if (rn === 1) return
        const gameNo = cellStr(row, gameNoCol)
        if (!gameNo) return
        const internalId = internalIdByGameNo.get(gameNo)
        if (!internalId) { unmatched++; return }
        if (isVb) vbUpdates.set(internalId, { scorer: nameToId(cellStr(row, scorerCol)), scoreboard: nameToId(cellStr(row, scoreboardCol)), combined: nameToId(cellStr(row, combinedCol)), referee: nameToId(cellStr(row, refereeCol)) })
        else bbUpdates.set(internalId, nameToId(cellStr(row, dutyCol)))
      })

      const applied = isVb ? vbUpdates.size : bbUpdates.size
      if (applied === 0) { setSaveMsg({ text: t('uploadNoMatches'), error: true }); return }

      const nameOf = (id: string | null) => (id ? (teamNameById.get(id) ?? null) : null)
      if (isVb) {
        setVbAssignments((prev) => prev.map((a) => {
          const u = vbUpdates.get(a.gameId); if (!u) return a
          // Clamp to the game's mode so a stray value in an irrelevant column
          // (e.g. Scorer filled on a combined game) can't pollute roll-out. A cup
          // row has no mode of its own — clamp it to the playing team's layout,
          // the same one its editor renders.
          const layout = a.mode === 'cup' ? cupLayoutMode(a.gameId) : a.mode
          const b = { ...stripExisting(a), scorerTeamId: null, scorerTeamName: null, scoreboardTeamId: null, scoreboardTeamName: null, combinedTeamId: null, combinedTeamName: null, refereeTeamId: null, refereeTeamName: null }
          if (layout === 'combined') return { ...b, combinedTeamId: u.combined, combinedTeamName: nameOf(u.combined) }
          if (layout === 'referee') return { ...b, refereeTeamId: u.referee, refereeTeamName: nameOf(u.referee) }
          return { ...b, scorerTeamId: u.scorer, scorerTeamName: nameOf(u.scorer), scoreboardTeamId: u.scoreboard, scoreboardTeamName: nameOf(u.scoreboard) }
        }))
      } else {
        setBbAssignments((prev) => prev.map((a) => {
          if (!bbUpdates.has(a.gameId)) return a
          const duty = bbUpdates.get(a.gameId) ?? null
          return { ...stripExisting(a), dutyTeamId: duty, dutyTeamName: nameOf(duty) }
        }))
      }

      const parts = [t('uploadApplied', { count: applied })]
      if (unmatched) parts.push(t('uploadUnmatched', { count: unmatched }))
      if (unknownTeams.size) parts.push(t('uploadUnknownTeams', { names: [...unknownTeams].join(', ') }))
      setSaveMsg({ text: parts.join(' '), error: unmatched > 0 || unknownTeams.size > 0 })
    } catch (err) {
      // A genuine parse failure (corrupt/renamed file) — log it so it's ever
      // diagnosable, then show the generic "could not read" message. The old
      // bare catch discarded the error, which is why this was invisible.
      captureApiError(err, { operation: 'scorerUploadXlsx', collection: 'games' })
      setSaveMsg({ text: t('uploadError'), error: true })
    }
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

      {/* Sport, season and tabs — shared by both tabs */}
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

        <TabBar
          tabs={[{ key: 'plan', label: t('tabPlan') }, { key: 'overview', label: t('tabOverview') }]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {/* Overview tab — the SAVED duty picture (team assigned + who signed up),
          independent of the planner's draft. */}
      {tab === 'overview' && (dataLoading ? (
        <div className="mt-4"><LoadingSpinner /></div>
      ) : (
        <DutyOverview
          games={homeGames}
          teams={teams}
          members={members}
          hallNameById={hallNameById}
          sport={sportTab}
          season={season}
        />
      ))}

      {tab === 'plan' && (<>

      {/* Actions bar */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          data-tour="auto-assign"
          size="sm"
          onClick={handleRunAlgorithm}
          loading={running && assignments.length === 0}
          // Locked once a situation is loaded (draft restored or rolled out) so a
          // stray click can't recompute over it — deliberate re-runs use Recompute.
          disabled={dataLoading || homeGames.length === 0 || assignments.length > 0}
          title={assignments.length > 0 ? t('runLockedHint') : undefined}
        >
          {running && assignments.length === 0 ? t('running') : t('runAlgorithm')}
        </Button>

        {assignments.length > 0 && (
          <Button size="sm" variant="ghost" onClick={handleRerun} loading={running} title={t('rerunHint')}>
            {running ? t('running') : t('rerun')}
          </Button>
        )}

        {assignments.length > 0 && (
          <Button size="sm" onClick={handleSaveAll} loading={saving} title={t('rollOutHint')}>
            {saving ? t('rollingOut') : t('rollOut')}
          </Button>
        )}

        {assignments.length > 0 && (
          <Button size="sm" variant="outline" onClick={handleDownloadXlsx}>
            {t('downloadXlsx')}
          </Button>
        )}

        {assignments.length > 0 && (
          <>
            <input
              ref={uploadInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadXlsx(f); e.target.value = '' }}
            />
            <Button size="sm" variant="outline" onClick={() => uploadInputRef.current?.click()} title={t('uploadHint')}>
              {t('uploadCorrected')}
            </Button>
          </>
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
        {assignments.length > 0 && (
          <span className="text-sm text-gray-400 dark:text-gray-500">· {t('draftSaved')}</span>
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
                  <TableHead className="px-3 py-2 text-center" title={t('refereesHint')}>{t('refereesCount')}</TableHead>
                  <TableHead className="px-3 py-2 text-center" title={t('creditHint')}>{t('creditCount')}</TableHead>
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
                      <TableCell className="px-3 py-2 text-center text-gray-500 dark:text-gray-400"
                        title={counts.referees > counts.refereeCredit ? t('refereesCapped', { count: counts.referees, credit: counts.refereeCredit }) : undefined}>
                        {counts.referees
                          ? <span>{counts.referees}<span className="text-gray-400 dark:text-gray-500"> (−{counts.refereeCredit})</span></span>
                          : '—'}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-center">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          defaultValue={counts.dutyCredit || 0}
                          key={`${counts.teamId}:${counts.dutyCredit}`}
                          disabled={savingCredit === counts.teamId}
                          onBlur={(e) => {
                            const v = Math.max(0, Math.round(Number(e.target.value) || 0))
                            if (v !== (counts.dutyCredit || 0)) commitCredit(counts.teamId, v)
                          }}
                          className="w-14 rounded border border-gray-300 bg-white px-2 py-1 text-center text-sm text-gray-900 focus:border-primary focus:outline-none disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                          aria-label={t('creditCount')}
                        />
                      </TableCell>
                      <TableCell className="px-3 py-2 text-center font-medium text-gray-900 dark:text-gray-100">{counts.totalDuties || '—'}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{t('creditFootnote')}</p>
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
                <TableHead className="px-2 py-2">{t('notes')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sportTab === 'volleyball'
                ? vbAssignments.map((a) => {
                    const game = homeGames.find((g) => g.id === a.gameId)
                    if (!game) return null
                    const hallName = hallNameById.get(String(game.hall)) ?? ''
                    const isCup = a.mode === 'cup'
                    // Cup rows are assignable — nobody is summoned automatically,
                    // but the planner can pick a team/person like any other game.
                    const layoutMode = isCup ? cupLayoutMode(a.gameId) : a.mode
                    const isExisting = a.conflicts.some((c) => c.key === 'existingKept')
                    // Cup games are intentionally unassigned (free slot) → not a red gap.
                    const hasNoAssignment = !isCup && !a.scorerTeamId && !a.scoreboardTeamId && !a.combinedTeamId && !a.refereeTeamId
                    const assignedTeams: Array<[string | null, string | null]> = [[a.scorerTeamId, a.scorerTeamName], [a.scoreboardTeamId, a.scoreboardTeamName], [a.combinedTeamId, a.combinedTeamName], [a.refereeTeamId, a.refereeTeamName]]

                    return (
                      <TableRow
                        key={a.gameId}
                        className={`border-b border-gray-100 dark:border-gray-700/50 ${
                          hasNoAssignment ? 'bg-red-50 dark:bg-red-900/10' :
                          isCup ? 'bg-blue-50/50 dark:bg-blue-900/10' :
                          isExisting ? 'bg-gray-50 dark:bg-gray-800/50' : ''
                        }`}
                      >
                        <TableCell className="whitespace-nowrap px-2 py-2 text-gray-700 dark:text-gray-300">
                          <div><span className="text-gray-400 dark:text-gray-500">{weekdayShort(game.date)}</span> {formatDateCompact(game.date)}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{game.time ? formatTime(game.time) : ''}</div>
                        </TableCell>
                        <TableCell className="px-2 py-2 text-gray-600 dark:text-gray-400">{hallName}</TableCell>
                        <TableCell className="px-2 py-2 font-medium text-gray-900 dark:text-gray-100">{game.home_team}</TableCell>
                        <TableCell className="px-2 py-2 text-gray-700 dark:text-gray-300">{game.away_team}</TableCell>
                        <TableCell className="px-2 py-2 text-gray-500 dark:text-gray-400">
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-700">{game.league}</span>
                        </TableCell>
                        {layoutMode === 'combined' ? (
                          <>
                            <TableCell className="px-2 py-2 align-top" colSpan={2}>
                              {renderVbDuty(a.gameId, 'combined', a.combinedTeamId, a.combinedMemberId, game.scorer_scoreboard_member)}
                            </TableCell>
                            <TableCell className="px-2 py-2 text-center text-gray-300 dark:text-gray-600">—</TableCell>
                          </>
                        ) : layoutMode === 'referee' ? (
                          <>
                            <TableCell className="px-2 py-2 text-center text-gray-300 dark:text-gray-600">—</TableCell>
                            <TableCell className="px-2 py-2 text-center text-gray-300 dark:text-gray-600">—</TableCell>
                            <TableCell className="px-2 py-2 align-top">
                              {renderVbDuty(a.gameId, 'referee', a.refereeTeamId, a.refereeMemberId, game.referee_member)}
                            </TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="px-2 py-2 align-top">
                              {renderVbDuty(a.gameId, 'scorer', a.scorerTeamId, a.scorerMemberId, game.scorer_member, 'scorer_vb')}
                            </TableCell>
                            <TableCell className="px-2 py-2 align-top">
                              {renderVbDuty(a.gameId, 'scoreboard', a.scoreboardTeamId, a.scoreboardMemberId, game.scoreboard_member)}
                            </TableCell>
                            <TableCell className="px-2 py-2 text-center text-gray-300 dark:text-gray-600">—</TableCell>
                          </>
                        )}
                        <TableCell className="max-w-[240px] px-2 py-2">
                          <div className="space-y-0.5 text-xs">
                            {notesFor(t, assignedTeams, game, [...vbStatusNotes(t, a), ...signedUpNote(t, game)]).map((n, i) => (
                              <div key={i} className={`truncate ${noteToneClass(n.tone)}`} title={n.text}>{n.text}</div>
                            ))}
                          </div>
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
                    const assignedTeams: Array<[string | null, string | null]> = [[a.dutyTeamId, a.dutyTeamName]]

                    return (
                      <TableRow
                        key={a.gameId}
                        className={`border-b border-gray-100 dark:border-gray-700/50 ${
                          hasNoAssignment ? 'bg-red-50 dark:bg-red-900/10' :
                          isExisting ? 'bg-gray-50 dark:bg-gray-800/50' : ''
                        }`}
                      >
                        <TableCell className="whitespace-nowrap px-2 py-2 text-gray-700 dark:text-gray-300">
                          <div><span className="text-gray-400 dark:text-gray-500">{weekdayShort(game.date)}</span> {formatDateCompact(game.date)}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{game.time ? formatTime(game.time) : ''}</div>
                        </TableCell>
                        <TableCell className="px-2 py-2 text-gray-600 dark:text-gray-400">{hallName}</TableCell>
                        <TableCell className="px-2 py-2 font-medium text-gray-900 dark:text-gray-100">{game.home_team}</TableCell>
                        <TableCell className="px-2 py-2 text-gray-700 dark:text-gray-300">{game.away_team}</TableCell>
                        <TableCell className="px-2 py-2 text-gray-500 dark:text-gray-400">
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-700">{game.league}</span>
                        </TableCell>
                        <TableCell className="px-2 py-2 align-top">
                          {renderBbDuty(a, game)}
                        </TableCell>
                        <TableCell className="max-w-[240px] px-2 py-2">
                          <div className="space-y-0.5 text-xs">
                            {notesFor(t, assignedTeams, game, [...bbStatusNotes(t, a), ...signedUpNote(t, game)]).map((n, i) => (
                              <div key={i} className={`truncate ${noteToneClass(n.tone)}`} title={n.text}>{n.text}</div>
                            ))}
                          </div>
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

      </>)}
    </div>
  )
}

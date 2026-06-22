import { useState, useMemo, useCallback } from 'react'
import DOMPurify from 'dompurify'
import { useTranslation } from 'react-i18next'
import type { Game, Member, Team, MemberTeam, ScorerDelegation } from '../../types'
import { licencesOf } from '../../types'
import { useCollection } from '../../lib/query'
import { useRealtime } from '../../hooks/useRealtime'
import { useAuth } from '../../hooks/useAuth'
import { useAdminMode } from '../../hooks/useAdminMode'
import { logActivity } from '../../utils/logActivity'
import { todayLocal, isWithinGameContactWindow } from '../../utils/dateHelpers'
import { Button } from '@/components/ui/button'
import { FormInput } from '@/components/FormField'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DatePicker from '@/components/ui/DatePicker'
import TeamSelect from '../../components/TeamSelect'
import TabBar from '../../components/TabBar'
import SportToggle from '../../components/SportToggle'
import type { SportView } from '../../hooks/useSportPreference'
import ScorerRow, { hasAnyVbAssignment, hasAnyBbAssignment, isFullyAssigned } from './components/ScorerRow'
import TeamOverview from './components/TeamOverview'
import DelegationRequestBanner from './components/DelegationRequestBanner'
import { useScorerDelegations } from './hooks/useScorerDelegations'
import { useOfficialContacts } from './hooks/useOfficialContacts'
import LoadingSpinner from '../../components/LoadingSpinner'
import { Bell, BellOff, ChevronDown, ChevronUp, Filter, Info, Clock, AlertTriangle, ClipboardList, Lightbulb } from 'lucide-react'
import { TourPageButton } from '../guide/TourPageButton'
import { updateRecord } from '../../lib/api'

type Tab = 'games' | 'overview'
type SportTab = 'volleyball' | 'basketball'
type VbDutyTypeFilter = 'all' | 'scorer' | 'scoreboard' | 'scorer_scoreboard'
type VbUnassignedFilter = 'all' | 'scorer' | 'scoreboard' | 'scorer_scoreboard' | 'any'
type BbUnassignedFilter = 'all' | 'bb_scorer' | 'bb_timekeeper' | 'bb_24s_official' | 'any'

const PAST_PAGE_SIZE = 5

export default function ScorerPage() {
  const { t } = useTranslation('scorer')
  const { user, isSuperAdmin, hasAdminAccessToSport, coachTeamIds, teamResponsibleIds } = useAuth()
  const { effectiveIsAdmin, effectiveIsVorstand } = useAdminMode()

  const [tab, setTab] = useState<Tab>('games')
  const [sportTab, setSportTab] = useState<SportTab>('volleyball')
  const [dutyScope, setDutyScope] = useState<'all' | 'mine'>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Filters
  const [dateFilter, setDateFilter] = useState('')
  const [dutyTeamFilter, setDutyTeamFilter] = useState('')
  const [dutyTypeFilter, setDutyTypeFilter] = useState<VbDutyTypeFilter>('all')
  const [unassignedFilter, setUnassignedFilter] = useState<VbUnassignedFilter | BbUnassignedFilter>('all')
  const [searchAssignee, setSearchAssignee] = useState('')

  // Past games
  const [showPast, setShowPast] = useState(false)
  const [pastVisible, setPastVisible] = useState(PAST_PAGE_SIZE)
  const [reminderToggling, setReminderToggling] = useState(false)
  const canEdit = effectiveIsAdmin && hasAdminAccessToSport(sportTab)
  // Admins see the assigned official's contact on any game (items API).
  // Coaches / team-responsibles see it only for their own duty games AND only
  // within the contact window (1h before kickoff → 1h after) — the per-game
  // gate below; the data itself is server-scoped per game via useOfficialContacts.
  const isSportAdmin = effectiveIsAdmin && hasAdminAccessToSport(sportTab)
  const isLeader = coachTeamIds.length > 0 || teamResponsibleIds.length > 0
  const showContactForGame = (g: Game): boolean =>
    isSportAdmin || (isLeader && isWithinGameContactWindow(g.date, g.time))

  const today = useMemo(() => todayLocal(), [])

  const {
    data: upcomingGamesRaw,
    isLoading: gamesLoading,
    refetch,
  } = useCollection<Game>('games', {
    filter: { _and: [{ type: { _eq: 'home' } }, { date: { _gte: today } }, { status: { _nin: ['completed', 'postponed'] } }] },
    sort: ['date', 'time'],
    limit: 200,
  })
  const upcomingGames = upcomingGamesRaw ?? []

  const { data: allPastGamesRaw, isLoading: pastLoading } = useCollection<Game>('games', {
    filter: { _and: [{ type: { _eq: 'home' } }, { date: { _lt: today } }] },
    sort: ['-date', '-time'],
    limit: 200,
    enabled: showPast,
  })
  const allPastGames = allPastGamesRaw ?? []

  // Reminder email toggle (superuser only)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: appSettingsRaw, refetch: refetchSettings } = useCollection<any>('app_settings', {
    filter: { key: { _eq: 'scorer_reminders_enabled' } },
    limit: 1,
    enabled: isSuperAdmin,
  })
  const appSettings = appSettingsRaw ?? []
  const reminderSetting = appSettings[0] as { id: string; enabled: boolean } | undefined
  const remindersEnabled = reminderSetting?.enabled ?? false

  async function toggleReminders() {
    if (!reminderSetting) return
    setReminderToggling(true)
    try {
      await updateRecord('app_settings', reminderSetting.id, { requestKey: null })
      refetchSettings()
    } catch (err) {
      console.error('Failed to toggle reminders:', err)
    } finally {
      setReminderToggling(false)
    }
  }

  const { data: membersRaw, isLoading: membersLoading } = useCollection<Member>('members', {
    filter: { kscw_membership_active: { _eq: true } },
    sort: ['last_name', 'first_name'],
    all: true,
    fields: ['id', 'first_name', 'last_name', 'scorer_vb', 'otr1_bb', 'otr2_bb', 'otn_bb', 'kscw_membership_active', 'phone', 'email'],
  })
  const members = membersRaw ?? []

  // Contact details (email/phone) for officials of the coach/TR's own duty games.
  // Empty for admins (they read contacts via the items API) and non-leaders.
  const officialContacts = useOfficialContacts()
  const membersWithContact = useMemo(() => {
    if (officialContacts.size === 0) return members
    return members.map((m) => {
      const c = officialContacts.get(m.id)
      return c
        ? { ...m, phone: c.phone ?? m.phone, email: c.email ?? m.email, hide_phone: c.hide_phone, hide_email: c.hide_email }
        : m
    })
  }, [members, officialContacts])

  const { data: teamsRaw, isLoading: teamsDataLoading } = useCollection<Team>('teams', {
    filter: { active: { _eq: true } },
    fields: ['id', 'name', 'sport'],
    sort: ['name'],
    all: true,
  })
  const teams = teamsRaw ?? []

  const { data: allMemberTeamsRaw, isLoading: memberTeamsLoading } = useCollection<MemberTeam>('member_teams', {
    fields: ['id', 'team', 'member', 'guest_level'],
    all: true,
    enabled: !!user,
  })
  const allMemberTeams = allMemberTeamsRaw ?? []

  // Supporting data ScorerRow renders from (members/teams/member_teams). Both the
  // upcoming and past sections gate on this in addition to games loading so rows
  // never render against empty lookup maps.
  const supportingLoading = membersLoading || teamsDataLoading || memberTeamsLoading
  const teamMemberIds = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const mt of allMemberTeams) {
      if (!map.has(mt.team)) map.set(mt.team, new Set())
      map.get(mt.team)!.add(mt.member)
    }
    return map
  }, [allMemberTeams])

  const guestMemberIds = useMemo(() => {
    const guests = new Set<string>()
    for (const mt of allMemberTeams) {
      if ((mt.guest_level ?? 0) > 0) guests.add(mt.member)
    }
    return guests
  }, [allMemberTeams])

  const userTeamIds = useMemo(() => {
    if (!user) return []
    const ids: string[] = []
    for (const mt of allMemberTeams) {
      if (String(mt.member) === String(user.id)) ids.push(mt.team)
    }
    return ids
  }, [allMemberTeams, user])

  // Teams whose duty games this user may see: teams they play in PLUS teams they
  // coach / are responsible for (so a staff-only coach — not a roster member —
  // still sees their team's duty games, and the assigned official's contact).
  const myDutyTeamIds = useMemo(
    () => [...new Set([...userTeamIds, ...coachTeamIds, ...teamResponsibleIds])],
    [userTeamIds, coachTeamIds, teamResponsibleIds],
  )

  const memberMap = useMemo(() => {
    const map = new Map<string, Member>()
    for (const m of members) map.set(m.id, m)
    return map
  }, [members])

  // Delegation hook
  const {
    pendingIncoming,
    createDelegation,
    acceptDelegation,
    declineDelegation,
    getPendingForRole,
    getDelegationTargetName,
  } = useScorerDelegations()

  const getGameSport = (g: Game): 'volleyball' | 'basketball' => {
    const teamObj = g.kscw_team != null && typeof g.kscw_team === 'object' ? g.kscw_team as unknown as Team : null
    return teamObj?.sport ?? (g.source === 'basketplan' ? 'basketball' : 'volleyball')
  }

  useRealtime<Game>('games', () => { refetch() }, ['update'])

  const filteredGames = useMemo(() => {
    return upcomingGames.filter((g) => {
      if (getGameSport(g) !== sportTab) return false

      // "Selected" scope: only games I'm personally assigned to (signed up for)
      if (dutyScope === 'mine' && user) {
        const isPersonallyAssigned = sportTab === 'volleyball'
          ? [g.scorer_member, g.scoreboard_member, g.scorer_scoreboard_member].includes(String(user.id))
          : [g.bb_scorer_member, g.bb_timekeeper_member, g.bb_24s_official].includes(String(user.id))
        if (!isPersonallyAssigned) return false
      }

      // Non-admins: only show games where their team has duty or they are personally assigned
      if (!effectiveIsAdmin && !effectiveIsVorstand && user) {
        const isPersonallyAssigned = sportTab === 'volleyball'
          ? [g.scorer_member, g.scoreboard_member, g.scorer_scoreboard_member].includes(String(user.id))
          : [g.bb_scorer_member, g.bb_timekeeper_member, g.bb_24s_official].includes(String(user.id))
        const teamHasDuty = sportTab === 'volleyball'
          ? myDutyTeamIds.some((tid) => tid === g.scorer_duty_team || tid === g.scoreboard_duty_team || tid === g.scorer_scoreboard_duty_team)
          : myDutyTeamIds.some((tid) => tid === (g.bb_scorer_duty_team || g.bb_duty_team) || tid === (g.bb_timekeeper_duty_team || g.bb_duty_team) || tid === (g.bb_24s_duty_team || g.bb_duty_team))
        if (!isPersonallyAssigned && !teamHasDuty) return false
      }

      if (dateFilter && g.date !== dateFilter) return false

      if (dutyTeamFilter) {
        if (sportTab === 'volleyball') {
          const matchesTeam =
            g.scorer_duty_team === dutyTeamFilter ||
            g.scoreboard_duty_team === dutyTeamFilter ||
            g.scorer_scoreboard_duty_team === dutyTeamFilter
          if (!matchesTeam) return false
        } else {
          const matchesTeam =
            (g.bb_scorer_duty_team || g.bb_duty_team) === dutyTeamFilter ||
            (g.bb_timekeeper_duty_team || g.bb_duty_team) === dutyTeamFilter ||
            (g.bb_24s_duty_team || g.bb_duty_team) === dutyTeamFilter
          if (!matchesTeam) return false
        }
      }

      if (sportTab === 'volleyball' && dutyTypeFilter !== 'all') {
        if (dutyTypeFilter === 'scorer_scoreboard') {
          if (!g.scorer_scoreboard_duty_team && !g.scorer_scoreboard_member) return false
        } else if (dutyTypeFilter === 'scorer') {
          if (!g.scorer_duty_team && !g.scorer_member) return false
        } else if (dutyTypeFilter === 'scoreboard') {
          if (!g.scoreboard_duty_team && !g.scoreboard_member) return false
        }
      }

      if (unassignedFilter !== 'all') {
        if (sportTab === 'volleyball') {
          const vbFilter = unassignedFilter as VbUnassignedFilter
          if (vbFilter === 'any') {
            const hasUnassigned =
              ((g.scorer_duty_team || g.scorer_member) && !g.scorer_member) ||
              ((g.scoreboard_duty_team || g.scoreboard_member) && !g.scoreboard_member) ||
              ((g.scorer_scoreboard_duty_team || g.scorer_scoreboard_member) && !g.scorer_scoreboard_member)
            if (!hasUnassigned && hasAnyVbAssignment(g)) return false
            if (!hasUnassigned && !hasAnyVbAssignment(g)) return true
          } else if (vbFilter === 'scorer') {
            if (g.scorer_member) return false
            if (!g.scorer_duty_team) return false
          } else if (vbFilter === 'scoreboard') {
            if (g.scoreboard_member) return false
            if (!g.scoreboard_duty_team) return false
          } else if (vbFilter === 'scorer_scoreboard') {
            if (g.scorer_scoreboard_member) return false
            if (!g.scorer_scoreboard_duty_team) return false
          }
        } else {
          const bbFilter = unassignedFilter as BbUnassignedFilter
          if (bbFilter === 'any') {
            const hasUnassigned =
              ((g.bb_scorer_duty_team || g.bb_duty_team) && !g.bb_scorer_member) ||
              ((g.bb_timekeeper_duty_team || g.bb_duty_team) && !g.bb_timekeeper_member)
            if (!hasUnassigned && hasAnyBbAssignment(g)) return false
            if (!hasUnassigned && !hasAnyBbAssignment(g)) return true
          } else if (bbFilter === 'bb_scorer') {
            if (g.bb_scorer_member) return false
            if (!(g.bb_scorer_duty_team || g.bb_duty_team)) return false
          } else if (bbFilter === 'bb_timekeeper') {
            if (g.bb_timekeeper_member) return false
            if (!(g.bb_timekeeper_duty_team || g.bb_duty_team)) return false
          } else if (bbFilter === 'bb_24s_official') {
            if (g.bb_24s_official) return false
            if (!(g.bb_24s_duty_team || g.bb_duty_team)) return false
          }
        }
      }

      if (searchAssignee.trim()) {
        const q = searchAssignee.toLowerCase()
        const ids = sportTab === 'volleyball'
          ? [g.scorer_member, g.scoreboard_member, g.scorer_scoreboard_member].filter(Boolean) as string[]
          : [g.bb_scorer_member, g.bb_timekeeper_member, g.bb_24s_official].filter(Boolean) as string[]
        const matches = ids.some((id) => {
          const m = memberMap.get(id)
          if (!m) return false
          return `${m.first_name} ${m.last_name}`.toLowerCase().includes(q)
        })
        if (!matches) return false
      }

      return true
    }).sort((a, b) => {
      // Primary: sort by date ascending
      if (a.date !== b.date) return a.date < b.date ? -1 : 1
      // Secondary: not-fully-confirmed games first (a duty is confirmed once it
      // has a person; "fully assigned" = every applicable duty filled).
      const aFull = isFullyAssigned(a, sportTab)
      const bFull = isFullyAssigned(b, sportTab)
      if (aFull !== bFull) return aFull ? 1 : -1
      // Among incomplete: fully-open before partially assigned
      if (!aFull && !bFull) {
        const aAssigned = sportTab === 'volleyball' ? hasAnyVbAssignment(a) : hasAnyBbAssignment(a)
        const bAssigned = sportTab === 'volleyball' ? hasAnyVbAssignment(b) : hasAnyBbAssignment(b)
        if (aAssigned !== bAssigned) return aAssigned ? 1 : -1
      }
      // Tiebreaker: sort by time ascending
      if (a.time !== b.time) return (a.time || '') < (b.time || '') ? -1 : 1
      return 0
    })
  }, [upcomingGames, sportTab, dutyScope, effectiveIsAdmin, effectiveIsVorstand, user, myDutyTeamIds, dateFilter, dutyTeamFilter, dutyTypeFilter, unassignedFilter, searchAssignee, memberMap])

  const filteredPastGames = useMemo(() => allPastGames.filter((g) => {
    if (getGameSport(g) !== sportTab) return false
    if (!effectiveIsAdmin && !effectiveIsVorstand && user) {
      const isPersonallyAssigned = sportTab === 'volleyball'
        ? [g.scorer_member, g.scoreboard_member, g.scorer_scoreboard_member].includes(String(user.id))
        : [g.bb_scorer_member, g.bb_timekeeper_member, g.bb_24s_official].includes(String(user.id))
      const teamHasDuty = sportTab === 'volleyball'
        ? myDutyTeamIds.some((tid) => tid === g.scorer_duty_team || tid === g.scoreboard_duty_team || tid === g.scorer_scoreboard_duty_team)
        : myDutyTeamIds.some((tid) => tid === (g.bb_scorer_duty_team || g.bb_duty_team) || tid === (g.bb_timekeeper_duty_team || g.bb_duty_team) || tid === (g.bb_24s_duty_team || g.bb_duty_team))
      if (!isPersonallyAssigned && !teamHasDuty) return false
    }
    return true
  }), [allPastGames, sportTab, effectiveIsAdmin, effectiveIsVorstand, user, myDutyTeamIds])
  const visiblePastGames = useMemo(() => filteredPastGames.slice(0, pastVisible), [filteredPastGames, pastVisible])

  const hasActiveFilters = !!(dateFilter || dutyTeamFilter || dutyTypeFilter !== 'all' || unassignedFilter !== 'all' || searchAssignee)

  function clearFilters() {
    setDateFilter('')
    setDutyTeamFilter('')
    setDutyTypeFilter('all')
    setUnassignedFilter('all')
    setSearchAssignee('')
  }

  async function handleUpdate(gameId: string, fields: Partial<Game>) {
    const oldGame = upcomingGames.find((g) => g.id === gameId) || allPastGames.find((g) => g.id === gameId)
    try {
      await updateRecord('games', gameId, fields as Record<string, unknown>)
      if (oldGame) {
        const changes: Record<string, { old: string; new: string }> = {}
        for (const [key, newVal] of Object.entries(fields)) {
          const oldVal = (oldGame as Record<string, unknown>)[key]
          if (oldVal !== newVal) {
            changes[key] = { old: String(oldVal ?? ''), new: String(newVal ?? '') }
          }
        }
        if (Object.keys(changes).length > 0) {
          logActivity('update', 'games', gameId, changes)
        }
      }
      refetch()
    } catch (err) {
      console.error('Failed to update game:', err)
    }
  }

  const handleDelegate = useCallback(
    async (gameId: string, role: ScorerDelegation['role'], toMemberId: string, fromTeamId: string, toTeamId: string) => {
      try {
        const delegation = await createDelegation(gameId, role, toMemberId, fromTeamId, toTeamId)
        if (delegation.same_team) {
          refetch()
        }
      } catch (err) {
        console.error('Failed to create delegation:', err)
      }
    },
    [createDelegation, refetch],
  )

  const handleAcceptDelegation = useCallback(
    async (delegationId: string) => {
      try {
        await acceptDelegation(delegationId)
        refetch()
      } catch (err) {
        console.error('Failed to accept delegation:', err)
      }
    },
    [acceptDelegation, refetch],
  )

  const handleDeclineDelegation = useCallback(
    async (delegationId: string) => {
      try {
        await declineDelegation(delegationId)
      } catch (err) {
        console.error('Failed to decline delegation:', err)
      }
    },
    [declineDelegation],
  )

  const allGames = useMemo(() => [...upcomingGames, ...allPastGames], [upcomingGames, allPastGames])

  // Each games section waits for its games query AND the supporting data its rows
  // render from, so ScorerRow never paints against empty lookup maps.
  const upcomingLoading = gamesLoading || supportingLoading
  const pastGateLoading = pastLoading || supportingLoading

  const filterLabelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400'

  const renderScorerRow = (g: Game, isPast = false) => (
    <ScorerRow
      key={g.id}
      game={g}
      members={membersWithContact}
      teams={teams}
      teamMemberIds={teamMemberIds}
      memberTeams={allMemberTeams}
      guestMemberIds={guestMemberIds}
      onUpdate={handleUpdate}
      canEdit={isPast ? false : canEdit}
      isAdmin={isSportAdmin}
      showContact={showContactForGame(g)}
      userId={user?.id}
      userTeamIds={userTeamIds}
      userLicences={user ? licencesOf(user) : []}
      sport={sportTab}
      onDelegate={isPast ? undefined : handleDelegate}
      getPendingForRole={getPendingForRole}
      getDelegationTargetName={getDelegationTargetName}
    />
  )

  return (
    <div>
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 sm:text-2xl">{t('title')}</h1>
        <TourPageButton />
      </div>
      <p className="mt-1 text-gray-600 dark:text-gray-400">{t('subtitle')}</p>

      {/* Expandable info panel (volleyball only) */}
      {sportTab === 'volleyball' && (
        <details className="mt-3 rounded-lg border border-brand-200 bg-brand-50/50 dark:border-brand-800 dark:bg-brand-900/20 [&[open]>summary_.chevron-down]:hidden [&:not([open])>summary_.chevron-up]:hidden">
        <summary
          className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-brand-700 dark:text-brand-400 [&::-webkit-details-marker]:hidden"
        >
          <span className="flex items-center gap-2">
            <Info className="h-4 w-4" />
            {t('infoTitle')}
          </span>
          <ChevronDown className="h-4 w-4" />
        </summary>
        <div className="space-y-4 border-t border-brand-200 px-4 py-4 text-sm text-gray-700 dark:border-brand-800 dark:text-gray-300">
          <div className="flex gap-3">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-brand-500 dark:text-brand-400" />
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">{t('infoArrivalTitle')}</h3>
              {/* eslint-disable-next-line react/no-danger -- hardcoded i18n */}
              <p className="mt-1 [&_strong]:font-semibold" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t('infoArrivalScorer')) }} />
              {/* eslint-disable-next-line react/no-danger -- hardcoded i18n */}
              <p className="mt-1 [&_strong]:font-semibold" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t('infoArrivalTaefeler')) }} />
            </div>
          </div>
          <div className="flex gap-3 rounded-lg bg-red-50/80 px-3 py-2.5 dark:bg-red-900/10">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
            <div>
              <h3 className="font-semibold text-red-600 dark:text-red-400">{t('infoWarningTitle')}</h3>
              <p className="mt-1 text-red-600/80 dark:text-red-400/80">{t('infoWarningFine')}</p>
              {/* eslint-disable-next-line react/no-danger -- hardcoded i18n */}
              <p className="mt-1 text-red-600/80 dark:text-red-400/80 [&_strong]:font-semibold" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t('confirmSelfAssignWarning')) }} />
            </div>
          </div>
          <div className="flex gap-3">
            <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-brand-500 dark:text-brand-400" />
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">{t('infoRequirementsTitle')}</h3>
              <p className="mt-1">{t('infoRequirements')}</p>
              {/* eslint-disable-next-line react/no-danger -- hardcoded i18n */}
              <p className="mt-1 [&_strong]:font-semibold" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t('infoRequirementsArrival')) }} />
            </div>
          </div>
          <div className="flex gap-3">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-brand-500 dark:text-brand-400" />
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">{t('infoHowToTitle')}</h3>
              <p className="mt-1">{t('infoHowTo')}</p>
            </div>
          </div>
        </div>
        </details>
      )}

      {/* Reminder email toggle (superuser only) */}
      {isSuperAdmin && effectiveIsAdmin && reminderSetting && (
        <button
          onClick={toggleReminders}
          disabled={reminderToggling}
          className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors ${
            remindersEnabled
              ? 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-700 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50'
              : 'border-gray-300 bg-gray-50 text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
          }`}
        >
          {remindersEnabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
          {t('reminderEmails')}: {remindersEnabled ? t('reminderEmailsOn') : t('reminderEmailsOff')}
        </button>
      )}

      {/* Sport toggle + Tab bar */}
      <div className="mt-4 flex items-center justify-between gap-4">
        {effectiveIsAdmin ? (
          <SportToggle
            value={sportTab === 'volleyball' ? 'vb' : 'bb'}
            onChange={(v: SportView) => {
              setSportTab(v === 'bb' ? 'basketball' : 'volleyball')
              clearFilters()
            }}
            showAll={false}
          />
        ) : <div />}
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          {(['games', 'overview'] as Tab[]).map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`min-h-[44px] px-4 py-3 text-sm font-medium transition-colors ${
                tab === key
                  ? 'border-b-2 border-brand-600 text-brand-700 dark:text-brand-400'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              {key === 'games' ? t('tabGames') : t('tabOverview')}
            </button>
          ))}
        </div>
      </div>

      {tab === 'games' && (
        <>
          {/* All vs Selected (games I'm personally assigned to) */}
          <div className="mt-4">
            <TabBar<'all' | 'mine'>
              tabs={[{ key: 'all', label: t('dutyScopeAll') }, { key: 'mine', label: t('dutyScopeMine') }]}
              active={dutyScope}
              onChange={setDutyScope}
            />
          </div>

          {/* Pending incoming delegation requests */}
          {pendingIncoming.length > 0 && (
            <div className="mt-4">
              <DelegationRequestBanner
                delegations={pendingIncoming}
                members={members}
                games={allGames}
                onAccept={handleAcceptDelegation}
                onDecline={handleDeclineDelegation}
              />
            </div>
          )}

          {/* Filters */}
          <div data-tour="scorer-filters" className="mt-4 rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
            <button
              onClick={() => setFiltersOpen(!filtersOpen)}
              className="flex w-full items-center justify-between px-4 py-3.5 text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              <span className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                {t('filters')}
                {hasActiveFilters && (
                  <span className="rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-bold text-white">!</span>
                )}
              </span>
              {filtersOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {filtersOpen && (
              <div className="border-t border-gray-200 p-4 dark:border-gray-700">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label htmlFor="scorer-date" className={filterLabelClass}>{t('filterDate')}</label>
                    <DatePicker id="scorer-date" value={dateFilter} onChange={setDateFilter} />
                  </div>
                  <div>
                    <label htmlFor="scorer-duty-team" className={filterLabelClass}>{t('filterDutyTeam')}</label>
                    <TeamSelect value={dutyTeamFilter} onChange={setDutyTeamFilter} teams={teams} placeholder={t('filterAllTeams')} aria-label={t('filterDutyTeam')} />
                  </div>
                  {sportTab === 'volleyball' && (
                    <div>
                      <label htmlFor="scorer-duty-type" className={filterLabelClass}>{t('filterDutyType')}</label>
                      <Select value={dutyTypeFilter} onValueChange={(v) => setDutyTypeFilter(v as VbDutyTypeFilter)}>
                        <SelectTrigger className="min-h-[44px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t('filterAllTypes')}</SelectItem>
                          <SelectItem value="scorer">{t('scorer')}</SelectItem>
                          <SelectItem value="scoreboard">{t('scoreboard')}</SelectItem>
                          <SelectItem value="scorer_scoreboard">{t('scorerTaefeler')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div>
                    <label htmlFor="scorer-unassigned" className={filterLabelClass}>{t('filterUnassigned')}</label>
                    <Select value={unassignedFilter} onValueChange={(v) => setUnassignedFilter(v as VbUnassignedFilter | BbUnassignedFilter)}>
                      <SelectTrigger className="min-h-[44px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('filterAllDuties')}</SelectItem>
                        <SelectItem value="any">{t('filterAnyUnassigned')}</SelectItem>
                        {sportTab === 'volleyball' ? (
                          <>
                            <SelectItem value="scorer">{t('scorer')}</SelectItem>
                            <SelectItem value="scoreboard">{t('scoreboard')}</SelectItem>
                            <SelectItem value="scorer_scoreboard">{t('scorerTaefeler')}</SelectItem>
                          </>
                        ) : (
                          <>
                            <SelectItem value="bb_scorer">{t('bbScorer')}</SelectItem>
                            <SelectItem value="bb_timekeeper">{t('bbTimekeeper')}</SelectItem>
                            <SelectItem value="bb_24s_official">{t('bb24sOfficial')}</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label htmlFor="scorer-search" className={filterLabelClass}>{t('filterSearchAssignee')}</label>
                    <FormInput id="scorer-search" type="text" value={searchAssignee} onChange={(e) => setSearchAssignee(e.target.value)} placeholder={t('searchAssigneePlaceholder')} />
                  </div>
                </div>
                {hasActiveFilters && (
                  <div className="mt-3 flex justify-center">
                    <Button variant="outline" size="sm" onClick={clearFilters} className="rounded-full">{t('clearFilters')}</Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Upcoming games */}
          <div className="mt-6" data-tour="assignment-list">
            {upcomingLoading && <LoadingSpinner />}
            {!upcomingLoading && filteredGames.length === 0 && !showPast && (
              <div className="py-12 text-center text-gray-500 dark:text-gray-400">
                <p>{t('noGames')}</p>
                <p className="mt-1 text-sm">{t('noGamesDescription')}</p>
              </div>
            )}
            {!upcomingLoading && filteredGames.length > 0 && (
              <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">{filteredGames.map((g) => renderScorerRow(g))}</div>
            )}
          </div>

          {/* Past games */}
          <div className="mt-8">
            {!showPast ? (
              <Button variant="outline" onClick={() => { setShowPast(true); setPastVisible(PAST_PAGE_SIZE) }} className="mx-auto rounded-full">
                {t('showOlderGames')}
              </Button>
            ) : (
              <div className="mt-4">
                {pastGateLoading && <LoadingSpinner />}
                {!pastGateLoading && filteredPastGames.length === 0 && (
                  <p className="py-4 text-center text-sm text-gray-400">{t('noGames')}</p>
                )}
                {!pastGateLoading && visiblePastGames.length > 0 && (
                  <>
                    <div className="grid gap-3 opacity-75 lg:grid-cols-2 2xl:grid-cols-3">{visiblePastGames.map((g) => renderScorerRow(g, true))}</div>
                    {pastVisible < filteredPastGames.length && (
                      <div className="mt-4 flex justify-center">
                        <Button variant="outline" onClick={() => setPastVisible((v) => v + PAST_PAGE_SIZE)} className="rounded-full">{t('loadMore')}</Button>
                      </div>
                    )}
                  </>
                )}
                <div className="mt-3 flex justify-center">
                  <Button variant="ghost" size="sm" onClick={() => setShowPast(false)}>{t('hidePast')}</Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'overview' && (
        <div data-tour="open-slots"><TeamOverview games={upcomingGames} members={members} sport={sportTab} /></div>
      )}

    </div>
  )
}

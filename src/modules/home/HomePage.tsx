import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../hooks/useAuth'
import { useTeamPermissions } from '../../hooks/useTeamPermissions'
import { useCollection } from '../../lib/query'
import { useMyAbsences } from '../../hooks/useMyCoveringAbsence'
import { fetchSeasons } from '../../lib/api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useNotificationsContext } from '../../hooks/NotificationsContext'
import { useSportPreference } from '../../hooks/useSportPreference'
import { formatTime, formatWeekday, formatDayMonthZurich, getCurrentSeason, formatSeasonLong, todayLocal, toZurichDateString, formatDateTimeCompactZurich } from '../../utils/dateHelpers'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import TruncatedText from '@/components/TruncatedText'
import { ActivityRow, DateRail, RowChip, RowList, SectionHead, TeamPair } from '@/components/ActivityRow'
import { ROW_HIGHLIGHT, type RowTone } from '@/components/activityRowTokens'
import { asObj, relId, teamCoachIds } from '../../utils/relations'
import TeamChip from '../../components/TeamChip'
import StatusBadge from '../../components/StatusBadge'
import { stripHtml } from '../../utils/stripHtml'
import VolleyballIcon from '../../components/VolleyballIcon'
import BasketballIcon from '../../components/BasketballIcon'
import NotificationPanel from '../../components/NotificationPanel'
import { GuideHelpButton } from '../guide/GuideHelpButton'
import GameDetailModal from '../games/components/GameDetailModal'
import TrainingDetailModal from '../trainings/TrainingDetailModal'
import EventDetailModal from '../events/EventDetailModal'
import { asTeams, getEventDateBadgeParts } from '../events/eventHelpers'
import DutyEventCard from '../events/DutyEventCard'
import AnnouncementRow from './components/AnnouncementRow'
import AnnouncementDetailModal from './components/AnnouncementDetailModal'
import DuesNewsRow from './components/DuesNewsRow'
import { useDuesNews } from '../../hooks/useFinance'
import { useAnnouncements } from '../../hooks/useAnnouncements'
import { useUserVisibleEventIds } from '../../hooks/useUserVisibleEventIds'
import { useUserVisibleGameIds } from '../../hooks/useUserVisibleGameIds'
import ParticipationSummary from '../../components/ParticipationSummary'
import { useBulkParticipationStatuses, useBulkParticipations } from '../../hooks/useBulkParticipationStatuses'
import { useEffectiveSeason } from '../../hooks/useEffectiveSeason'
import { useNow } from '../../hooks/useNow'
import type { Game, Event, Team, Training, Hall, Member, MemberTeam, Notification, Announcement, Participation, Ranking, BaseRecord } from '../../types'
import { ClipboardList, Clock, AlertTriangle, Trophy, Medal, Bell, CalendarDays, LayoutGrid, List, ScrollText, Car, TrafficCone, UserPlus } from 'lucide-react'
import WhistleIcon from '../../components/WhistleIcon'
import { detectCupMatch } from '../spielplanung/gameChipUtils'
import { gameNumberLabel, leagueRailLabel } from '../../utils/leagueShort'
import { useReportPageLoading } from '../../hooks/usePageReady'
import RankingsTable from '../games/components/RankingsTable'
import InstallBanner from '../guide/install/InstallBanner'
import FormFillModal from '../forms/FormFillModal'
import { useFillableForms, type FillableForm } from '../../hooks/useFillableForms'
import YourDuesCard from '../finance/YourDuesCard'
import YourFinesCard from '../fines/YourFinesCard'
import HomePollsCard from '../polls/HomePollsCard'
import HomeCarpoolCard from '../carpool/HomeCarpoolCard'
import FamilyHomeCard from '../family/FamilyHomeCard'
import UpcomingTicker from './components/UpcomingTicker'
import { eventTypeLabelKey } from '../calendar/eventTypeLabel'
import HomeDelegationCard from './components/HomeDelegationCard'
import MyDutyBanner from './components/MyDutyBanner'
import RefereeExpenseNudge from './components/RefereeExpenseNudge'
import { useMyDuties, DUTY_ROLE_LABEL_KEYS, type MyDuty } from '../../hooks/useMyDuties'
import ExtraHallsSuffix from '../../components/ExtraHallsSuffix'

type ExpandedGame = Game & {
  kscw_team?: Team & BaseRecord | string
  hall?: BaseRecord | string
}

type EventExpanded = Event & { teams?: Team[] | string[] }

type TrainingExpanded = Training & {
  team?: Team | string
  hall?: Hall | string
  coach?: Member | string
}

type MemberTeamExpanded = MemberTeam & { team?: Team | string }

/** Amber nudge-banner buttons — the Button scale, the banner's own colour. */
const AMBER_CTA = 'bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400'
const AMBER_GHOST = 'text-amber-700 hover:bg-amber-100 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-900/40 dark:hover:text-amber-200'

// Cut-off for the Spielplanung absences reminder banner (volleyball players).
const ABSENCES_ALERT_DEADLINE = new Date('2026-06-01T23:59:59+02:00').getTime()


export default function HomePage() {
  const { t } = useTranslation('home')
  const { t: tn } = useTranslation('notifications')
  const { t: tf } = useTranslation('forms')
  const { t: tg } = useTranslation('games')

  const { user, isApproved, primarySport, coachTeamIds } = useAuth()
  const { canManageTeam } = useTeamPermissions()
  const { items: fillableForms, isLoading: fillableFormsLoading, refetch: refetchForms } = useFillableForms()
  const [fillItem, setFillItem] = useState<FillableForm | null>(null)
  // IBAN nudge — finance needs every member's up-to-date IBAN. Show a dismissible
  // banner to members who haven't set one; the CTA opens the profile editor.
  // ⚠ Keyed per MEMBER, not per device (migration 348). A household guardian
  // switches between her children on one phone; a device-global key meant
  // dismissing this for one daughter silently hid a real financial prompt for
  // the other two, and the club would never learn their IBAN.
  const ibanNudgeKey = `wiedisync_iban_nudge:${user?.id ?? 'anon'}`
  // Derived from the key, not held in state: a useState initialiser runs once,
  // so switching child would carry the previous one's dismissal, and resyncing
  // from an effect is a cascading render. `bump` re-reads after a dismiss.
  const [ibanNudgeBump, setIbanNudgeBump] = useState(0)
  const ibanNudgeDismissed = useMemo(() => {
    try { return localStorage.getItem(ibanNudgeKey) === '1' } catch { return false }
    // `ibanNudgeBump` is not "unnecessary": localStorage is an external store the
    // linter cannot see, and without it this never re-reads after a dismiss.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ibanNudgeKey, ibanNudgeBump])
  const dismissIbanNudge = () => {
    try { localStorage.setItem(ibanNudgeKey, '1') } catch { /* ignore */ }
    setIbanNudgeBump((n) => n + 1)
  }
  const { sport, setSport } = useSportPreference()
  // Hide sport toggle for users who play only one sport
  const showSportToggle = primarySport === 'both'
  const [selectedGame, setSelectedGame] = useState<ExpandedGame | null>(null)
  // Which section GameDetailModal opens expanded. Set by the referee-expense
  // nudge's "Record now", cleared on close so a plain row click opens collapsed.
  const [gameFocus, setGameFocus] = useState<'refereeExpense' | undefined>(undefined)
  const [selectedTraining, setSelectedTraining] = useState<TrainingExpanded | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<EventExpanded | null>(null)
  const [showAllGames, setShowAllGames] = useState(false)
  const [showAllResults, setShowAllResults] = useState(false)
  const [showCategorized, setShowCategorized] = useState(false)
  const [notifPanelOpen, setNotifPanelOpen] = useState(false)
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null)
  // Evaluated once per mount (lazy initializer) instead of on every render —
  // `Date.now()` is impure during render. The banner is a one-way cut-off, so a
  // per-mount read is equivalent to a per-render one.
  const [beforeAbsencesDeadline] = useState(() => Date.now() < ABSENCES_ALERT_DEADLINE)
  const { notifications: allNotifs, unreadCount, markAsRead, markAllAsRead, deleteNotification, clearAllRead } = useNotificationsContext()
  const { announcements } = useAnnouncements({ limit: 10 })
  // An open bill leads the news feed. It is derived from the member's invoices
  // (not a stored notification), so it clears itself once they pay or mark the
  // bill paid — see DuesNewsRow.
  const duesNews = useDuesNews()

  // Unified news feed: pinned announcements first, then notifications + remaining
  // announcements interleaved by timestamp (desc). Cap at 3 for the homepage card.
  type FeedItem =
    | { kind: 'announcement'; id: string; ts: number; pinned: boolean; record: Announcement }
    | { kind: 'notification'; id: string; ts: number; pinned: false; record: Notification }
  const feedItems = useMemo<FeedItem[]>(() => {
    const annItems: FeedItem[] = announcements.map((a) => ({
      kind: 'announcement',
      id: `a:${a.id}`,
      ts: new Date(a.published_at ?? a.date_created ?? 0).getTime(),
      pinned: !!a.pinned,
      record: a,
    }))
    // Announcement bell notifications are excluded — the announcement itself is
    // already in the feed via useAnnouncements (they'd show twice otherwise).
    const notifItems: FeedItem[] = allNotifs
      .filter((n) => n.type !== 'announcement')
      .map((n) => ({
        kind: 'notification' as const,
        id: `n:${n.id}`,
        ts: new Date(n.date_created ?? n.created ?? 0).getTime(),
        pinned: false as const,
        record: n,
      }))
    const merged = [...annItems, ...notifItems]
    merged.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.ts - a.ts
    })
    return merged.slice(0, 3)
  }, [announcements, allNotifs])

  const today = useMemo(() => todayLocal(), [])

  // Sport filter for Directus queries (filter via kscw_team relation)
  const sportFilter = useMemo((): Record<string, unknown> | null => {
    if (sport === 'vb') return { kscw_team: { sport: { _eq: 'volleyball' } } }
    if (sport === 'bb') return { kscw_team: { sport: { _eq: 'basketball' } } }
    return null
  }, [sport])

  // Fetch user's team memberships (only when logged in)
  const { data: memberTeamsRaw, isLoading: memberTeamsLoading } = useCollection<MemberTeamExpanded>('member_teams', {
    // Gate on the TEAM being active (mirrors useAuth) — not on
    // member_teams.season, which is a create-time stamp uncoupled from the
    // manually-run rollover and so empties `hasTeams` for every plain player
    // between the Jun-1 cutover and the rollover.
    filter: user ? { _and: [{ member: { _eq: user.id } }, { team: { active: { _eq: true } } }] } : { id: { _eq: -1 } },
    fields: ['*', 'team.*'],
    limit: 20,
    enabled: !!user,
  })
  const memberTeams = memberTeamsRaw ?? []

  const userTeamIds = useMemo(() => [...new Set([
    ...memberTeams.map((mt) => relId(mt.team)),
    ...coachTeamIds,
  ].filter(Boolean))], [memberTeams, coachTeamIds])
  const hasTeams = userTeamIds.length > 0

  // The upcoming-ticker scope: everyone's own teams, admins included. It used to
  // widen to every team an admin could see, which turned a "what's coming up for
  // me" strip into a club-wide firehose — five other teams' trainings scrolling
  // past before your own. The club-wide view already exists, in the calendar.
  //
  // The ticker can't query anything until this resolves, so an empty
  // `tickerTeamIds` means either "no teams" or "not known yet" — the ticker needs
  // to tell those apart to decide between rendering nothing and holding its
  // space. That wait is now exactly `memberTeamsLoading`, which the call site
  // below passes as `scopeLoading`.
  const tickerTeamIds = userTeamIds

  // Games this member was invited to as a guest (migration 271) — filed under
  // another team, so the team filter below would drop them.
  const { guestGameIds } = useUserVisibleGameIds(user?.id)

  // Build team filter for games. A guest invitation makes the fixture "mine" for
  // every purpose this page serves, so it is OR-ed in rather than kept in a
  // separate block — the borrowed player sees it in their next-games list exactly
  // where their own team's games are.
  const teamGameFilter = useMemo((): Record<string, unknown> | null => {
    const parts: Record<string, unknown>[] = []
    if (hasTeams) parts.push({ kscw_team: { _in: userTeamIds } })
    if (guestGameIds.length > 0) parts.push({ id: { _in: guestGameIds } })
    if (parts.length === 0) return null
    return parts.length === 1 ? parts[0] : { _or: parts }
  }, [userTeamIds, hasTeams, guestGameIds])

  // "Do I have games of my own?" — the games/results blocks key off this instead of
  // `hasTeams`, so a member with no roster at all (a borrowed junior, a returning
  // player between teams) still gets their invited fixture rather than the club-wide
  // fallback list. Trainings, rankings and team blocks stay on `hasTeams`: an
  // invitation to one game is not a team.
  const hasOwnGames = hasTeams || guestGameIds.length > 0

  // Season-scoped so games/results flip to the new season once its data lands
  // (falls back to the latest season with data in the gap before then).
  const effGameSeason = useEffectiveSeason('games')
  const effRankSeason = useEffectiveSeason('rankings')

  // Rankings season selector (mirrors the Games tab): defaults to the latest
  // season with data; the dropdown also offers the current season as a "coming
  // soon" placeholder until Swiss Volley publishes it. homeRankSeason !== null
  // means the user has actively picked a season — only then does the widget
  // stay visible for an empty season (to show the placeholder).
  const { data: homeRankSeasonsRaw } = useQuery<string[]>({
    queryKey: ['effective-season', 'rankings'],
    queryFn: () => fetchSeasons('rankings'),
    staleTime: 60_000,
  })
  const [homeRankSeason, setHomeRankSeason] = useState<string | null>(null)
  const selectedHomeSeason = homeRankSeason ?? effRankSeason
  const homeRankSeasonOptions = useMemo(() => {
    const set = new Set<string>(homeRankSeasonsRaw ?? [])
    set.add(getCurrentSeason())
    set.add(selectedHomeSeason)
    return [...set].sort().reverse()
  }, [homeRankSeasonsRaw, selectedHomeSeason])

  // Next 5 upcoming games (all) — only fetch when user toggled "show all" or has no teams
  const allGamesFilter = useMemo((): Record<string, unknown> => {
    const conditions: Record<string, unknown>[] = [{ status: { _eq: 'scheduled' } }, { date: { _gte: today } }, { away_team: { _nnull: true } }, { season: { _eq: effGameSeason } }]
    if (sportFilter) conditions.push(sportFilter)
    return { _and: conditions }
  }, [today, sportFilter, effGameSeason])
  const { data: allNextGamesRaw, isLoading: gamesLoading } = useCollection<ExpandedGame>('games', {
    filter: allGamesFilter,
    fields: ['*', 'kscw_team.*', 'kscw_team.coach.members_id', 'kscw_team.team_responsible.members_id', 'hall.*'],
    sort: ['date', 'time'],
    limit: 5,
    enabled: showAllGames || !hasOwnGames,
  })
  const allNextGames = allNextGamesRaw ?? []

  // Next 5 upcoming games (my teams only)
  const myGamesFilter = useMemo((): Record<string, unknown> => {
    const conditions: Record<string, unknown>[] = [{ status: { _eq: 'scheduled' } }, { date: { _gte: today } }, { away_team: { _nnull: true } }, { season: { _eq: effGameSeason } }]
    if (teamGameFilter) conditions.push(teamGameFilter)
    if (sportFilter) conditions.push(sportFilter)
    return { _and: conditions }
  }, [today, teamGameFilter, sportFilter, effGameSeason])
  const { data: myNextGamesRaw } = useCollection<ExpandedGame>('games', {
    filter: myGamesFilter,
    fields: ['*', 'kscw_team.*', 'kscw_team.coach.members_id', 'kscw_team.team_responsible.members_id', 'hall.*'],
    sort: ['date', 'time'],
    limit: 5,
    enabled: hasOwnGames && !showAllGames,
  })
  const myNextGames = myNextGamesRaw ?? []

  // Latest 5 results (all) — only fetch when user toggled "show all" or has no teams
  const allResultsFilter = useMemo((): Record<string, unknown> => {
    const conditions: Record<string, unknown>[] = [{ status: { _eq: 'completed' } }, { date: { _nnull: true } }, { away_team: { _nnull: true } }, { season: { _eq: effGameSeason } }]
    if (sportFilter) conditions.push(sportFilter)
    return { _and: conditions }
  }, [sportFilter, effGameSeason])
  const { data: allLatestResultsRaw, isLoading: resultsLoading } = useCollection<ExpandedGame>('games', {
    filter: allResultsFilter,
    fields: ['*', 'kscw_team.*', 'kscw_team.coach.members_id', 'kscw_team.team_responsible.members_id', 'hall.*'],
    sort: ['-date', '-time'],
    limit: 5,
    enabled: showAllResults || !hasOwnGames,
  })
  const allLatestResults = allLatestResultsRaw ?? []

  // Latest 5 results (my teams only)
  const myResultsFilter = useMemo((): Record<string, unknown> => {
    const conditions: Record<string, unknown>[] = [{ status: { _eq: 'completed' } }, { date: { _nnull: true } }, { away_team: { _nnull: true } }, { season: { _eq: effGameSeason } }]
    if (teamGameFilter) conditions.push(teamGameFilter)
    if (sportFilter) conditions.push(sportFilter)
    return { _and: conditions }
  }, [teamGameFilter, sportFilter, effGameSeason])
  const { data: myLatestResultsRaw } = useCollection<ExpandedGame>('games', {
    filter: myResultsFilter,
    fields: ['*', 'kscw_team.*', 'kscw_team.coach.members_id', 'kscw_team.team_responsible.members_id', 'hall.*'],
    sort: ['-date', '-time'],
    limit: 5,
    enabled: hasOwnGames && !showAllResults,
  })
  const myLatestResults = myLatestResultsRaw ?? []

  // Next trainings for user's teams
  const trainingFilter = useMemo((): Record<string, unknown> | string => {
    if (!hasTeams) return ''
    const conditions: Record<string, unknown>[] = [
      { team: { _in: userTeamIds } },
      { date: { _gte: today } },
      { cancelled: { _eq: false } },
    ]
    if (sport === 'vb') conditions.push({ team: { sport: { _eq: 'volleyball' } } })
    else if (sport === 'bb') conditions.push({ team: { sport: { _eq: 'basketball' } } })
    return { _and: conditions }
  }, [userTeamIds, hasTeams, today, sport])

  const { data: nextTrainingsRaw, isLoading: trainingsLoading } = useCollection<TrainingExpanded>('trainings', {
    filter: trainingFilter as Record<string, unknown> | undefined,
    fields: ['*', 'team.*', 'team.coach.members_id', 'team.team_responsible.members_id', 'hall.*', 'coach.*'],
    sort: ['date', 'start_time'],
    limit: 10,
    enabled: hasTeams,
  })
  const nextTrainings = nextTrainingsRaw ?? []

  // Decide which games/results to show
  const nextGames = hasOwnGames && !showAllGames ? myNextGames : allNextGames
  const latestResults = hasOwnGames && !showAllResults ? myLatestResults : allLatestResults

  // Upcoming events — scope to user's teams + club-wide events.
  // Resolve event IDs via the events_teams junction (single-level filter) rather
  // than walking `events.teams.teams_id` — that path conflicts with the policy's
  // own walk through the same alias and silently returns [] for non-admins.
  // See [feedback_directus_m2m_double_walk] in CLAUDE.md.
  const { teamEventIds, isLoading: eventIdsLoading } = useUserVisibleEventIds(
    userTeamIds,
    undefined,
    hasTeams,
  )
  const eventFilter = useMemo((): Record<string, unknown> => {
    const conditions: Record<string, unknown>[] = [{ end_date: { _gte: today } }]
    if (hasTeams) {
      conditions.push({
        _or: [
          { teams: { _null: true } },
          { id: { _in: teamEventIds.length > 0 ? teamEventIds : [-1] } },
        ],
      })
    } else {
      // User has no teams yet — show only club-wide events
      conditions.push({ teams: { _null: true } })
    }
    return { _and: conditions }
  }, [today, hasTeams, teamEventIds])

  const { data: eventsRaw, isLoading: eventsLoading } = useCollection<EventExpanded>('events', {
    filter: eventFilter,
    fields: ['*', 'teams.teams_id.*', 'teams.teams_id.coach.members_id', 'teams.teams_id.team_responsible.members_id'],
    sort: ['start_date'],
    limit: 10,
    enabled: !eventIdsLoading,
  })
  const events = eventsRaw ?? []

  // Duty games the member is assigned to — surfaced as virtual "duty" appointments
  // (and the yellow banner). NOT sport-filtered: a duty is a personal obligation,
  // so it always shows regardless of the sport toggle.
  const { duties: dutyAppointments } = useMyDuties()

  // Rankings for user's teams — fetch team details for SV/BB IDs, then rankings
  const { data: userTeamDetailsRaw } = useCollection<Team>('teams', {
    filter: hasTeams ? { id: { _in: userTeamIds } } : undefined,
    fields: ['id', 'team_id'],
    enabled: hasTeams,
  })
  const userSvTeamIds = useMemo(() => {
    return (userTeamDetailsRaw ?? []).map(t => t.team_id).filter(Boolean)
  }, [userTeamDetailsRaw])

  // Step 1: fetch only the user's own ranking rows to discover their league names
  const { data: userRankingRowsRaw } = useCollection<Ranking>('rankings', {
    filter: hasTeams && userSvTeamIds.length > 0
      ? { _and: [{ team_id: { _in: userSvTeamIds } }, { season: { _eq: selectedHomeSeason } }] }
      : undefined,
    fields: ['id', 'league', 'team_id'],
    enabled: hasTeams && userSvTeamIds.length > 0,
    all: true,
  })
  const userLeagueNames = useMemo(() => {
    const names = new Set<string>()
    for (const r of userRankingRowsRaw ?? []) {
      if (!/^Group \d+$|Cup|Turnier|Pokal|Final|Runde \d|Spiel \d|Tour \d/i.test(r.league)) {
        names.add(r.league)
      }
    }
    return [...names]
  }, [userRankingRowsRaw])

  // Step 2: fetch full league tables only for the user's leagues
  const { data: leagueRankingsRaw } = useCollection<Ranking>('rankings', {
    filter: userLeagueNames.length > 0
      ? { _and: [{ league: { _in: userLeagueNames } }, { season: { _eq: selectedHomeSeason } }] }
      : undefined,
    sort: ['league', 'rank'],
    fields: ['id', 'league', 'rank', 'team_id', 'team_name', 'points', 'won', 'lost', 'wins_clear', 'wins_narrow', 'defeats_clear', 'defeats_narrow', 'sets_won', 'sets_lost', 'points_won', 'points_lost', 'played', 'season'],
    enabled: userLeagueNames.length > 0,
    all: true,
  })

  const userLeagueGroups = useMemo(() => {
    const grouped = new Map<string, Ranking[]>()
    for (const r of leagueRankingsRaw ?? []) {
      const existing = grouped.get(r.league) ?? []
      existing.push(r)
      grouped.set(r.league, existing)
    }
    return grouped
  }, [leagueRankingsRaw])

  // Bulk-fetch participation statuses for all displayed activities (2 queries total
  // instead of 2 per row) so banners appear together with everything else.
  // Gate on all sub-queries being done so the participation fetch fires once with
  // the complete activity list — prevents partial results overwriting full results.
  const allDataLoaded = !gamesLoading && !resultsLoading && !eventsLoading && !(hasTeams && trainingsLoading)
  const allActivities = useMemo(() => {
    if (!allDataLoaded) return []
    const items: Array<{ id: string; type: 'game' | 'training' | 'event'; date: string }> = []
    for (const g of nextGames) items.push({ id: g.id, type: 'game', date: g.date })
    for (const g of latestResults) items.push({ id: g.id, type: 'game', date: g.date })
    for (const tr of nextTrainings) items.push({ id: tr.id, type: 'training', date: tr.date })
    for (const ev of events) items.push({ id: ev.id, type: 'event', date: toZurichDateString(ev.start_date) })
    return items
  }, [allDataLoaded, nextGames, latestResults, nextTrainings, events])

  const { getStatus: getParticipationStatus, isLoading: bulkPartLoading } = useBulkParticipationStatuses(allActivities)

  // All members' RSVP rows for the visible activities in one query, so the
  // counter bricks paint together with the rest of the page instead of
  // popping in one-by-one after reveal.
  const { getParticipations, isLoading: bulkRsvpLoading } = useBulkParticipations(allActivities)

  // Warms the shared `absences` query key (member-filtered, one key for the whole
  // app) so a detail modal opened from a row already knows whether an absence
  // covers it. Without it the modal's "Absent" line — and the note it pre-fills
  // from that absence — arrive a round-trip AFTER it opens.
  const { isLoading: myAbsencesLoading } = useMyAbsences()

  // Combined loading: wait for all primary data + participation statuses + RSVP counters
  // For logged-in users, we need member_teams + all dependent queries + participation statuses
  // For guests, just the public queries (games, results, events)
  //
  // ⚠ `eventIdsLoading` is load-bearing and easy to leave out: the events query
  // is gated `enabled: !eventIdsLoading`, so while the visible-event IDs are
  // still resolving the events query has not STARTED and `eventsLoading` is
  // false. Omitting it let the whole page reveal with the events section still
  // empty, which then popped in a moment later — the gate has to cover the
  // query that gates the query.
  //
  // `memberTeamsLoading` also feeds the ticker's team scope, so revealing before
  // it lands showed a ticker that then re-scoped itself.
  const isInitialLoading = memberTeamsLoading || gamesLoading
    || resultsLoading || eventIdsLoading || eventsLoading || (hasTeams && trainingsLoading)
    || bulkPartLoading || bulkRsvpLoading || myAbsencesLoading

  // Report loading to the app-level boot gate (Layout) instead of rendering our
  // own spinner. While true, Layout's single fullscreen spinner masks the chrome
  // + this content, so everything reveals together. See usePageReady.tsx.
  useReportPageLoading(isInitialLoading)

  return (
    <div className="min-w-0">
      <InstallBanner />
      {isInitialLoading ? null : (<>

      {/* Hero with sport icons flanking logo */}
      <div className="flex flex-col items-center pb-6 pt-2 text-center">
        <div className="flex items-center gap-4">
          {showSportToggle && (
            <button
              onClick={() => setSport('vb')}
              className={`rounded-full p-2 transition-all ${
                sport === 'vb' || sport === 'all'
                  ? 'scale-110'
                  : 'opacity-30 hover:opacity-50'
              }`}
              aria-label="Volleyball"
            >
              <VolleyballIcon className="h-9 w-9 sm:h-10 sm:w-10" filled />
            </button>
          )}
          {showSportToggle ? (
            <button
              onClick={() => setSport('all')}
              className={`rounded-xl p-1 transition-opacity ${sport === 'all' ? '' : 'opacity-60 hover:opacity-80'}`}
              aria-label="Show all sports"
            >
              <img
                src="/wiedisync_logo.svg"
                alt="KSC Wiedikon"
                className="h-20 w-auto sm:h-24"
              />
            </button>
          ) : (
            <img
              src="/wiedisync_logo.svg"
              alt="KSC Wiedikon"
              className="h-20 w-auto sm:h-24"
            />
          )}
          {showSportToggle && (
            <button
              onClick={() => setSport('bb')}
              className={`rounded-full p-2 transition-all ${
                sport === 'bb' || sport === 'all'
                  ? 'scale-110'
                  : 'opacity-30 hover:opacity-50'
              }`}
              aria-label="Basketball"
            >
              <BasketballIcon className="h-9 w-9 sm:h-10 sm:w-10" filled />
            </button>
          )}
        </div>
        <div className="relative mt-3 flex items-center justify-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            KSC Wiedikon
          </h1>
          <GuideHelpButton />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('subtitle')}
        </p>
      </div>

      {/* Upcoming ticker — next 7 days across the user's own teams, admins
          included: games, trainings, events, closures, duties, birthdays. */}
      {user && isApproved && (tickerTeamIds.length > 0 || memberTeamsLoading) && (
        <UpcomingTicker teamIds={tickerTeamIds} scopeLoading={memberTeamsLoading} />
      )}

      {/* Pending duty-delegation requests — accept/decline without leaving home.
          Renders null when the user has no incoming requests. */}
      {user && isApproved && <HomeDelegationCard />}

      {/* Upcoming duty reminder (1 week → game end) + 60' emergency button.
          Renders null when the member has no upcoming duties. */}
      {user && isApproved && <MyDutyBanner />}

      {/* Referee expenses not recorded — coaches/TRs, volleyball home games that
          ended in the last two weeks. Renders null when there is nothing missing. */}
      {user && isApproved && (
        <RefereeExpenseNudge onOpenGame={(g) => { setGameFocus('refereeExpense'); setSelectedGame(g) }} />
      )}

      {/* Spielplanung absences reminder — volleyball players, until 2026-06-01 */}
      {user && isApproved && (primarySport === 'volleyball' || primarySport === 'both') && beforeAbsencesDeadline && (
        <div className="mb-6 lg:flex lg:flex-col lg:items-center">
          <div className="w-full rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-card lg:max-w-2xl dark:border-amber-700/60 dark:bg-amber-950/40">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  {t('absencesAlertTitle')}
                </h3>
                <p className="mt-1 text-sm text-amber-800 dark:text-amber-200/90">
                  {t('absencesAlertBody')}
                </p>
                <Button asChild className={cn('mt-2', AMBER_CTA)}>
                  <Link to="/absences">{t('absencesAlertCta')}</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* IBAN nudge — finance needs everyone's up-to-date IBAN for reimbursements */}
      {user && isApproved && (!user.iban || user.iban_confirmed === false) && !ibanNudgeDismissed && (
        <div className="mb-6 lg:flex lg:flex-col lg:items-center">
          <div className="w-full rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-card lg:max-w-2xl dark:border-amber-700/60 dark:bg-amber-950/40">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  {user.iban ? t('ibanConfirmNudgeTitle') : t('ibanNudgeTitle')}
                </h3>
                <p className="mt-1 text-sm text-amber-800 dark:text-amber-200/90">
                  {user.iban ? t('ibanConfirmNudgeBody') : t('ibanNudgeBody')}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button asChild className={AMBER_CTA}>
                    <Link to="/finance/dues">{user.iban ? t('ibanConfirmNudgeCta') : t('ibanNudgeCta')}</Link>
                  </Button>
                  <Button variant="ghost" onClick={dismissIbanNudge} className={AMBER_GHOST}>
                    {t('ibanNudgeDismiss')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* News section — unified feed: open bill + announcements + notifications */}
      {user && isApproved && (feedItems.length > 0 || duesNews) && (
        <div className="mb-6 lg:flex lg:flex-col lg:items-center">
          <SectionHeader
            title={tn('news')}
            linkTo="/news"
            linkLabel={tn('showAll')}
            className="w-full lg:max-w-2xl"
          />
          <div className="w-full overflow-hidden rounded-2xl border border-hairline bg-card shadow-card lg:max-w-2xl">
            {duesNews && <DuesNewsRow news={duesNews} />}
            {feedItems.map((item) =>
              item.kind === 'announcement' ? (
                <AnnouncementRow
                  key={item.id}
                  announcement={item.record}
                  onClick={() => setSelectedAnnouncement(item.record)}
                />
              ) : (
                <NewsRow key={item.id} notification={item.record} onMarkAsRead={markAsRead} />
              ),
            )}
          </div>
        </div>
      )}

      {selectedAnnouncement && (
        <AnnouncementDetailModal
          announcement={selectedAnnouncement}
          onClose={() => setSelectedAnnouncement(null)}
        />
      )}

      {/* Family view entry — main accounts with linked members only (null otherwise). */}
      {user && <FamilyHomeCard />}

      {/* Active surveys — placed right under the news feed so polls (which
          otherwise live only on the team page) are easy to find. Renders null
          when the user's teams have no open polls. */}
      {user && isApproved && hasTeams && (
        <HomePollsCard teamIds={userTeamIds} canManage={canManageTeam} />
      )}

      {/* Car pooling — upcoming activities with a rides board switched on that
          concern this member (null when there are none). Tapping a row opens
          the board; the same banner also sits in each activity's modal. */}
      {user && isApproved && <HomeCarpoolCard />}

      {/* Forms to fill — surfaced here because the /forms nav item is author-only.
          ⚠ Held until the hook has the member's SUBMISSIONS too, not just the
          open forms: until then every row reads "Fill in" and opens a blank
          create even for a form already answered. Nothing renders meanwhile —
          this card is an optional insert above YourDuesCard, so a placeholder
          would cause the very layout shift the gate exists to avoid. */}
      {user && isApproved && !fillableFormsLoading && fillableForms.length > 0 && (
        <div className="mb-6 lg:flex lg:flex-col lg:items-center">
          <div className="w-full overflow-hidden rounded-2xl border border-blue-200 bg-blue-50/60 shadow-card lg:max-w-2xl dark:border-blue-800/50 dark:bg-blue-900/20">
            <div className="flex items-center gap-2 border-b border-blue-200 px-4 py-2.5 dark:border-blue-800/50">
              <ScrollText className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-semibold text-blue-900 dark:text-blue-100">{tf('formsToFill')}</h2>
            </div>
            <ul className="divide-y divide-blue-100 dark:divide-blue-800/40">
              {fillableForms.map((item) => (
                <li key={item.form.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <TruncatedText as="p" text={item.form.title} className="text-sm font-medium text-foreground" />
                    {item.form.closes_at && (
                      <p className="text-xs text-muted-foreground">{tf('closesAt')}: {formatDateTimeCompactZurich(item.form.closes_at)}</p>
                    )}
                  </div>
                  <Button onClick={() => setFillItem(item)} className="shrink-0">
                    {item.submission ? tf('edit') : tf('fill')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {fillItem && (
        <FormFillModal
          open={!!fillItem}
          form={fillItem.form}
          existing={fillItem.submission}
          onSubmitted={() => { setFillItem(null); refetchForms() }}
          onCancel={() => setFillItem(null)}
        />
      )}

      {/* Your dues — member's open invoices (renders null when nothing is open) */}
      {user && isApproved && <YourDuesCard />}

      {/* Open fines — own + the team fines the Teamkasse owes (null when clean) */}
      {user && isApproved && <YourFinesCard />}

      {/* View toggle: unified appointments vs categorized sections */}
      {user && isApproved && (
        <div className="mb-4 flex justify-end lg:justify-center">
          <Button
            variant="ghost"
            onClick={() => setShowCategorized((v) => !v)}
            icon={showCategorized ? <List /> : <LayoutGrid />}
            className="gap-1.5 px-3 font-normal text-muted-foreground"
          >
            {showCategorized ? t('showAppointments') : t('showCategories')}
          </Button>
        </div>
      )}

      {/* Unified "My next appointments" view (default for logged-in users) */}
      {user && isApproved && !showCategorized && (
        <div className="lg:flex lg:items-start lg:justify-center lg:gap-8">
          {/* Takes what the rankings column leaves, capped like the other home cards. */}
          <div className="min-w-0 lg:max-w-2xl lg:flex-1">
            <NextAppointments
              games={nextGames}
              trainings={nextTrainings}
              events={events}
              duties={dutyAppointments}
              onGameClick={setSelectedGame}
              onTrainingClick={setSelectedTraining}
              onEventClick={setSelectedEvent}
              getParticipationStatus={getParticipationStatus}
              getParticipations={getParticipations}
            />
          </div>
          {hasTeams && userSvTeamIds.length > 0 && (userLeagueGroups.size > 0 || homeRankSeason !== null) && (
            <div className="hidden min-w-0 lg:block">
              <SectionHead
                as="h2"
                title={t('rankings')}
                className="mb-3"
                right={
                  <Select value={selectedHomeSeason} onValueChange={setHomeRankSeason}>
                    <SelectTrigger className="h-9 w-[140px]" aria-label={tg('season')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {homeRankSeasonOptions.map((s) => (
                        <SelectItem key={s} value={s}>{formatSeasonLong(s)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
              {userLeagueGroups.size > 0 ? (
                <div className="space-y-4">
                  {[...userLeagueGroups.entries()].map(([league, rows]) => (
                    <RankingsTable key={league} league={league} rankings={rows} compact />
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-input px-6 py-10 text-center">
                  <Trophy className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm font-medium text-foreground/85">{formatSeasonLong(selectedHomeSeason)}</p>
                  <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">{tg('rankingsUpcoming')}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Categorized view: trainings, events, games in columns */}
      {/* Default for guests, toggle for logged-in users */}
      {showCategorized && (
        <HomeSections
          trainingsSection={hasTeams && nextTrainings.length > 0 ? (
            <div className="min-w-0">
              <SectionHeader title={t('nextTrainings')} linkTo="/trainings" linkLabel={t('allTrainings')} />
              <RowList className={LIST_SHELL}>
                {nextTrainings.map((tr) => (
                  <CompactTrainingRow key={tr.id} training={tr} onClick={() => setSelectedTraining(tr)} participationStatus={getParticipationStatus('training', tr.id)} participations={getParticipations('training', tr.id)} />
                ))}
              </RowList>
            </div>
          ) : null}
          trainingsDate={nextTrainings[0]?.date}
          eventsSection={(events.length > 0 || dutyAppointments.length > 0) ? (
            <div className="min-w-0">
              <SectionHeader title={t('events')} linkTo="/events" linkLabel={t('allEvents')} />
              <div className="space-y-3">
                {dutyAppointments.map((d) => (
                  <DutyEventCard key={`duty-${d.game.id}-${d.role}`} duty={d} />
                ))}
                {events.length > 0 && (
                  <RowList className={LIST_SHELL}>
                    {events.map((event) => (
                      <EventRow key={event.id} event={event} onClick={() => setSelectedEvent(event)} participationStatus={getParticipationStatus('event', event.id)} participations={getParticipations('event', event.id)} />
                    ))}
                  </RowList>
                )}
              </div>
            </div>
          ) : null}
          eventsDate={events[0]?.start_date?.split(' ')[0] ?? dutyAppointments[0]?.game.date}
          gamesSection={
            <div className="min-w-0 space-y-6">
              {latestResults.length > 0 && (
                <div>
                  <SectionHeader
                    title={t('latestResults')}
                    linkTo="/games"
                    linkLabel={t('allResults')}
                    filterToggle={hasOwnGames ? {
                      active: !showAllResults,
                      label: t('myTeams'),
                      onToggle: () => setShowAllResults((v) => !v),
                    } : undefined}
                  />
                  <RowList className={LIST_SHELL}>
                    {latestResults.map((g) => (
                      <CompactGameRow key={g.id} game={g} showScore onClick={() => setSelectedGame(g)} participationStatus={getParticipationStatus('game', g.id)} participations={getParticipations('game', g.id)} />
                    ))}
                  </RowList>
                </div>
              )}
              {/* When trainings column is present, keep next games stacked here */}
              {hasOwnGames && nextGames.length > 0 && (
                <div>
                  <SectionHeader
                    title={t('nextGames')}
                    linkTo="/games"
                    linkLabel={t('allGames')}
                    filterToggle={{
                      active: !showAllGames,
                      label: t('myTeams'),
                      onToggle: () => setShowAllGames((v) => !v),
                    }}
                  />
                  <RowList className={LIST_SHELL}>
                    {nextGames.map((g) => (
                      <CompactGameRow key={g.id} game={g} showScore={false} onClick={() => setSelectedGame(g)} participationStatus={getParticipationStatus('game', g.id)} participations={getParticipations('game', g.id)} />
                    ))}
                  </RowList>
                </div>
              )}
            </div>
          }
          gamesDate={latestResults[0]?.date ?? nextGames[0]?.date}
          nextGamesSection={!hasOwnGames && nextGames.length > 0 ? (
            <div className="min-w-0">
              <SectionHeader title={t('nextGames')} linkTo="/games" linkLabel={t('allGames')} />
              <RowList className={LIST_SHELL}>
                {nextGames.map((g) => (
                  <CompactGameRow key={g.id} game={g} showScore={false} onClick={() => setSelectedGame(g)} participationStatus={getParticipationStatus('game', g.id)} participations={getParticipations('game', g.id)} />
                ))}
              </RowList>
            </div>
          ) : undefined}
          nextGamesDate={!hasOwnGames ? nextGames[0]?.date : undefined}
        />
      )}

      <GameDetailModal
        game={selectedGame}
        focus={gameFocus}
        onClose={() => { setSelectedGame(null); setGameFocus(undefined) }}
        participations={selectedGame ? getParticipations('game', selectedGame.id) : undefined}
      />
      {/* The page does not reveal until `bulkRsvpLoading` clears (see
          `isInitialLoading`), so by the time a row is clickable these lists are
          complete — the modals open with the counters AND the viewer's own RSVP
          already painted instead of querying again on open. */}
      <TrainingDetailModal
        training={selectedTraining}
        onClose={() => setSelectedTraining(null)}
        participations={selectedTraining ? getParticipations('training', selectedTraining.id) : undefined}
      />
      <EventDetailModal
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        participations={selectedEvent ? getParticipations('event', selectedEvent.id) : undefined}
      />

      {notifPanelOpen && (
        <NotificationPanel
          notifications={allNotifs}
          unreadCount={unreadCount}
          onMarkAsRead={markAsRead}
          onMarkAllAsRead={markAllAsRead}
          onDelete={deleteNotification}
          onClearRead={clearAllRead}
          onClose={() => setNotifPanelOpen(false)}
        />
      )}
      </>)}
    </div>
  )
}

/* ---------- Sub-components ---------- */

/** Home section heading on a rule (shared SectionHead): title left, the
 *  "My teams" filter and the "All …" link in the right-hand shrink-0 cluster. */
function SectionHeader({
  title,
  linkTo,
  linkLabel,
  filterToggle,
  onLinkClick,
  className,
}: {
  title: string
  linkTo: string
  linkLabel: string
  filterToggle?: { active: boolean; label: string; onToggle: () => void }
  onLinkClick?: (e: React.MouseEvent) => void
  className?: string
}) {
  return (
    <SectionHead
      as="h2"
      title={title}
      className={cn('mb-2', className)}
      right={
        <>
          {filterToggle && (
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={filterToggle.active}
              onClick={filterToggle.onToggle}
              className={cn(
                'rounded-full px-2.5',
                filterToggle.active
                  ? 'border border-transparent bg-selected text-selected-foreground hover:bg-selected/90 hover:text-selected-foreground'
                  : 'border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {filterToggle.label}
            </Button>
          )}
          <Button asChild size="sm" variant="link" className="px-1 text-primary dark:text-brand-300">
            <Link to={linkTo} onClick={onLinkClick}>{linkLabel} →</Link>
          </Button>
        </>
      }
    />
  )
}

/** Card shell the home lists sit in — the page keeps its card hierarchy; the
 *  rows inside are flat (RowList owns the hairlines). */
const LIST_SHELL = 'overflow-hidden rounded-2xl border border-hairline bg-card shadow-card p-1'

/** RSVP status → row tone (stripe + rail text). No answer = neutral. */
const RSVP_TONE: Record<string, RowTone> = {
  confirmed: 'green',
  tentative: 'amber',
  declined: 'red',
  waitlisted: 'violet',
  absent: 'gray',
}
function rsvpTone(status: string | undefined): RowTone {
  return (status && RSVP_TONE[status]) || 'gray'
}

/** Which side of a fixture is KSCW — bold in TeamPair. */
function kscwSide(game: ExpandedGame): 'home' | 'away' {
  return game.type === 'away' ? 'away' : 'home'
}

/** Standard rail for a dated activity: weekday / dd.mm / time. The year is
 *  left out on purpose — these lists only look a few weeks ahead or back,
 *  and dd.mm.yyyy does not fit the one rail width. */
function dayRail(date: string, time: string, tone: RowTone, extra?: React.ReactNode, matchNo?: string) {
  return (
    <DateRail
      eyebrow={formatWeekday(date)}
      main={formatDayMonthZurich(date)}
      sub={time || undefined}
      extra={extra}
      matchNo={matchNo || undefined}
      tone={tone}
    />
  )
}

/** "– dd.mm" under the rail for an event that runs over several days. */
function eventEndExtra(ev: EventExpanded) {
  return getEventDateBadgeParts(ev.start_date, ev.end_date).isMultiDay && ev.end_date
    ? `– ${formatDayMonthZurich(ev.end_date)}`
    : undefined
}

/** RSVP counters, in the row body under the title. */
function RowCounters(props: React.ComponentProps<typeof ParticipationSummary>) {
  return (
    <div className="mt-1.5 empty:hidden">
      <ParticipationSummary {...props} />
    </div>
  )
}

const newsTypeIcons: Record<string, React.ReactNode> = {
  activity_change: <ClipboardList className="h-4 w-4" />,
  upcoming_activity: <Clock className="h-4 w-4" />,
  deadline_reminder: <AlertTriangle className="h-4 w-4" />,
  result_available: <Trophy className="h-4 w-4" />,
  carpool_update: <Car className="h-4 w-4" />,
  team_added: <UserPlus className="h-4 w-4" />,
}

function getNotificationPath(n: Notification): string {
  if (n.type === 'duty_delegation_request' || n.activity_type === 'scorer_duty') return '/scorer'
  if (n.type === 'carpool_update' && n.activity_id && ['game', 'training', 'event'].includes(n.activity_type)) {
    return `/carpool/${n.activity_type}/${n.activity_id}`
  }
  // activity_id is the team ID; /teams/:teamSlug resolves by name (body.team).
  if (n.type === 'team_added') {
    try {
      const team = n.body ? (JSON.parse(n.body) as { team?: unknown }).team : null
      if (typeof team === 'string' && team) return `/teams/${encodeURIComponent(team)}`
    } catch { /* malformed body */ }
    return '/teams'
  }
  switch (n.activity_type) {
    case 'game': return '/games'
    case 'training': return '/trainings'
    case 'event': return '/events'
    default: return '/'
  }
}

function NewsRow({ notification, onMarkAsRead }: { notification: Notification; onMarkAsRead: (id: string) => void }) {
  const { t } = useTranslation('notifications')
  const navigate = useNavigate()
  const message = (() => {
    try {
      const data = notification.body ? JSON.parse(notification.body) : {}
      const raw = String(t(notification.title, data))
      // Strip trailing " @ " when hall is empty, and strip :SS seconds from legacy times
      return raw.replace(/\s*@\s*$/, '').replace(/(\d{2}:\d{2}):\d{2}/g, '$1')
    } catch {
      // Legacy notifications with plain text body
      return notification.title.replace(/(\d{2}:\d{2}):\d{2}/g, '$1')
    }
  })()

  // Ticking clock (1 min) instead of a render-time Date.now(): the label now
  // ages on its own ("Just now" → "2 minutes ago") rather than only when the
  // feed happens to re-render for some other reason.
  const now = useNow()
  const timeAgo = (() => {
    const diff = now - new Date(notification.created ?? notification.date_created ?? '').getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return String(t('justNow'))
    if (minutes < 60) return String(t('minutesAgo', { count: minutes }))
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return String(t('hoursAgo', { count: hours }))
    const days = Math.floor(hours / 24)
    return String(t('daysAgo', { count: days }))
  })()

  return (
    <div
      className="flex cursor-pointer items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-b-0 hover:bg-muted active:bg-muted"
      onClick={() => {
        if (!notification.read) onMarkAsRead(notification.id)
        navigate(getNotificationPath(notification))
      }}
    >
      <span className="shrink-0 text-muted-foreground">{newsTypeIcons[notification.type] ?? <Bell className="h-4 w-4" />}</span>
      <TruncatedText text={message} as="p" className="flex-1 text-sm text-foreground" />
      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo}</span>
    </div>
  )
}

function CompactGameRow({ game, showScore, onClick, participationStatus, participations }: { game: ExpandedGame; showScore: boolean; onClick?: () => void; participationStatus?: string; participations?: Participation[] }) {
  const { user } = useAuth()
  const homeWon = Number(game.home_score) > Number(game.away_score)
  const awayWon = Number(game.away_score) > Number(game.home_score)
  const kscwWon = game.type === 'home' ? homeWon : awayWon
  const kscwLost = game.type === 'home' ? awayWon : homeWon
  const tone = user ? rsvpTone(participationStatus) : 'gray'

  // KSCW line coloured by the outcome, opponent neutral.
  const scoreClass = (side: 'home' | 'away') => game.type === side
    ? `font-bold ${kscwWon ? 'text-green-600 dark:text-green-400' : kscwLost ? 'text-red-500 dark:text-red-400' : 'text-muted-foreground'}`
    : 'font-medium text-muted-foreground'

  const isBasketball = asObj<Team & BaseRecord>(game.kscw_team)?.sport === 'basketball' || game.source === 'basketplan'

  return (
    <ActivityRow
      rail={dayRail(game.date, game.time ? formatTime(game.time) : '', tone, leagueRailLabel(game.league) || undefined, gameNumberLabel(game.game_id))}
      tone={tone}
      onClick={onClick}
      title={<TeamPair home={game.home_team} away={game.away_team} emphasis={kscwSide(game)} />}
      status={
        <>
          {/* Vertical score, one line per team — level with the two names. */}
          {showScore && game.status === 'completed' && (
            <span className="text-right font-mono text-sm leading-snug tabular-nums">
              <span className={`block ${scoreClass('home')}`}>{game.home_score}</span>
              <span className={`block ${scoreClass('away')}`}>{game.away_score}</span>
            </span>
          )}
          {isBasketball
            ? <BasketballIcon className="h-5 w-5 shrink-0" filled />
            : <VolleyballIcon className="h-5 w-5 shrink-0" filled />}
        </>
      }
    >
      {game.status === 'scheduled' && (
        <RowCounters activityType="game" activityId={game.id} bars coachMemberIds={teamCoachIds(asObj<Team>(game.kscw_team))} participations={participations} />
      )}
    </ActivityRow>
  )
}

function CompactTrainingRow({ training, onClick, participationStatus, participations }: { training: TrainingExpanded; onClick?: () => void; participationStatus?: string; participations?: Participation[] }) {
  const { user } = useAuth()
  const team = asObj<Team>(training.team)
  const hall = asObj<Hall>(training.hall)
  const tone = user ? rsvpTone(participationStatus) : 'gray'

  return (
    <ActivityRow
      // End time as a rail sub-line: "18:00–20:00" does not fit the rail's width.
      rail={dayRail(
        training.date,
        training.start_time ? formatTime(training.start_time) : '',
        tone,
        training.end_time ? `– ${formatTime(training.end_time)}` : undefined,
      )}
      tone={tone}
      onClick={onClick}
      title={team ? <TeamChip team={team.name} size="sm" /> : null}
    >
      {hall && (
        <TruncatedText text={hall.name} className="mt-1 text-sm text-foreground/85">
          {hall.name}<ExtraHallsSuffix extraHalls={training.extra_halls} />
        </TruncatedText>
      )}
      <RowCounters activityType="training" activityId={training.id} bars coachMemberIds={teamCoachIds(team)} participations={participations} />
    </ActivityRow>
  )
}

/** Game icon: whistle for league play, cup for cup competitions
 *  (gold → trophy, silver → medal), matching the GameChip semantics. */
function gameIcon(game: ExpandedGame, className: string) {
  const cup = detectCupMatch(game.league)
  if (cup === 'gold') return <Trophy className={className} />
  if (cup === 'silver') return <Medal className={className} />
  return <WhistleIcon className={className} />
}

type AppointmentItem =
  | { type: 'game'; date: string; data: ExpandedGame }
  | { type: 'training'; date: string; data: TrainingExpanded }
  | { type: 'event'; date: string; data: EventExpanded }
  | { type: 'duty'; date: string; data: ExpandedGame; roleLabel: string }

/** One row of "My next appointments" — games, trainings, events and duties
 *  on the same rail, rendered once and reflowed at every width. */
function AppointmentRow({ appointment, onClick, participationStatus, participations }: {
  appointment: AppointmentItem
  onClick?: () => void
  participationStatus?: string
  participations?: Participation[]
}) {
  const { user } = useAuth()
  const { t: tCal } = useTranslation('calendar')
  const tone: RowTone = appointment.type === 'duty' ? 'amber' : user ? rsvpTone(participationStatus) : 'gray'
  const iconClass = 'h-4 w-4 shrink-0 text-muted-foreground/80'
  const titleClass = 'break-words text-sm font-semibold leading-snug text-foreground sm:text-[15px]'

  let time = ''
  let railExtra: React.ReactNode
  let railMatchNo: string | undefined
  let title: React.ReactNode
  let chips: React.ReactNode
  let body: React.ReactNode
  let icon: React.ReactNode
  let coachIds: string[] | undefined

  if (appointment.type === 'game' || appointment.type === 'duty') {
    const g = appointment.data
    if (g.time) time = formatTime(g.time)
    railExtra = leagueRailLabel(g.league) || undefined
    railMatchNo = gameNumberLabel(g.game_id)
    title = <TeamPair home={g.home_team} away={g.away_team} emphasis={kscwSide(g)} />
    if (appointment.type === 'game') {
      coachIds = teamCoachIds(asObj<Team>(g.kscw_team))
      // Games are the headline of the list: gold icon (+ gold wash below).
      icon = gameIcon(g, 'h-4 w-4 shrink-0 text-gold-600 dark:text-gold-400')
    } else {
      chips = <RowChip tone="amber">{appointment.roleLabel}</RowChip>
      icon = <ClipboardList className={iconClass} />
    }
  } else if (appointment.type === 'training') {
    const tr = appointment.data
    const team = asObj<Team>(tr.team)
    const hall = asObj<Hall>(tr.hall)
    if (tr.start_time) time = formatTime(tr.start_time)
    coachIds = teamCoachIds(team)
    // Lead with the kind of activity: a bare "H3" reads like a label, not a training.
    title = <p className={titleClass}>{tCal('typeTraining')}{team ? ` ${team.name}` : ''}</p>
    body = hall && (
      <TruncatedText text={hall.name} className="mt-0.5 text-xs text-muted-foreground">
        {hall.name}<ExtraHallsSuffix extraHalls={tr.extra_halls} />
      </TruncatedText>
    )
    icon = <TrafficCone className={iconClass} />
  } else {
    const ev = appointment.data
    // An event title is free text and says nothing about what KIND of thing it
    // is — a friendly entered as "VBC Limmattal - D4" reads as a league fixture
    // next to the real ones. Lead with the translated type as a chip.
    const typeKey = eventTypeLabelKey(ev.event_type)
    if (!ev.all_day && ev.start_date) time = formatTime(ev.start_date)
    railExtra = eventEndExtra(ev)
    title = <p className={titleClass}>{ev.title}</p>
    if (typeKey) chips = <RowChip tone="violet">{tCal(typeKey)}</RowChip>
    icon = <CalendarDays className={iconClass} />
  }

  return (
    <ActivityRow
      rail={dayRail(appointment.date, time, tone, railExtra, railMatchNo)}
      tone={tone}
      onClick={onClick}
      title={title}
      status={icon}
      chips={chips}
      // A duty is "this needs you" — highlighted, and the role chip says why.
      // A game gets a faint gold wash — no extra line next to the RSVP stripe.
      highlight={appointment.type === 'duty' ? ROW_HIGHLIGHT.amber
        : appointment.type === 'game' ? 'rounded-md bg-gold-50/70 dark:bg-gold-400/[0.06]'
        : undefined}
    >
      {body}
      {appointment.type !== 'duty' && (
        <RowCounters activityType={appointment.type} activityId={appointment.data.id} bars coachMemberIds={coachIds} participations={participations} />
      )}
    </ActivityRow>
  )
}

/** Unified "My next appointments" — merges games, trainings, events sorted by date, shows next 5 */
function NextAppointments({
  games,
  trainings,
  events,
  duties,
  onGameClick,
  onTrainingClick,
  onEventClick,
  getParticipationStatus,
  getParticipations,
}: {
  games: ExpandedGame[]
  trainings: TrainingExpanded[]
  events: EventExpanded[]
  duties: MyDuty[]
  onGameClick: (g: ExpandedGame) => void
  onTrainingClick: (t: TrainingExpanded) => void
  onEventClick: (e: EventExpanded) => void
  getParticipationStatus: (type: 'game' | 'training' | 'event', id: string) => string | undefined
  getParticipations: (type: 'game' | 'training' | 'event', id: string) => Participation[]
}) {
  const { t } = useTranslation('home')
  const { t: tScorer } = useTranslation('scorer')
  const [visibleCount, setVisibleCount] = useState(10)

  const allAppointments = useMemo(() => {
    const items: AppointmentItem[] = []
    for (const g of games) {
      if (g.date) items.push({ type: 'game', date: g.date, data: g })
    }
    for (const tr of trainings) {
      if (tr.date) items.push({ type: 'training', date: tr.date, data: tr })
    }
    for (const ev of events) {
      if (ev.start_date) items.push({ type: 'event', date: toZurichDateString(ev.start_date), data: ev })
    }
    for (const d of duties) {
      const g = d.game as ExpandedGame
      if (g.date) items.push({
        type: 'duty',
        date: g.date,
        data: g,
        roleLabel: tScorer(DUTY_ROLE_LABEL_KEYS[d.role] ?? 'scorer'),
      })
    }
    items.sort((a, b) => a.date.localeCompare(b.date))
    return items
  }, [games, trainings, events, duties, tScorer])

  // Show the first N date-sorted appointments. A duty is date-sorted inline like
  // everything else, but if it falls beyond the cap (further out than every
  // visible game/training/event) it's appended at the bottom so it's never
  // hidden. "Show more" still reveals the remaining non-duty items.
  const visible = allAppointments.slice(0, visibleCount)
  const overflow = allAppointments.slice(visibleCount)
  const overflowDuties = overflow.filter((a) => a.type === 'duty')
  const appointments = [...visible, ...overflowDuties]
  const hasMore = overflow.some((a) => a.type !== 'duty')

  if (appointments.length === 0) return null

  const renderOnClick = (apt: AppointmentItem) => {
    if (apt.type === 'game' || apt.type === 'duty') return () => onGameClick(apt.data)
    if (apt.type === 'training') return () => onTrainingClick(apt.data)
    return () => onEventClick(apt.data)
  }

  // ONE list at every width. This used to be a desktop <table> plus a mobile
  // list, both mounted and CSS-hidden — two ParticipationSummary per activity
  // (see useParticipationCounts on why duplicate mounts cost). The rows reflow
  // instead; participations stay prefetched as before.
  return (
    <div className="mb-6">
      <SectionHead as="h2" title={t('myNextAppointments')} className="mb-2" />
      <div className={LIST_SHELL}>
        <RowList>
          {appointments.map((apt) => (
            <AppointmentRow
              key={`${apt.type}-${apt.data.id}`}
              appointment={apt}
              onClick={renderOnClick(apt)}
              participationStatus={apt.type === 'duty' ? undefined : getParticipationStatus(apt.type, apt.data.id)}
              participations={apt.type === 'duty' ? undefined : getParticipations(apt.type, apt.data.id)}
            />
          ))}
        </RowList>
      </div>

      {hasMore && (
        <Button variant="ghost" onClick={() => setVisibleCount((v) => v + 10)} className="mt-2 w-full text-muted-foreground">
          {t('showMore')}
        </Button>
      )}
    </div>
  )
}

/** Mobile ordering slots — static strings so Tailwind generates them. */
const SECTION_ORDER = ['order-1', 'order-2', 'order-3', 'order-4']

/** Renders 3 sections in 1/3 columns on desktop, ordered by closest date on mobile */
function HomeSections({
  trainingsSection,
  trainingsDate,
  eventsSection,
  eventsDate,
  gamesSection,
  gamesDate,
  nextGamesSection,
  nextGamesDate,
}: {
  trainingsSection: React.ReactNode
  trainingsDate?: string
  eventsSection: React.ReactNode
  eventsDate?: string
  gamesSection: React.ReactNode
  gamesDate?: string
  nextGamesSection?: React.ReactNode
  nextGamesDate?: string
}) {
  // Sections in their fixed desktop order; the mobile rank (closest upcoming
  // date first) is applied with `order-*`, so each section mounts ONCE — this
  // used to render a desktop grid and a mobile stack side by side, CSS-hidden.
  const sections = useMemo(() => {
    const items: { key: string; date: string; node: React.ReactNode; desktopHidden?: boolean }[] = []
    if (trainingsSection) items.push({ key: 'trainings', date: trainingsDate ?? '9999', node: trainingsSection })
    if (eventsSection) items.push({ key: 'events', date: eventsDate ?? '9999', node: eventsSection })
    if (gamesSection) items.push({ key: 'games', date: gamesDate ?? '9999', node: gamesSection })
    // Desktop only promotes next games into the third column when there is no
    // trainings column; mobile always lists it.
    if (nextGamesSection) items.push({ key: 'nextGames', date: nextGamesDate ?? '9999', node: nextGamesSection, desktopHidden: !!trainingsSection })
    const rank = new Map([...items].sort((a, b) => a.date.localeCompare(b.date)).map((s, i) => [s.key, i]))
    return items.map((s) => ({ ...s, order: rank.get(s.key) ?? 0 }))
  }, [trainingsSection, trainingsDate, eventsSection, eventsDate, gamesSection, gamesDate, nextGamesSection, nextGamesDate])

  if (sections.length === 0) return null

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {sections.map((s) => (
        <div key={s.key} className={cn('min-w-0 lg:order-none', SECTION_ORDER[s.order], s.desktopHidden && 'lg:hidden')}>
          {s.node}
        </div>
      ))}
    </div>
  )
}

function EventRow({ event, onClick, participationStatus, participations }: { event: EventExpanded; onClick: () => void; participationStatus?: string; participations?: Participation[] }) {
  const teams = asTeams(event.teams)
  const tone = rsvpTone(participationStatus)
  const date = toZurichDateString(event.start_date)

  return (
    <ActivityRow
      rail={dayRail(date, !event.all_day && event.start_date ? formatTime(event.start_date) : '', tone, eventEndExtra(event))}
      tone={tone}
      onClick={onClick}
      title={<p className="break-words text-sm font-semibold leading-snug text-foreground">{event.title}</p>}
      chips={
        <>
          <StatusBadge status={event.event_type} />
          {teams.map((team) => (
            <TeamChip key={team.id} team={team.name} size="sm" />
          ))}
        </>
      }
    >
      {event.location && (
        <TruncatedText text={event.location} className="mt-1 text-xs text-muted-foreground" />
      )}
      {event.description && (
        <TruncatedText text={stripHtml(event.description)} as="p" lines={2} className="mt-1 text-xs text-muted-foreground" />
      )}
      {participationStatus && (
        <RowCounters activityType="event" activityId={event.id} bars hideExtras participations={participations} />
      )}
    </ActivityRow>
  )
}

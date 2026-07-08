import { useMemo } from 'react'
import { useCollection } from '../../../lib/query'
import { useUserVisibleEventIds } from '../../../hooks/useUserVisibleEventIds'
import type { Game, Training, Event, HallClosure, HallEvent, Team, Absence, MemberTeam, Member } from '../../../types'
import type { CalendarEntry, CalendarFilterState } from '../../../types/calendar'
import { birthdayOccurrencesInRange } from '../../../utils/birthdays'
import {
  parseDate,
  toDateKey,
  eachDayOfInterval,
} from '../../../utils/dateUtils'
import { format, isBefore, isAfter, isSameDay, max as maxDate, min as minDate } from 'date-fns'
import { formatTime, getDayOfWeek, toZurichDateString } from '../../../utils/dateHelpers'
import { asObj, relId, memberName, disambiguateFirstNames } from '../../../utils/relations'
import { trimBBTeamName } from '../../../utils/teamColors'
import { isAuthenticated } from '../../../lib/api'
import { useAuth } from '../../../hooks/useAuth'

interface UseCalendarDataOptions {
  filters: CalendarFilterState
  /** Visible range start (inclusive) */
  rangeStart: Date
  /** Visible range end (inclusive) */
  rangeEnd: Date
  enabled?: boolean
}

/**
 * Compute a wide fetch range based on the visible range.
 * Rounds to quarter boundaries for stable caching.
 */
function useFetchRange(rangeStart: Date) {
  return useMemo(() => {
    const m = rangeStart.getMonth()
    const y = rangeStart.getFullYear()
    const quarterStart = Math.floor(m / 4) * 4
    const fetchStart = new Date(y, quarterStart - 1, 1)
    const fetchEnd = new Date(y, quarterStart + 5, 0)
    return {
      start: format(fetchStart, 'yyyy-MM-dd'),
      end: format(fetchEnd, 'yyyy-MM-dd'),
    }
  }, [rangeStart])
}

function buildDateFilter(field: string, rangeStart: string, rangeEnd: string): Record<string, unknown>[] {
  return [{ [field]: { _gte: rangeStart } }, { [field]: { _lte: rangeEnd } }]
}

function addTeamFilter(baseParts: Record<string, unknown>[], teamIds: string[], field: string): Record<string, unknown> {
  const conditions = [...baseParts]
  if (teamIds.length > 0) {
    conditions.push({ [field]: { _in: teamIds } })
  }
  return { _and: conditions }
}

/**
 * Filter events by team membership: show club-wide (no teams) + selected teams.
 * Takes pre-resolved event IDs from the events_teams junction rather than
 * walking `events.teams.teams_id` — that path conflicts with the events policy's
 * own walk through the same alias and returns [] for non-admins.
 */
function addEventTeamFilter(
  baseParts: Record<string, unknown>[],
  teamIds: string[],
  teamEventIds: string[],
): Record<string, unknown> {
  const conditions = [...baseParts]
  if (teamIds.length > 0) {
    conditions.push({
      _or: [
        { teams: { _null: true } },
        { id: { _in: teamEventIds.length > 0 ? teamEventIds : [-1] } },
      ],
    })
  }
  return { _and: conditions }
}

/**
 * Map a game to a calendar entry. With `duty=true` it's rendered as a
 * scorer/scoreboard-duty entry (its own entry so it auto-appears on the member's
 * in-app calendar — the analogue of the auto-accepted iCal duty event): duty
 * entries carry a `duty-` id prefix, the `scorer-duty` type, no team names and
 * no home/away metadata; regular game entries carry the team + gameType/opponent/
 * sport and fall back to the away-hall name.
 */
function gameToEntry(
  game: Game & { kscw_team?: Team | string; hall?: { name: string } | string },
  duty = false,
): CalendarEntry {
  const expandedTeam = asObj<Team>(game.kscw_team)
  const expandedHall = asObj<{ name: string }>(game.hall)

  const base = {
    title: `${game.home_team} - ${game.away_team}`,
    date: parseDate(game.date),
    startTime: game.time ? formatTime(game.time) : null,
    endTime: null,
    allDay: false,
    description: [game.league, game.round].filter(Boolean).join(' | '),
    source: game,
  }

  if (duty) {
    return {
      ...base,
      id: `duty-${game.id}`,
      type: 'scorer-duty',
      location: expandedHall?.name ?? '',
      teamNames: [],
    }
  }

  return {
    ...base,
    id: game.id,
    type: 'game',
    location: expandedHall?.name ?? game.away_hall_json?.name ?? '',
    teamNames: expandedTeam ? [expandedTeam.name] : [],
    gameType: game.type,
    opponent: game.type === 'home' ? game.away_team : game.home_team,
    sport: expandedTeam?.sport ?? (game.source === 'basketplan' ? 'basketball' : 'volleyball'),
  }
}

function trainingToEntry(training: Training & { team?: Team | string; hall?: { name: string } | string }): CalendarEntry {
  const expandedTeam = asObj<Team>(training.team)
  const expandedHall = asObj<{ name: string }>(training.hall)

  return {
    id: training.id,
    type: 'training',
    title: `Training ${expandedTeam?.name ? trimBBTeamName(expandedTeam.name) : ''}`,
    date: parseDate(training.date),
    startTime: training.start_time ? formatTime(training.start_time) : null,
    endTime: training.end_time ? formatTime(training.end_time) : null,
    allDay: false,
    location: expandedHall?.name ?? '',
    teamNames: expandedTeam ? [expandedTeam.name] : [],
    description: training.cancelled
      ? `Abgesagt: ${training.cancel_reason ?? ''}`
      : training.notes ?? '',
    source: training,
  }
}

function eventToEntry(event: Event): CalendarEntry {
  // events.*_date are timestamptz stored at midnight Europe/Zurich (all-day events
  // land at 22:00Z in summer). Resolve the day in Zurich and rebuild as a local-
  // midnight Date, so the cell mapping (date-fns, device-local) is correct on any
  // device timezone — a viewer on UTC would otherwise see an all-day weekend shift
  // a day earlier (Sat+Sun → Fri+Sat).
  const startDate = parseDate(toZurichDateString(event.start_date))
  const endDate = event.end_date ? parseDate(toZurichDateString(event.end_date)) : undefined
  // Multi-day if end_date is a different day from start_date
  const isMultiDay = endDate && !isSameDay(startDate, endDate)

  return {
    id: event.id,
    type: 'event',
    title: event.title,
    date: startDate,
    endDate: isMultiDay ? endDate : undefined,
    startTime: event.all_day ? null : formatTime(event.start_date) || null,
    endTime: event.all_day ? null : (event.end_date ? formatTime(event.end_date) || null : null),
    allDay: event.all_day || !!isMultiDay,
    location: event.location ?? '',
    teamNames: [],
    description: event.description ?? '',
    source: event,
  }
}

/** "KWI A, KWI B, KWI C" → "KWI A, B, C": strip a shared word-prefix from all
 *  but the first hall name; falls back to a plain comma join when names don't
 *  share one (e.g. "KWI A, Utogrund"). */
function compactHallList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  const splitIdx = names[0].lastIndexOf(' ')
  const prefix = splitIdx > 0 ? names[0].slice(0, splitIdx + 1) : ''
  if (prefix && names.every((n) => n.startsWith(prefix))) {
    return prefix + names.map((n) => n.slice(prefix.length)).join(', ')
  }
  return names.join(', ')
}

function closureToEntry(closure: HallClosure & { hall?: { name: string } | string }): CalendarEntry {
  const expandedHall = asObj<{ name: string }>(closure.hall)
  const hallName = expandedHall?.name ?? ''
  const start = parseDate(closure.start_date)
  const end = parseDate(closure.end_date)
  const isMultiDay = !isSameDay(start, end)

  return {
    id: closure.id,
    type: 'closure',
    title: closure.reason || `Hall closure: ${hallName}`,
    date: start,
    endDate: isMultiDay ? end : undefined,
    startTime: null,
    endTime: null,
    allDay: true,
    location: hallName,
    teamNames: [],
    description: hallName,
    source: closure,
  }
}

function absenceToEntry(absence: Absence, memberName: string): CalendarEntry {
  const start = parseDate(absence.start_date)
  const end = parseDate(absence.end_date)
  const isMultiDay = !isSameDay(start, end)

  return {
    id: absence.id,
    type: 'absence',
    title: memberName ? `Absence · ${memberName}` : 'Absence',
    date: start,
    endDate: isMultiDay ? end : undefined,
    startTime: null,
    endTime: null,
    allDay: true,
    location: '',
    teamNames: [],
    description: absence.reason_detail ?? '',
    source: absence,
  }
}

/**
 * Expand a weekly absence into one calendar entry per matching weekday
 * inside the visible range (clipped to the absence's own start/end window).
 * Each occurrence is a single-day allDay entry with a stable id suffix.
 */
function weeklyAbsenceToEntries(
  absence: Absence,
  memberName: string,
  rangeStart: Date,
  rangeEnd: Date,
): CalendarEntry[] {
  const days = absence.days_of_week ?? []
  if (days.length === 0) return []
  const absStart = parseDate(absence.start_date)
  const absEnd = parseDate(absence.end_date)
  const from = maxDate([absStart, rangeStart])
  const to = minDate([absEnd, rangeEnd])
  if (isAfter(from, to)) return []
  const title = memberName ? `Unavailable · ${memberName}` : 'Unavailable'
  const out: CalendarEntry[] = []
  for (const d of eachDayOfInterval(from, to)) {
    if (!days.includes(getDayOfWeek(d))) continue
    out.push({
      id: `${absence.id}:${toDateKey(d)}`,
      type: 'absence',
      title,
      date: d,
      startTime: null,
      endTime: null,
      allDay: true,
      location: '',
      teamNames: [],
      description: absence.reason_detail ?? '',
      source: absence,
    })
  }
  return out
}

/** Detect hall events that are actually closures (e.g. "Halle geschlossen") */
const CLOSURE_PATTERN = /geschlossen|gesperrt|closed/i

function hallEventToEntry(he: HallEvent): CalendarEntry {
  const isClosure = CLOSURE_PATTERN.test(he.title)
  return {
    id: he.id,
    type: isClosure ? 'closure' : 'hall',
    title: he.title,
    date: parseDate(he.date),
    startTime: he.start_time ? formatTime(he.start_time) : null,
    endTime: he.end_time ? formatTime(he.end_time) : null,
    allDay: he.all_day,
    location: he.location ?? '',
    teamNames: [],
    description: '',
    source: he,
  }
}

/** Check if an entry overlaps with a date range */
function entryOverlapsRange(entry: CalendarEntry, rangeStart: Date, rangeEnd: Date): boolean {
  const entryEnd = entry.endDate ?? entry.date
  return !isAfter(entry.date, rangeEnd) && !isBefore(entryEnd, rangeStart)
}

export function useCalendarData({ filters, rangeStart, rangeEnd, enabled = true }: UseCalendarDataOptions) {
  const fetchRange = useFetchRange(rangeStart)
  const { user } = useAuth()

  const authed = isAuthenticated()
  const wantHome = filters.sources.includes('game-home')
  const wantAway = filters.sources.includes('game-away')
  // games / trainings / hall_closures / hall_events all require auth post-v4.4.x permission tightening —
  // gate to avoid 403 "permission to access collection" spam from public visitors landing on /calendar.
  const fetchGames = enabled && authed && (wantHome || wantAway)
  const fetchTrainings = enabled && authed && filters.sources.includes('training')
  const fetchClosures = enabled && authed && filters.sources.includes('closure')
  const fetchEvents = enabled && authed && filters.sources.includes('event')
  const fetchHallEvents = enabled && authed && filters.sources.includes('hall')
  const fetchAbsences = enabled && filters.sources.includes('absence')
  const wantBirthdays = filters.sources.includes('birthday')

  const { data: gamesRaw, isLoading: gamesLoading } = useCollection<Game>('games', {
    enabled: fetchGames,
    filter: addTeamFilter(
      [...buildDateFilter('date', fetchRange.start, fetchRange.end), { away_team: { _nnull: true } }, { time: { _nnull: true } }],
      filters.selectedTeamIds,
      'kscw_team',
    ),
    fields: ['*', 'kscw_team.*', 'kscw_team.coach.members_id', 'kscw_team.team_responsible.members_id', 'hall.*'],
    sort: ['date', 'time'],
    all: true,
  })
  const games = gamesRaw ?? []

  const { data: trainingsRaw, isLoading: trainingsLoading } = useCollection<Training>('trainings', {
    enabled: fetchTrainings,
    filter: addTeamFilter(
      buildDateFilter('date', fetchRange.start, fetchRange.end),
      filters.selectedTeamIds,
      'team',
    ),
    fields: ['*', 'team.*', 'team.coach.members_id', 'team.team_responsible.members_id', 'hall.*', 'coach.first_name', 'coach.last_name'],
    sort: ['date', 'start_time'],
    all: true,
  })
  const trainings = trainingsRaw ?? []

  // Always fetch closures when hall events are fetched (needed to suppress duplicate GCal closures)
  const { data: closuresRawData, isLoading: closuresLoading } = useCollection<HallClosure>('hall_closures', {
    enabled: fetchClosures || fetchHallEvents,
    filter: { _and: [{ start_date: { _lte: fetchRange.end } }, { end_date: { _gte: fetchRange.start } }] },
    fields: ['*', 'hall.*'],
    all: true,
  })
  const closuresRaw = closuresRawData ?? []

  const { teamEventIds, isLoading: eventIdsLoading } = useUserVisibleEventIds(
    filters.selectedTeamIds,
    undefined,
    fetchEvents && filters.selectedTeamIds.length > 0,
  )
  const { data: eventsRaw, isLoading: eventsLoading } = useCollection<Event>('events', {
    enabled: fetchEvents && !eventIdsLoading,
    filter: addEventTeamFilter(
      buildDateFilter('start_date', fetchRange.start, fetchRange.end),
      filters.selectedTeamIds,
      teamEventIds,
    ),
    fields: ['id', 'start_date', 'end_date', 'all_day', 'title', 'location', 'description'],
    sort: ['start_date'],
    all: true,
  })
  const events = eventsRaw ?? []

  const { data: hallEventsRaw, isLoading: hallEventsLoading } = useCollection<HallEvent>('hall_events', {
    enabled: fetchHallEvents,
    filter: { _and: buildDateFilter('date', fetchRange.start, fetchRange.end) },
    fields: ['id', 'date', 'title', 'start_time', 'end_time', 'all_day', 'location'],
    sort: ['date', 'start_time'],
    all: true,
  })
  const hallEvents = hallEventsRaw ?? []

  // Fetch member_teams for selected teams (used to filter absences by team)
  const hasTeamFilter = filters.selectedTeamIds.length > 0
  const { data: teamMemberLinksRaw } = useCollection<MemberTeam>('member_teams', {
    enabled: fetchAbsences && hasTeamFilter && isAuthenticated(),
    filter: hasTeamFilter
      ? { team: { _in: filters.selectedTeamIds } }
      : { id: { _eq: -1 } },
    fields: ['member'],
    all: true,
  })
  const teamMemberLinks = teamMemberLinksRaw ?? []

  // Team members' birthdays — team-scoped (never club-wide/public) and authed
  // only. Sourced through the single-level `member_teams` junction filtered by
  // the selected teams (same pattern as absences) so we sidestep the deep-M2M
  // policy trap. Only the fields the birthday marker needs are pulled; the
  // `birthdate_visibility === 'full'` gate is applied client-side in the util
  // (mirrors the roster gate — this ships no more than the roster already does).
  const fetchBirthdays = enabled && authed && wantBirthdays && hasTeamFilter
  const { data: birthdayLinksRaw } = useCollection<MemberTeam & { member?: Member | string }>('member_teams', {
    enabled: fetchBirthdays && isAuthenticated(),
    filter: hasTeamFilter
      ? { team: { _in: filters.selectedTeamIds } }
      : { id: { _eq: -1 } },
    fields: ['member.id', 'member.first_name', 'member.last_name', 'member.birthdate', 'member.birthdate_visibility'],
    all: true,
  })
  const birthdayLinks = birthdayLinksRaw ?? []

  const { data: absencesRaw, isLoading: absencesLoading } = useCollection<Absence & { member?: { first_name: string; last_name: string } | string }>('absences', {
    enabled: fetchAbsences && isAuthenticated(),
    filter: fetchAbsences
      ? { _and: [{ end_date: { _gte: fetchRange.start } }, { start_date: { _lte: fetchRange.end } }] }
      : { id: { _eq: -1 } },
    // Only the disambiguated label needs member fields — scope to id/name so we
    // don't ship email/phone/birthdate/IBAN etc. to the client (member.* pulled
    // every column).
    fields: ['id', 'member.id', 'member.first_name', 'member.last_name', 'start_date', 'end_date', 'reason', 'reason_detail', 'affects', 'type', 'days_of_week', 'blocking'],
    sort: ['start_date'],
    all: true,
  })
  const absences = absencesRaw ?? []

  // Current member's own scorer/scoreboard duties (any role) — fetched by the
  // member's id across the six duty FKs, independent of the team filter (a duty
  // game is often another team's home game). Surfaces them on the calendar.
  const wantScorerDuties = filters.sources.includes('scorer-duty')
  const fetchScorerDuties = enabled && authed && wantScorerDuties && !!user
  const { data: dutyGamesRaw, isLoading: dutyGamesLoading } = useCollection<Game>('games', {
    enabled: fetchScorerDuties,
    filter: fetchScorerDuties
      ? {
          _and: [
            ...buildDateFilter('date', fetchRange.start, fetchRange.end),
            {
              _or: [
                { scorer_member: { _eq: user!.id } },
                { scoreboard_member: { _eq: user!.id } },
                { scorer_scoreboard_member: { _eq: user!.id } },
                { bb_scorer_member: { _eq: user!.id } },
                { bb_timekeeper_member: { _eq: user!.id } },
                { bb_24s_official: { _eq: user!.id } },
              ],
            },
          ],
        }
      : { id: { _eq: -1 } },
    fields: ['*', 'kscw_team.*', 'hall.*'],
    sort: ['date', 'time'],
    all: true,
  })
  const dutyGames = dutyGamesRaw ?? []

  const entries = useMemo(() => {
    const all: CalendarEntry[] = []

    if (fetchGames) {
      for (const g of games) {
        const entry = gameToEntry(g)
        if (wantHome && wantAway) {
          all.push(entry)
        } else if (wantHome && entry.gameType === 'home') {
          all.push(entry)
        } else if (wantAway && entry.gameType === 'away') {
          all.push(entry)
        }
      }
    }
    if (fetchTrainings) all.push(...trainings.map(trainingToEntry))
    if (fetchScorerDuties) all.push(...dutyGames.map((g) => gameToEntry(g, true)))
    if (fetchEvents) all.push(...events.map(eventToEntry))
    // Always compute closure-covered dates from hall_closures (even if not displayed)
    // so GCal "Halle geschlossen" entries can be suppressed when a named closure exists.
    // hall_closures stores one row per hall — same reason + dates across halls
    // (e.g. KWI A/B/C) MERGE into one entry listing every affected hall, instead
    // of dropping all but the first row (which showed "KWI A" for an A+B+C closure).
    const closureSeen = new Set<string>()
    const closureCoveredDates = new Set<string>()
    const closureGroups = new Map<string, CalendarEntry>()
    const closureHalls = new Map<string, string[]>()
    for (const closure of closuresRaw) {
      const ce = closureToEntry(closure)
      const endDate = ce.endDate ?? ce.date
      for (const d of eachDayOfInterval(ce.date, endDate)) {
        closureCoveredDates.add(toDateKey(d))
      }
      if (fetchClosures) {
        const dedupeKey = `${ce.title}|${toDateKey(ce.date)}|${ce.endDate ? toDateKey(ce.endDate) : ''}`
        if (!closureSeen.has(dedupeKey)) {
          closureSeen.add(dedupeKey)
          closureGroups.set(dedupeKey, ce)
          closureHalls.set(dedupeKey, ce.location ? [ce.location] : [])
        } else {
          const halls = closureHalls.get(dedupeKey)
          if (halls && ce.location && !halls.includes(ce.location)) halls.push(ce.location)
        }
      }
    }
    for (const [key, entry] of closureGroups) {
      const halls = compactHallList([...(closureHalls.get(key) ?? [])].sort())
      all.push(halls ? { ...entry, location: halls, description: halls } : entry)
    }
    if (fetchHallEvents) {
      for (const he of hallEvents) {
        const entry = hallEventToEntry(he)
        if (entry.type === 'closure') {
          // Skip GCal closure events when a hall_closures record covers that date
          if (closureCoveredDates.has(toDateKey(entry.date))) continue
          // Deduplicate remaining GCal closure entries (same title + date)
          const dedupeKey = `${entry.title}|${toDateKey(entry.date)}|${entry.endDate ? toDateKey(entry.endDate) : ''}`
          if (!closureSeen.has(dedupeKey)) {
            closureSeen.add(dedupeKey)
            all.push(entry)
          }
        } else {
          // Skip all non-closure GCal hall events — trainings and games
          // are already shown from their own collections
          continue
        }
      }
    }

    if (fetchAbsences) {
      // Filter absences by team membership when team filter is active
      const teamMemberIds = hasTeamFilter ? new Set(teamMemberLinks.map((mt) => relId(mt.member))) : null
      const teamIdSet = hasTeamFilter ? new Set(filters.selectedTeamIds) : null
      // By default, hide unavailabilities (weekly) and non-blocking absences —
      // they clutter the calendar and don't affect the rest of the team.
      const showHidden = filters.showHiddenAbsences === true
      const shownAbsences = absences.filter((a) => {
        if (!showHidden && (a.type === 'weekly' || (a as { blocking?: boolean }).blocking === false)) return false
        // Skip if team filter active and member not in selected teams
        if (teamMemberIds && !teamMemberIds.has(relId(a.member))) return false
        // Also check affects field: skip if affects specific teams that don't match
        const affects = (a as Record<string, unknown>).affects as string[] | undefined
        if (teamIdSet && affects && affects.length > 0 && !affects.includes('all') && !affects.some((id) => teamIdSet.has(id))) return false
        return true
      })
      // Disambiguate first names across the shown absentees so two "Luca"s read
      // "Luca C." / "Luca Ca." instead of both showing "Luca".
      const nameLabels = disambiguateFirstNames(
        shownAbsences
          .map((a) => asObj<{ id: string | number; first_name: string; last_name: string }>(a.member))
          .filter((m): m is { id: string | number; first_name: string; last_name: string } => !!m),
      )
      for (const a of shownAbsences) {
        const m = asObj<{ id: string | number; first_name: string; last_name: string }>(a.member)
        const label = (m && nameLabels.get(String(m.id))) || m?.first_name || memberName(m) || '?'
        if (a.type === 'weekly') {
          all.push(...weeklyAbsenceToEntries(a, label, rangeStart, rangeEnd))
        } else {
          all.push(absenceToEntry(a, label))
        }
      }
    }

    if (fetchBirthdays) {
      // One marker per member per intersecting year. Dedupe members (a member in
      // two selected teams appears once). Visibility (`full` only) + parse gating
      // lives in birthdayOccurrencesInRange.
      const seenBday = new Set<string>()
      for (const link of birthdayLinks) {
        const m = asObj<Member>(link.member)
        if (!m?.id) continue
        const mid = String(m.id)
        if (seenBday.has(mid)) continue
        seenBday.add(mid)
        for (const occ of birthdayOccurrencesInRange(m, rangeStart, rangeEnd)) {
          all.push({
            id: `bday-${mid}:${occ.date.getFullYear()}`,
            type: 'birthday',
            title: memberName(m) || m.first_name || '?',
            date: occ.date,
            startTime: null,
            endTime: null,
            allDay: true,
            location: '',
            teamNames: [],
            description: '',
            source: { id: `bday-${mid}`, member_id: mid, age: occ.age, birthday: true },
          })
        }
      }
    }

    // Filter to visible range
    const filtered = all.filter((entry) => entryOverlapsRange(entry, rangeStart, rangeEnd))

    filtered.sort((a, b) => {
      const dateCmp = toDateKey(a.date).localeCompare(toDateKey(b.date))
      if (dateCmp !== 0) return dateCmp
      if (a.allDay && !b.allDay) return -1
      if (!a.allDay && b.allDay) return 1
      return (a.startTime ?? '').localeCompare(b.startTime ?? '')
    })

    return filtered
  }, [games, trainings, events, closuresRaw, hallEvents, absences, dutyGames, teamMemberLinks, birthdayLinks, fetchGames, fetchTrainings, fetchEvents, fetchClosures, fetchHallEvents, fetchAbsences, fetchScorerDuties, fetchBirthdays, wantHome, wantAway, rangeStart, rangeEnd, hasTeamFilter, filters.selectedTeamIds, filters.showHiddenAbsences])

  const closedDates = useMemo(() => {
    const dates = new Set<string>()
    for (const closure of closuresRaw) {
      const start = parseDate(closure.start_date)
      const end = parseDate(closure.end_date)
      for (const day of eachDayOfInterval(start, end)) {
        dates.add(toDateKey(day))
      }
    }
    // Also include hall events detected as closures
    for (const he of hallEvents) {
      if (CLOSURE_PATTERN.test(he.title)) {
        dates.add(toDateKey(parseDate(he.date)))
      }
    }
    return dates
  }, [closuresRaw, hallEvents])

  return {
    entries,
    closedDates,
    isLoading: gamesLoading || trainingsLoading || closuresLoading || eventsLoading || hallEventsLoading || absencesLoading || dutyGamesLoading,
    error: null,
  }
}

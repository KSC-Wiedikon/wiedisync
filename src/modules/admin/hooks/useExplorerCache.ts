import { useCallback, useEffect, useState } from 'react'
import { fetchAllItems } from '../../../lib/api'
import type { Member, Team, Event as EventRec, Training, Game } from '../../../types'
import type { ExplorerScope, CacheShape } from '../components/explorerHelpers'

export interface CacheFilters {
  members: Record<string, unknown> | undefined
  teams: Record<string, unknown>
  events: Record<string, unknown> | undefined
  trainings: Record<string, unknown>
  games: Record<string, unknown> | undefined
}

/** Build Directus filter objects per bucket based on sport scope. */
export function buildFilters(scope: ExplorerScope): CacheFilters {
  const teams: Record<string, unknown> = { active: { _eq: true } }
  const trainings: Record<string, unknown> = {}
  let events: Record<string, unknown> | undefined = undefined
  let games: Record<string, unknown> | undefined = undefined

  if (scope !== 'all') {
    teams.sport = { _eq: scope }
    ;(trainings as { team?: unknown }).team = { sport: { _eq: scope } }
    games = { kscw_team: { sport: { _eq: scope } } }
    events = {
      _or: [
        { teams: { teams_id: { sport: { _eq: scope } } } },
        { teams: { _null: true } },
      ],
    }
  }

  return {
    members: { kscw_membership_active: { _eq: true } },
    teams,
    events,
    trainings,
    games,
  }
}

const EMPTY: CacheShape = {
  members: [], teams: [], events: [], trainings: [], games: [],
  memberTeams: new Map(), memberCoachTeams: new Map(), memberTrTeams: new Map(),
  loadedAt: null,
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

function ninetyDaysAgoISO(): string {
  return new Date(Date.now() - NINETY_DAYS_MS).toISOString().slice(0, 10)
}

/**
 * Batched page-load cache: fires 5 parallel fetches and stores the result.
 * Refresh() re-runs the batch. Sport scope is applied via buildFilters.
 * Member-sport filtering for non-'all' scope is done client-side (keep
 * members with ≥ 1 team in scope) to avoid a complex server-side filter.
 */
export function useExplorerCache(scope: ExplorerScope) {
  const [data, setData] = useState<CacheShape>(EMPTY)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const f = buildFilters(scope)
      const cutoff = ninetyDaysAgoISO()
      const [members, teams, events, trainings, games, junctions, coachJunctions, trJunctions] = await Promise.all([
        fetchAllItems<Member>('members', {
          filter: f.members,
          fields: [
            'id', 'first_name', 'last_name', 'email', 'sex', 'kscw_membership_active', 'role', 'user',
            // Fields used by ExplorerMemberFilters (multiselect/multiselect-chip/tri-state/presence)
            'phone', 'license_nr', 'licences', 'birthdate', 'photo', 'number', 'position', 'language',
            'birthdate_visibility', 'consent_decision', 'consent_prompted_at',
            'requested_team', 'coach_approved_team', 'is_spielplaner', 'wiedisync_active',
            'shell', 'shell_expires', 'shell_reminder_sent',
            'licence_activated', 'licence_validated',
            'licence_activation_date', 'licence_validation_date', 'licence_category',
            'hide_phone', 'hide_email', 'website_visible',
            'communications_team_chat_enabled', 'communications_dm_enabled', 'communications_banned',
            'push_preview_content', 'last_online_at',
            'adresse', 'plz', 'ort', 'nationalitaet', 'vm_email', 'ahv_nummer', 'beitragskategorie',
          ],
          sort: ['last_name', 'first_name'],
        }),
        fetchAllItems<Team>('teams', {
          filter: f.teams,
          fields: ['id', 'name', 'full_name', 'sport', 'season', 'active', 'captain', 'coach', 'team_responsible'],
          sort: ['sport', 'name'],
        }),
        fetchAllItems<EventRec>('events', {
          filter: { _and: [{ end_date: { _gte: cutoff } }, ...(f.events ? [f.events] : [])] },
          fields: ['id', 'title', 'event_type', 'start_date', 'end_date', 'participation_mode', 'teams.teams_id'],
          sort: ['start_date'],
        }),
        fetchAllItems<Training>('trainings', {
          filter: { _and: [{ date: { _gte: cutoff } }, ...(Object.keys(f.trainings).length ? [f.trainings] : [])] },
          fields: ['id', 'team', 'date', 'start_time', 'end_time', 'hall', 'cancelled'],
          sort: ['date'],
        }),
        fetchAllItems<Game>('games', {
          filter: { _and: [{ date: { _gte: cutoff } }, ...(f.games ? [f.games] : [])] },
          fields: [
            'id', 'kscw_team', 'home_team', 'away_team', 'date', 'time', 'hall', 'home_score', 'away_score',
            'scorer_member', 'scoreboard_member', 'scorer_scoreboard_member',
            'bb_scorer_member', 'bb_timekeeper_member', 'bb_24s_official',
          ],
          sort: ['date'],
        }),
        fetchAllItems<{ member: string | number; team: string | number }>('member_teams', {
          fields: ['member', 'team'],
        }),
        fetchAllItems<{ members_id: string | number; teams_id: string | number }>('teams_coaches', {
          fields: ['members_id', 'teams_id'],
        }).catch(() => [] as { members_id: string | number; teams_id: string | number }[]),
        fetchAllItems<{ members_id: string | number; teams_id: string | number }>('teams_responsibles', {
          fields: ['members_id', 'teams_id'],
        }).catch(() => [] as { members_id: string | number; teams_id: string | number }[]),
      ])

      // Build memberTeams Map: memberId → [teamId, ...]
      const memberTeams = new Map<string, string[]>()
      for (const j of junctions) {
        const mid = String(j.member)
        const tid = String(j.team)
        const existing = memberTeams.get(mid)
        if (existing) existing.push(tid)
        else memberTeams.set(mid, [tid])
      }

      const memberCoachTeams = new Map<string, string[]>()
      for (const j of coachJunctions) {
        const mid = String(j.members_id)
        const tid = String(j.teams_id)
        const existing = memberCoachTeams.get(mid)
        if (existing) existing.push(tid)
        else memberCoachTeams.set(mid, [tid])
      }

      const memberTrTeams = new Map<string, string[]>()
      for (const j of trJunctions) {
        const mid = String(j.members_id)
        const tid = String(j.teams_id)
        const existing = memberTrTeams.get(mid)
        if (existing) existing.push(tid)
        else memberTrTeams.set(mid, [tid])
      }

      // Build teamSportMap for sport-scoping
      const teamSportMap = new Map<string, string>()
      for (const tm of teams) {
        teamSportMap.set(String(tm.id), String((tm as unknown as { sport?: string }).sport ?? ''))
      }

      // Member sport-filter: keep those with ≥1 team in scope (across any role)
      const filteredMembers = scope === 'all'
        ? members
        : members.filter((m) => {
            const mid = String(m.id)
            const allTeamIds = [
              ...(memberTeams.get(mid) ?? []),
              ...(memberCoachTeams.get(mid) ?? []),
              ...(memberTrTeams.get(mid) ?? []),
              ...teams.filter((tm) => String((tm as unknown as { captain?: unknown }).captain) === mid).map((tm) => String(tm.id)),
            ]
            return allTeamIds.some((teamId) => teamSportMap.get(teamId) === scope)
          })

      setData({
        members: filteredMembers,
        teams,
        events,
        trainings,
        games,
        memberTeams,
        memberCoachTeams,
        memberTrTeams,
        loadedAt: Date.now(),
      })
    } catch (err) {
      setError(err as Error)
    } finally {
      setIsLoading(false)
    }
  }, [scope])

  useEffect(() => { void load() }, [load])

  return { data, isLoading, error, refresh: load }
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { kscwApi } from '../../lib/api'
import { useAuth } from '../../hooks/useAuth'

/**
 * Basketball youth tournaments (migration 398) — client for /kscw/bb-tournaments.
 * Endpoint-only tables. The list answers for the caller: a coach / TR gets
 * their tournament teams, a basketball admin every one, anyone else nothing.
 */

export type PickStatus = 'registered' | 'picked' | 'none'

export interface TournamentTeamState {
  team: number
  status: PickStatus
  picked: boolean
  picked_by_name: string | null
  note: string | null
  canPick: boolean
}

export interface Tournament {
  id: number
  date: string
  end_date: string | null
  host_club: string | null
  hall: string | null
  time_from: string | null
  time_to: string | null
  leagues: string[]
  deadline: string | null
  registration_open: boolean
  registered_count: number | null
  teams: TournamentTeamState[]
}

export interface TournamentTeam { id: number; name: string; league: string | null }

export interface TournamentsResponse {
  admin: boolean
  teams: TournamentTeam[]
  tournaments: Tournament[]
}

export const tournamentsKey = (memberId: string | null | undefined) => ['bb-tournaments', memberId ?? null] as const

/** Also drives the nav entry: shown only when `teams` is non-empty. */
export function useTournaments(enabled = true) {
  const { user } = useAuth()
  return useQuery({
    queryKey: tournamentsKey(user?.id),
    queryFn: () => kscwApi<TournamentsResponse>('/bb-tournaments'),
    enabled: enabled && !!user,
    staleTime: 60_000,
  })
}

export function useSetPick() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: ({ tournament, team, picked }: { tournament: number; team: number; picked: boolean }) =>
      kscwApi(`/bb-tournaments/${tournament}/picks/${team}`, { method: picked ? 'POST' : 'DELETE', body: picked ? {} : undefined }),
    onSettled: () => qc.invalidateQueries({ queryKey: tournamentsKey(user?.id) }),
  })
}

/**
 * Nav gate for "Tournaments": asks the server only for people who could
 * possibly pick (basketball admin, global admin, coach / TR of any team), and
 * shows the entry only when it answers with at least one tournament team.
 */
export function useShowTournaments(isLoggedIn: boolean, isApproved: boolean): boolean {
  const { isBbAdmin, isGlobalAdmin, coachTeamIds, teamResponsibleIds } = useAuth()
  const maybe = isLoggedIn && isApproved && (isBbAdmin || isGlobalAdmin || coachTeamIds.length > 0 || teamResponsibleIds.length > 0)
  const { data } = useTournaments(maybe)
  return maybe && (data?.teams.length ?? 0) > 0
}

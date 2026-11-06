import { useQuery } from '@tanstack/react-query'
import { kscwApi } from '../lib/api'
import { useAuth } from './useAuth'

/** One game as the moved-game endpoints show it: date and time are already dd.mm.yyyy and HH:MM. */
export interface DutyRecheckGame {
  game: number
  home_team: string
  away_team: string
  date: string
  time: string
  hall: string | null
  team: string | null
}

/** Somebody has to answer: their duty moved (`ask`), or a leader asks them to take one (`invite`). */
export interface DutyRecheckQuestion extends DutyRecheckGame {
  id: number
  kind: 'ask' | 'invite'
  role: string
  was: string | null
  by: string | null
  clash: boolean
}

export interface DutyOpenSeat extends DutyRecheckGame {
  role: string
}

/** For the game team's coaches and team responsibles. `silent`: the holder has not answered. */
export interface DutySeatToFill extends DutyRecheckGame {
  role: string
  state: 'open' | 'silent'
  holder?: string
  invited: { id: number; name: string }[]
}

export interface DutyRecheckHome {
  questions: DutyRecheckQuestion[]
  open_seats: DutyOpenSeat[]
  to_fill: DutySeatToFill[]
}

export const DUTY_RECHECK_QUERY_KEY = ['duty-recheck', 'home']

/** What the home page and /scorer show about moved home games (kscw-endpoints/duty-recheck.js). */
export function useDutyRecheck() {
  const { user } = useAuth()
  return useQuery({
    queryKey: [...DUTY_RECHECK_QUERY_KEY, user?.id ?? null],
    queryFn: () => kscwApi<DutyRecheckHome>('/duty-recheck/home'),
    enabled: !!user,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
}

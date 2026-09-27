import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { kscwApi } from '../../lib/api'
import { useAuth } from '../../hooks/useAuth'

/**
 * Car pooling (migration 378) — client for /kscw/carpools/*. The tables are
 * endpoint-only (no /items grant), so everything goes through kscwApi and the
 * server answers every mutation with the fresh board, which is written straight
 * into the query cache.
 */

export type CarpoolActivityType = 'game' | 'training' | 'event'
export type CarpoolKind = 'offer' | 'request'
export type CarpoolDirection = 'there' | 'back' | 'both'

export interface CarpoolPerson {
  id: number
  first_name: string
  last_name: string
  nickname: string | null
  /** Only set between people sharing a car, and never when the member hides it. */
  phone?: string | null
}

interface CarpoolEntryBase {
  id: number
  kind: CarpoolKind
  member: CarpoolPerson
  direction: CarpoolDirection
  seats: number
  departure_time: string | null
  departure_location: string | null
  notes: string | null
  mine: boolean
}

export interface CarpoolOffer extends CarpoolEntryBase {
  kind: 'offer'
  seats_taken: number
  seats_free: number
  i_am_passenger: boolean
  passengers: Array<{ id: number; seats: number; added_by_name: string | null; member: CarpoolPerson }>
}

export interface CarpoolRequest extends CarpoolEntryBase {
  kind: 'request'
  covered: boolean
  covered_by: CarpoolPerson[]
}

export interface CarpoolBoard {
  offers: CarpoolOffer[]
  requests: CarpoolRequest[]
  totals: { offers: number; seats_free: number; requests_open: number }
  mine: { offer: number | null; request: number | null; riding_in: number[] }
}

export interface CarpoolActivityInfo {
  type: CarpoolActivityType
  id: number
  label: string
  team: string | null
  date: string | null
  time: string | null
  enabled: boolean
  cancelled: boolean
  past: boolean
  /** enabled && not cancelled && not over — new rides and seats allowed. */
  open: boolean
  /** Team ids the board is open to (migration 379). Empty = everyone who can see it. */
  scope: number[]
}

export interface CarpoolBoardResponse {
  activity: CarpoolActivityInfo
  data: CarpoolBoard
  me: number | null
  /** False when the board is scoped to teams the viewer is not in — render nothing. */
  in_scope: boolean
  scope_teams: Array<{ id: number; name: string; sport: 'volleyball' | 'basketball' | null }>
}

export interface CarpoolUpcoming extends CarpoolActivityInfo {
  offers: number
  seats_free: number
  requests_open: number
  my_role: 'driver' | 'passenger' | 'requester' | null
}

export interface CarpoolEntryInput {
  kind?: CarpoolKind
  direction: CarpoolDirection
  seats: number
  departure_time: string | null
  departure_location: string | null
  notes: string | null
}

export const carpoolBoardKey = (type: string, id: string | number, memberId: string | null | undefined) =>
  ['carpool', 'board', type, String(id), memberId ?? null] as const
export const carpoolUpcomingKey = (memberId: string | null | undefined) =>
  ['carpool', 'upcoming', memberId ?? null] as const

export function useCarpoolBoard(type: CarpoolActivityType, id: string | number | null | undefined, enabled = true) {
  const { user } = useAuth()
  return useQuery({
    queryKey: carpoolBoardKey(type, id ?? '', user?.id),
    queryFn: () => kscwApi<CarpoolBoardResponse>(`/carpools/${type}/${id}`),
    enabled: enabled && !!user && id != null && id !== '',
    // Short: the toggle lives on the activity row and is flipped from forms that
    // never touch this cache, so a reopened modal must not show a stale board.
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  })
}

export function useCarpoolUpcoming(enabled = true) {
  const { user } = useAuth()
  return useQuery({
    queryKey: carpoolUpcomingKey(user?.id),
    queryFn: async () => (await kscwApi<{ data: CarpoolUpcoming[] }>('/carpools/upcoming')).data ?? [],
    enabled: enabled && !!user,
    staleTime: 60_000,
  })
}

/**
 * Mutations. Each returns the fresh board from the server; it replaces the
 * cached one (keeping the activity header) and Home's list is invalidated.
 */
export function useCarpoolActions(type: CarpoolActivityType, id: string | number) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const key = carpoolBoardKey(type, id, user?.id)

  const apply = useCallback((board: CarpoolBoard) => {
    qc.setQueryData<CarpoolBoardResponse>(key, (prev) => (prev ? { ...prev, data: board } : prev))
    void qc.invalidateQueries({ queryKey: ['carpool', 'upcoming'] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, type, id, user?.id])

  const run = useCallback(async (path: string, method: string, body?: unknown) => {
    const res = await kscwApi<{ data: CarpoolBoard }>(path, { method, body })
    apply(res.data)
    return res.data
  }, [apply])

  return {
    create: (input: CarpoolEntryInput & { kind: CarpoolKind }) => run(`/carpools/${type}/${id}`, 'POST', input),
    update: (entryId: number, input: Partial<CarpoolEntryInput>) => run(`/carpools/entries/${entryId}`, 'PATCH', input),
    withdraw: (entryId: number) => run(`/carpools/entries/${entryId}`, 'DELETE'),
    join: (entryId: number, seats: number) => run(`/carpools/entries/${entryId}/join`, 'POST', { seats }),
    leave: (entryId: number) => run(`/carpools/entries/${entryId}/join`, 'DELETE'),
    take: (requestId: number) => run(`/carpools/entries/${requestId}/take`, 'POST'),
    dropPassenger: (passengerRowId: number) => run(`/carpools/passengers/${passengerRowId}`, 'DELETE'),
    /** Re-read after the activity's toggle changed (it lives on the activity row). */
    refresh: () => qc.invalidateQueries({ queryKey: ['carpool'] }),
  }
}

/** Server error codes (carpools.js) → i18n keys in the `carpool` namespace. */
export const CARPOOL_ERROR_KEYS: Record<string, string> = {
  carpool_full: 'errorFull',
  carpool_seats_below_taken: 'errorSeatsBelowTaken',
  carpool_duplicate: 'errorDuplicate',
  carpool_already_passenger: 'errorAlreadyPassenger',
  carpool_no_offer: 'errorNoOffer',
  carpool_disabled: 'errorDisabled',
  carpool_closed: 'errorClosed',
  carpool_driver_is_passenger: 'errorOwnCar',
  missing_location: 'errorMissingLocation',
  no_member: 'errorNoMember',
  carpool_not_in_scope: 'errorNotInScope',
}

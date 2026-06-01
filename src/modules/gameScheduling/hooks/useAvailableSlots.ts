import { useState, useEffect, useCallback } from 'react'
import { kscwApi } from '../../../lib/api'

export interface SlotData {
  id: string
  date: string
  start_time: string
  end_time: string
  hall_id: string
  hall_name: string
  source: string
}

export interface OpponentData {
  id: string
  club_name: string
  team_name: string
  contact_name: string
  contact_email: string
  kscw_team_id: string
  kscw_team_name: string
  home_game: string
  away_game: string
  source: 'self_registration' | 'manual' | 'svrz'
  status: 'invited' | 'viewed' | 'booked' | 'revoked' | 'expired' | 'active'
}

export interface InviteGame {
  id: string
  display_name: string
  starting_date_time: string | null
  is_home_kscw: boolean
  league: string | null
  status: string
}

export interface BookingData {
  id: string
  type: 'home_slot_pick' | 'away_proposal'
  status: 'pending' | 'confirmed' | 'rejected'
  slot: string
  proposed_datetime_1: string
  proposed_place_1: string
  proposed_datetime_2: string
  proposed_place_2: string
  proposed_datetime_3: string
  proposed_place_3: string
  confirmed_proposal: number
  /** Decided home slot (enriched server-side for home_slot_pick bookings). */
  slot_date?: string
  slot_start?: string
  slot_end?: string
  slot_hall_name?: string
}

interface SlotsResponse {
  opponent: OpponentData
  games: InviteGame[]
  slots: SlotData[]
  bookings: BookingData[]
  blocked_away_strict: string[]
  blocked_away_loose: string[]
  season_window: { start: string; end: string } | null
}

export function useAvailableSlots(token: string | undefined) {
  const [data, setData] = useState<SlotsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSlots = useCallback(async () => {
    if (!token) return
    setIsLoading(true)
    setError(null)
    try {
      const resp = await kscwApi(`/terminplanung/slots/${token}`, { method: 'GET' })
      setData(resp as SlotsResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }, [token])

  useEffect(() => { fetchSlots() }, [fetchSlots])

  const bookHomeSlot = useCallback(async (slotId: string) => {
    if (!token) throw new Error('No token')
    const resp = await kscwApi(`/terminplanung/book-home/${token}`, {
      method: 'POST',
      body: { slot_id: slotId },
    })
    await fetchSlots()
    return resp
  }, [token, fetchSlots])

  const proposeAway = useCallback(async (proposals: Array<{ date: string; start_time: string; location: string }>) => {
    if (!token) throw new Error('No token')
    const resp = await kscwApi(`/terminplanung/propose-away/${token}`, {
      method: 'POST',
      body: { proposals },
    })
    await fetchSlots()
    return resp
  }, [token, fetchSlots])

  return {
    opponent: data?.opponent ?? null,
    games: data?.games ?? [],
    slots: data?.slots ?? [],
    bookings: data?.bookings ?? [],
    blockedStrict: data?.blocked_away_strict ?? [],
    blockedLoose: data?.blocked_away_loose ?? [],
    seasonWindow: data?.season_window ?? null,
    isLoading,
    error,
    bookHomeSlot,
    proposeAway,
    refetch: fetchSlots,
  }
}

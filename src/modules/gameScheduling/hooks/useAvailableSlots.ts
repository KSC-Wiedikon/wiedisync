import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { kscwApi } from '../../../lib/api'

// Normalise i18next's language ('en-US' → 'en') to one of the 5 stored codes.
const baseLang = (l: string | undefined): string => (l || '').split('-')[0].toLowerCase()

export interface SlotData {
  id: string
  date: string
  start_time: string
  end_time: string
  hall_id: string
  hall_name: string
  source: string
  /** Junior Sunday slots: true when another junior team already plays this Sunday (soft cluster hint). */
  preferred?: boolean
  /** True if the slot clears the strict bar (home gap + 0 absences) — required for home picks 1 & 2. Loose-only slots (false) are selectable only as the 3rd pick. */
  strict?: boolean
}

export interface ProposedHomeSlot {
  slot_id: string | number
  date?: string
  start?: string
  end?: string
  hall_name?: string
  /** False if the slot has since been booked/blocked by someone else. */
  available: boolean
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
  /** Opponent's remembered UI language (de/gsw/en/fr/it), or null if not chosen yet. */
  language: string | null
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
  /** Home-slot proposals (slot ids) while a home booking is pending. */
  proposed_slot_1?: string | number | null
  proposed_slot_2?: string | number | null
  proposed_slot_3?: string | number | null
  confirmed_proposal: number
  /** Decided home slot (enriched server-side for confirmed home_slot_pick bookings). */
  slot_date?: string
  slot_start?: string
  slot_end?: string
  slot_hall_name?: string
  /** Pending home proposal: the resolved proposed slots (enriched server-side). */
  proposed_slots?: ProposedHomeSlot[]
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
  const { i18n } = useTranslation()
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

  const proposeHome = useCallback(async (slotIds: Array<string | number>) => {
    if (!token) throw new Error('No token')
    const resp = await kscwApi(`/terminplanung/propose-home/${token}`, {
      method: 'POST',
      body: { slot_ids: slotIds.map((x) => Number(x)), language: baseLang(i18n.resolvedLanguage || i18n.language) },
    })
    await fetchSlots()
    return resp
  }, [token, fetchSlots, i18n])

  const proposeAway = useCallback(async (proposals: Array<{ date: string; start_time: string; location: string }>) => {
    if (!token) throw new Error('No token')
    const resp = await kscwApi(`/terminplanung/propose-away/${token}`, {
      method: 'POST',
      body: { proposals, language: baseLang(i18n.resolvedLanguage || i18n.language) },
    })
    await fetchSlots()
    return resp
  }, [token, fetchSlots, i18n])

  // Persist the opponent's chosen language (best-effort) so emails use it.
  const setLanguage = useCallback(async (language: string) => {
    if (!token) return
    try {
      await kscwApi(`/terminplanung/set-language/${token}`, { method: 'POST', body: { language } })
    } catch { /* best-effort — a failed language save must never disrupt the flow */ }
  }, [token])

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
    proposeHome,
    proposeAway,
    setLanguage,
    refetch: fetchSlots,
  }
}

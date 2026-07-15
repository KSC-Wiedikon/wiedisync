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
  /** Note from KSCW shown to the opponent (read-only here). */
  kscw_note?: string
  /** The opponent's own remark to KSCW (editable here). */
  opponent_note?: string
}

export interface InviteGame {
  id: string
  /** SVRZ fixture number (official game number), if known. */
  number?: number | null
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
  /** SVRZ fixture this booking schedules (multi-game pairings); null = legacy, owned by the first fixture of its side. */
  svrz_game_id?: string | null
  /** Official VM game number of this booking's fixture — set even when the fixture is already approved (and thus no longer in the offered `games` list). */
  svrz_number?: number | null
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

  // The request itself. Every state write lives in a promise callback, so this
  // is safe to call straight from an effect.
  const loadSlots = useCallback((tok: string) => {
    return kscwApi(`/terminplanung/slots/${tok}`, { method: 'GET', anonymous: true }).then(
      (resp) => {
        setData(resp as SlotsResponse)
        setIsLoading(false)
      },
      (err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setIsLoading(false)
      },
    )
  }, [])

  // Manual refetch (used by the propose/note mutations below): raises the
  // loading flag first, exactly as before.
  const fetchSlots = useCallback(async () => {
    if (!token) return
    setIsLoading(true)
    setError(null)
    await loadSlots(token)
  }, [token, loadSlots])

  // Token-driven load. The "raise loading / clear error" half of the old effect
  // is applied during render (adjust-state-during-render) so the effect body no
  // longer writes state synchronously; `isLoading` already starts at `true`, so
  // the mount pass is unchanged.
  const [prevToken, setPrevToken] = useState(token)
  if (prevToken !== token) {
    setPrevToken(token)
    if (token) {
      setIsLoading(true)
      setError(null)
    }
  }
  useEffect(() => {
    if (!token) return
    void loadSlots(token)
  }, [token, loadSlots])

  // The opponent-club person confirming — captured by the modal on the confirm
  // buttons, stored on each booking so we know who to follow up with.
  interface Proposer { name: string; email: string }

  // svrzGameId targets one fixture of a multi-game pairing; null/undefined =
  // the first fixture of the side (legacy single-game behaviour).
  const proposeHome = useCallback(async (slotIds: Array<string | number>, svrzGameId?: string | null, proposer?: Proposer) => {
    if (!token) throw new Error('No token')
    const resp = await kscwApi(`/terminplanung/propose-home/${token}`, {
      method: 'POST',
      anonymous: true,
      body: {
        slot_ids: slotIds.map((x) => Number(x)),
        language: baseLang(i18n.resolvedLanguage || i18n.language),
        ...(svrzGameId ? { svrz_game_id: svrzGameId } : {}),
        ...(proposer ? { proposer_name: proposer.name, proposer_email: proposer.email } : {}),
      },
    })
    await fetchSlots()
    return resp
  }, [token, fetchSlots, i18n])

  const proposeAway = useCallback(async (proposals: Array<{ date: string; start_time: string; location: string }>, svrzGameId?: string | null, proposer?: Proposer) => {
    if (!token) throw new Error('No token')
    const resp = await kscwApi(`/terminplanung/propose-away/${token}`, {
      method: 'POST',
      anonymous: true,
      body: {
        proposals,
        language: baseLang(i18n.resolvedLanguage || i18n.language),
        ...(svrzGameId ? { svrz_game_id: svrzGameId } : {}),
        ...(proposer ? { proposer_name: proposer.name, proposer_email: proposer.email } : {}),
      },
    })
    await fetchSlots()
    return resp
  }, [token, fetchSlots, i18n])

  // Save the opponent's free-text remark to KSCW.
  const saveNote = useCallback(async (note: string) => {
    if (!token) throw new Error('No token')
    await kscwApi(`/terminplanung/note/${token}`, { method: 'POST', anonymous: true, body: { note } })
    await fetchSlots()
  }, [token, fetchSlots])

  // Persist the opponent's chosen language (best-effort) so emails use it.
  const setLanguage = useCallback(async (language: string) => {
    if (!token) return
    try {
      await kscwApi(`/terminplanung/set-language/${token}`, { method: 'POST', anonymous: true, body: { language } })
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
    saveNote,
    setLanguage,
    refetch: fetchSlots,
  }
}

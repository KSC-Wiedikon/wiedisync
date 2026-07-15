import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { kscwApi } from '../../../lib/api'
import type { OpponentData, InviteGame, SlotData, BookingData } from './useAvailableSlots'

// Normalise i18next's language ('en-US' → 'en') to one of the 5 stored codes.
const baseLang = (l: string | undefined): string => (l || '').split('-')[0].toLowerCase()

// One (KSCW team ↔ opponent team) pairing — the exact per-opponent payload the
// backend computes, reused verbatim by the club portal aggregate endpoint.
export interface ClubPairing {
  opponent: OpponentData
  games: InviteGame[]
  slots: SlotData[]
  bookings: BookingData[]
  blocked_away_strict: string[]
  blocked_away_loose: string[]
  season_window: { start: string; end: string } | null
}

export interface ClubPortalData {
  id: number
  club_id: string
  club_name: string
  status: 'invited' | 'viewed' | 'booked' | 'revoked' | 'expired'
  language: string | null
  contact_name: string
  contact_email: string
  club_note: string
  season_id: number
  season_name: string
}

interface ClubSlotsResponse {
  portal: ClubPortalData
  pairings: ClubPairing[]
}

interface Proposer { name: string; email: string }

/**
 * Club portal data hook — ONE link/page per opponent CLUB (all its teams vs
 * KSCW on one page). Mirrors useAvailableSlots but against the /terminplanung/
 * club/* endpoints, which fan out to / delegate to the per-opponent engine.
 * Every mutation carries `svrz_game_id` so the backend can route it to the
 * owning pairing.
 */
export function useClubSlots(token: string | undefined) {
  const { i18n } = useTranslation()
  const [data, setData] = useState<ClubSlotsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadSlots = useCallback((tok: string) => {
    return kscwApi(`/terminplanung/club/slots/${tok}`, { method: 'GET', anonymous: true }).then(
      (resp) => {
        setData(resp as ClubSlotsResponse)
        setIsLoading(false)
      },
      (err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setIsLoading(false)
      },
    )
  }, [])

  const fetchSlots = useCallback(async () => {
    if (!token) return
    setIsLoading(true)
    setError(null)
    await loadSlots(token)
  }, [token, loadSlots])

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

  const proposeHome = useCallback(async (slotIds: Array<string | number>, svrzGameId: string | null, proposer?: Proposer) => {
    if (!token) throw new Error('No token')
    const resp = await kscwApi(`/terminplanung/club/propose-home/${token}`, {
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

  const proposeAway = useCallback(async (proposals: Array<{ date: string; start_time: string; location: string }>, svrzGameId: string | null, proposer?: Proposer) => {
    if (!token) throw new Error('No token')
    const resp = await kscwApi(`/terminplanung/club/propose-away/${token}`, {
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

  const saveNote = useCallback(async (note: string) => {
    if (!token) throw new Error('No token')
    await kscwApi(`/terminplanung/club/note/${token}`, { method: 'POST', anonymous: true, body: { note } })
    await fetchSlots()
  }, [token, fetchSlots])

  const setLanguage = useCallback(async (language: string) => {
    if (!token) return
    try {
      await kscwApi(`/terminplanung/club/set-language/${token}`, { method: 'POST', anonymous: true, body: { language } })
    } catch { /* best-effort — a failed language save must never disrupt the flow */ }
  }, [token])

  return {
    portal: data?.portal ?? null,
    pairings: data?.pairings ?? [],
    isLoading,
    error,
    proposeHome,
    proposeAway,
    saveNote,
    setLanguage,
    refetch: fetchSlots,
  }
}

import { useCallback, useEffect, useState } from 'react'
import { kscwApi } from '../../../lib/api'

/**
 * Public (unauthenticated) data hook for the basketball opponent-club portal —
 * `GET /kscw/terminplanung/bb/club/:token` and its three write routes.
 *
 * NOT a variant of `useClubSlots`. That hook drives the volleyball SVRZ engine:
 * it fetches per-opponent PAIRINGS (fixtures, free slots, away blocks, season
 * windows) and its mutations are slot proposals routed by `svrz_game_id`.
 * Basketball has no fixture feed at all before the ProBasket Spielplansitzung —
 * the placed home game IS the proposal, and the club's only verbs are accept,
 * decline and counter-propose. There is nothing to parameterise by sport; the two
 * payloads share no field. What IS shared is the envelope (32-hex token, status
 * ladder, per-portal language + club note), and that lives in the backend.
 *
 * Every call is `anonymous: true` — the opponent has no KSCW session, and sending
 * a Bearer token from a logged-in planner testing the link would be wrong anyway.
 */

export interface BbPortalGame {
  id: number
  /** 'YYYY-MM-DD'. */
  date: string
  /** 'HH:MM' tip-off. */
  time: string
  hall: string
  /** The KSCW team's name. */
  kscw_team: string
  /** The opponent team as the KSCW planner typed it. */
  opponent: string
  status: 'offered' | 'accepted' | 'declined' | 'countered'
  opponent_note: string
  counter_proposals: Array<{ date: string; time: string }>
  responded_at: string | null
  /** The KSCW planner's own remark on this game — written for the opponent to read. */
  kscw_note: string
}

export interface BbPortalInfo {
  club_name: string
  status: 'invited' | 'viewed' | 'booked'
  language: string
  club_note: string
  season_name: string
  expires_at: string | null
}

export interface BbPortalKeyDates {
  /** 'YYYY-MM-DD' — the ProBasket Spielplansitzung. */
  spielplansitzung: string
  /** 'YYYY-MM-DD' — hall-availability deadline for the automatic leagues. */
  availability_due: string
}

/** One free pitch the club may pick. */
export interface BbPortalFreeSlot {
  id: number
  /** 'YYYY-MM-DD'. */
  date: string
  /** 'HH:MM'. */
  time: string
  end_time: string
  hall: string
}

/**
 * One KSCW team this club shares a ProBasket group with, and the pitches still free for it.
 *
 * The pairing is derived from group membership (migration 287), because basketball has no
 * fixture feed before the Spielplansitzung — there is nothing else to join a club to a team on.
 */
export interface BbPortalPairing {
  kscw_team: number
  kscw_team_name: string
  group: string
  group_label: string
  /**
   * Home games owed = the workbook's Anzahl Spiele halved.
   * ⚠ `null` means ProBasket has not stated a count for this group yet — it does NOT mean
   * zero, and must never be rendered as one.
   */
  home_games: number | null
  games_total: number | null
  slots: BbPortalFreeSlot[]
}

export interface BbPortalPayload {
  portal: BbPortalInfo
  key_dates: BbPortalKeyDates
  games: BbPortalGame[]
  /** Empty when the club shares no group with us. */
  pairings: BbPortalPairing[]
}

export interface BbDecision {
  game_id: number
  response: 'accepted' | 'declined'
  note?: string
  /** Only meaningful on a decline; at most 3, each a real date + HH:MM. */
  alternatives?: Array<{ date: string; time: string }>
}

export interface BbResponder {
  name: string
  email: string
}

export function useBbClubPortal(token: string | undefined) {
  const [data, setData] = useState<BbPortalPayload | null>(null)
  // A missing token can never resolve, so it must not start in the loading state —
  // the page would otherwise hang on the boot overlay instead of showing "invalid link".
  const [isLoading, setIsLoading] = useState(!!token)
  const [error, setError] = useState<string | null>(null)

  // Promise-chain rather than async/await on purpose: every setState then lives in a
  // callback, so the effect below performs no synchronous state update
  // (react-hooks/set-state-in-effect). Same shape as useClubSlots.
  const load = useCallback((tok: string) => {
    return kscwApi<BbPortalPayload>(`/terminplanung/bb/club/${tok}`, {
      method: 'GET',
      anonymous: true,
    }).then(
      (res) => {
        setData(res)
        setError(null)
        setIsLoading(false)
      },
      (err: unknown) => {
        const body = (err as { body?: { error?: string } })?.body
        setError(body?.error || (err instanceof Error ? err.message : String(err)))
        setIsLoading(false)
      },
    )
  }, [])

  const refetch = useCallback(async () => {
    if (!token) return
    await load(token)
  }, [token, load])

  // Token changes are settled during render (never a synchronous setState in the
  // effect body) — same shape as useClubSlots.
  const [prevToken, setPrevToken] = useState(token)
  if (prevToken !== token) {
    setPrevToken(token)
    setError(null)
    setIsLoading(!!token)
  }
  useEffect(() => {
    if (!token) return
    void load(token)
  }, [token, load])

  const respond = useCallback(
    async (decisions: BbDecision[], responder: BbResponder) => {
      if (!token) throw new Error('No token')
      const res = await kscwApi<{ success: boolean; updated: number }>(
        `/terminplanung/bb/club/respond/${token}`,
        {
          method: 'POST',
          anonymous: true,
          body: {
            decisions,
            responder_name: responder.name,
            responder_email: responder.email,
          },
        },
      )
      await refetch()
      return res
    },
    [token, refetch],
  )

  /**
   * The club picks free pitches (the volleyball `propose-home` move).
   *
   * ⚠ A pick HOLDS the pitch: the backend's plan row claims the slot via migration 278's
   * sync-slots trigger, so the date leaves every other club's free list at once. It is still
   * not a ProBasket fixture — those are assigned at the Spielplansitzung.
   */
  const propose = useCallback(
    async (picks: Array<{ slot_id: number; note?: string }>, responder: BbResponder) => {
      if (!token) throw new Error('No token')
      const res = await kscwApi<{
        success: boolean
        created: number
        skipped_existing: number
        rejected: number
      }>(`/terminplanung/bb/club/propose/${token}`, {
        method: 'POST',
        anonymous: true,
        body: {
          picks,
          responder_name: responder.name,
          responder_email: responder.email,
        },
      })
      await refetch()
      return res
    },
    [token, refetch],
  )

  const saveNote = useCallback(
    async (note: string) => {
      if (!token) throw new Error('No token')
      await kscwApi(`/terminplanung/bb/club/note/${token}`, {
        method: 'POST',
        anonymous: true,
        body: { note },
      })
      await refetch()
    },
    [token, refetch],
  )

  const setLanguage = useCallback(
    async (language: string) => {
      if (!token) return
      try {
        await kscwApi(`/terminplanung/bb/club/set-language/${token}`, {
          method: 'POST',
          anonymous: true,
          body: { language },
        })
      } catch {
        /* best-effort — a failed language save must never disrupt the flow */
      }
    },
    [token],
  )

  return {
    portal: data?.portal ?? null,
    games: data?.games ?? [],
    // `?? []` and not `data?.pairings` — a caller mapping over undefined would crash the
    // opponent's page, and an older backend simply omits the key.
    pairings: data?.pairings ?? [],
    keyDates: data?.key_dates ?? null,
    isLoading,
    error,
    respond,
    propose,
    saveNote,
    setLanguage,
    refetch,
  }
}

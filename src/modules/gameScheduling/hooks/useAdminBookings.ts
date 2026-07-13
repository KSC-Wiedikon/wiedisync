import { useState, useEffect, useCallback, useRef } from 'react'
import type { GameSchedulingBooking, GameSchedulingOpponent, GameSchedulingSlot, ProposalHealthEntry } from '../../../types'
import { fetchAllItems, kscwApi } from '../../../lib/api'

// Note: the base `GameSchedulingBooking.{opponent,slot}: string` intersects the
// union down to `string`, so callers reading the *expanded* object must cast
// (e.g. `homeBooking.slot as unknown as GameSchedulingSlot`). Kept as an
// intersection (not Omit) so ExpandedBooking stays assignable to
// GameSchedulingBooking for the components that expect the base type.
export type ExpandedBooking = GameSchedulingBooking & {
  opponent: GameSchedulingOpponent | string
  slot: GameSchedulingSlot | string
}

export function useAdminBookings(seasonId: string | undefined) {
  const [bookings, setBookings] = useState<ExpandedBooking[]>([])
  const [opponents, setOpponents] = useState<GameSchedulingOpponent[]>([])
  const [slots, setSlots] = useState<GameSchedulingSlot[]>([])
  const [proposalHealth, setProposalHealth] = useState<ProposalHealthEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  // True once the first fetch completes. Lets the page keep showing the loaded
  // dashboard while a confirm/refetch runs in the background, instead of blanking
  // back to a full-page spinner (which reads as a page reload).
  const [hasLoaded, setHasLoaded] = useState(false)
  // Set when one of the three core fetches rejected — the dashboard rendered
  // with partial/empty data and the UI can offer a retry instead of silently
  // showing empty tables.
  const [loadError, setLoadError] = useState(false)
  // Guards against a stale-season response clobbering state: a season re-resolve
  // or re-mount can leave an older fetch in flight whose results arrive last.
  // Mirrors the `latestKeyRef` pattern in useTeamAbsences/useTeamMembers.
  const latestKeyRef = useRef<string | undefined>(undefined)
  // vmPush schedules a delayed follow-up refetch to catch the terminal VM push
  // status; track it so it can be cancelled if the dashboard unmounts within 6s.
  const vmPushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (vmPushTimerRef.current) clearTimeout(vmPushTimerRef.current) }, [])

  // The fetch itself. Written as a promise chain (not async/await) and WITHOUT
  // the `setIsLoading(true)` flip so it can be started straight from an effect:
  // every state write lands in a promise callback, never in the effect's own
  // synchronous body. `fetchAll` below adds the flip back for the caller-driven
  // (event handler) refetches.
  const load = useCallback((): Promise<void> => {
    if (!seasonId) return Promise.resolve()
    const key = seasonId
    latestKeyRef.current = key
    // allSettled so one failed collection doesn't blank the other two — set
    // each result that fulfilled and flag a degraded load if any rejected.
    return Promise.allSettled([
      fetchAllItems<ExpandedBooking>('game_scheduling_bookings', {
        filter: { season: { _eq: seasonId } },
        fields: ['*', 'opponent.*', 'slot.*'],
        sort: ['-date_created'],
      }),
      fetchAllItems<GameSchedulingOpponent>('game_scheduling_opponents', {
        filter: { season: { _eq: seasonId } },
        sort: ['-date_created'],
      }),
      fetchAllItems<GameSchedulingSlot>('game_scheduling_slots', {
        filter: { season: { _eq: seasonId } },
        sort: ['date'],
      }),
    ])
      .then(([bksR, oppsR, slsR]) => {
        // A newer season fetch superseded this one — drop its results entirely.
        if (latestKeyRef.current !== key) return
        let degraded = false
        if (bksR.status === 'fulfilled') setBookings(bksR.value)
        else { degraded = true; console.error('Failed to fetch admin bookings:', bksR.reason) }
        if (oppsR.status === 'fulfilled') setOpponents(oppsR.value)
        else { degraded = true; console.error('Failed to fetch scheduling opponents:', oppsR.reason) }
        if (slsR.status === 'fulfilled') setSlots(slsR.value)
        else { degraded = true; console.error('Failed to fetch scheduling slots:', slsR.reason) }
        setLoadError(degraded)
        // Live validity of every pending home proposal (best-effort — never blocks
        // the dashboard if the endpoint hiccups).
        return kscwApi(`/admin/terminplanung/proposal-health?season_id=${seasonId}`)
          .then((resp) => {
            const health = (resp as { health?: ProposalHealthEntry[] })?.health
            if (latestKeyRef.current !== key) return
            setProposalHealth(Array.isArray(health) ? health : [])
          })
          .catch(() => {
            if (latestKeyRef.current === key) setProposalHealth([])
          })
      })
      .finally(() => {
        if (latestKeyRef.current === key) {
          setIsLoading(false)
          setHasLoaded(true)
        }
      })
  }, [seasonId])

  // Caller-driven refetch (retry button, post-mutation reloads): show the loading
  // state first, exactly like the old `fetchAll`.
  const fetchAll = useCallback((): Promise<void> => {
    if (!seasonId) return Promise.resolve()
    setIsLoading(true)
    return load()
  }, [load, seasonId])

  // Season switch → back to loading. Done while rendering (the old `fetchAll`
  // did it inside the effect); `isLoading` already starts `true` for the mount
  // fetch, so this only fires on an actual season change.
  const [prevSeasonId, setPrevSeasonId] = useState(seasonId)
  if (prevSeasonId !== seasonId) {
    setPrevSeasonId(seasonId)
    if (seasonId) setIsLoading(true)
  }

  useEffect(() => { load() }, [load])

  const confirmAwayProposal = useCallback(async (bookingId: string, proposalNumber: number, adminNotes?: string) => {
    await kscwApi('/terminplanung/admin/confirm-away', {
      method: 'POST',
      body: { booking_id: bookingId, proposal_number: proposalNumber, admin_notes: adminNotes || '' },
    })
    await fetchAll()
  }, [fetchAll])

  const confirmHomeProposal = useCallback(async (bookingId: string, proposalNumber: number, adminNotes?: string) => {
    await kscwApi('/terminplanung/admin/confirm-home', {
      method: 'POST',
      body: { booking_id: bookingId, proposal_number: proposalNumber, admin_notes: adminNotes || '' },
    })
    await fetchAll()
  }, [fetchAll])

  // Semi-automatic: the admin has confirmed in the dashboard that an opponent's
  // home proposals are all gone — email them (their language) to pick 3 new slots.
  // bookingId scopes the cleanup to ONE fixture's dead proposal (multi-game
  // pairings keep their other proposals/bookings).
  const requestNewSlots = useCallback(async (opponentId: string | number, bookingId?: string | number) => {
    await kscwApi('/admin/terminplanung/request-new-slots', {
      method: 'POST',
      body: { opponent_id: Number(opponentId), ...(bookingId ? { booking_id: Number(bookingId) } : {}) },
    })
    await fetchAll()
  }, [fetchAll])

  // Save the note KSCW shows to an opponent on their proposal page.
  const saveOpponentNote = useCallback(async (opponentId: string | number, kscwNote: string) => {
    await kscwApi('/admin/terminplanung/opponent-note', {
      method: 'POST',
      body: { opponent_id: Number(opponentId), kscw_note: kscwNote },
    })
    await fetchAll()
  }, [fetchAll])

  // Record an already-agreed matchup directly (the spielplaner settled the
  // date(s) by email/phone) — skips the opponent propose/choose flow. Either leg
  // may be supplied; no emails are sent.
  const manualBooking = useCallback(async (
    opponentId: string | number,
    legs: {
      home?: { date: string; start_time: string; end_time?: string; hall: number | string; svrz_game_id?: string }
      away?: { date: string; start_time?: string; place?: string; svrz_game_id?: string }
    },
  ) => {
    await kscwApi('/terminplanung/admin/manual-booking', {
      method: 'POST',
      body: { opponent_id: Number(opponentId), ...legs },
    })
    await fetchAll()
  }, [fetchAll])

  // Cancel a CONFIRMED game so it can be rescheduled: deletes the booking, frees
  // its home slot, and removes it from the member calendar (server-side). VM is
  // not un-pushed — the caller warns the operator to handle VolleyManager.
  const deleteBooking = useCallback(async (bookingId: string | number) => {
    await kscwApi('/terminplanung/admin/delete-booking', {
      method: 'POST',
      body: { booking_id: Number(bookingId) },
    })
    await fetchAll()
  }, [fetchAll])

  const blockSlot = useCallback(async (slotId: string, action: 'block' | 'unblock') => {
    await kscwApi('/terminplanung/admin/block-slot', {
      method: 'POST',
      body: { slot_id: slotId, action },
    })
    await fetchAll()
  }, [fetchAll])

  // (Re)push a confirmed home booking's date/time/hall into VolleyManager.
  // Pass svrzPersistenceId to resolve an ambiguous 'needs_pick' (choose the leg).
  // The push runs fire-and-forget server-side; we refetch so the badge flips to
  // 'queued', then again shortly after to catch the terminal status.
  const vmPush = useCallback(async (bookingId: string, svrzPersistenceId?: string) => {
    await kscwApi('/admin/terminplanung/vm-push', {
      method: 'POST',
      body: { booking_id: Number(bookingId), ...(svrzPersistenceId ? { svrz_persistence_id: svrzPersistenceId } : {}) },
    })
    await fetchAll()
    if (vmPushTimerRef.current) clearTimeout(vmPushTimerRef.current)
    vmPushTimerRef.current = setTimeout(() => { fetchAll() }, 6000)
  }, [fetchAll])

  const generateSlots = useCallback(async (seasonIdParam: string) => {
    const resp = await kscwApi('/terminplanung/admin/generate-slots', {
      method: 'POST',
      body: { season_id: seasonIdParam },
    })
    await fetchAll()
    return resp as { total_created: number }
  }, [fetchAll])

  // Email the finalized schedule (all confirmed home + away games) for one team
  // to its coaches + team-responsibles and the spielplanung mailbox (→ group).
  // Optionally attach the Excel + PDF report (built client-side) so the same file
  // the admin downloads rides along with the email.
  const finalizeNotify = useCallback(async (
    teamId: string,
    seasonIdParam: string,
    attachments?: { filename: string; content_base64: string; content_type: string }[],
  ) => {
    const resp = await kscwApi('/terminplanung/admin/finalize-notify', {
      method: 'POST',
      body: { team_id: teamId, season_id: seasonIdParam, attachments: attachments?.length ? attachments : undefined },
    })
    return resp as { staff: number; home: number; away: number; pending: number }
  }, [])

  return {
    bookings,
    opponents,
    slots,
    proposalHealth,
    isLoading,
    hasLoaded,
    loadError,
    confirmAwayProposal,
    confirmHomeProposal,
    requestNewSlots,
    saveOpponentNote,
    manualBooking,
    deleteBooking,
    blockSlot,
    generateSlots,
    finalizeNotify,
    vmPush,
    refetch: fetchAll,
  }
}

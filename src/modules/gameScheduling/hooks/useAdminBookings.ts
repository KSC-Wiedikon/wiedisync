import { useState, useEffect, useCallback } from 'react'
import type { GameSchedulingBooking, GameSchedulingOpponent, GameSchedulingSlot } from '../../../types'
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
  const [isLoading, setIsLoading] = useState(true)
  // True once the first fetch completes. Lets the page keep showing the loaded
  // dashboard while a confirm/refetch runs in the background, instead of blanking
  // back to a full-page spinner (which reads as a page reload).
  const [hasLoaded, setHasLoaded] = useState(false)

  const fetchAll = useCallback(async () => {
    if (!seasonId) return
    setIsLoading(true)
    try {
      const [bks, opps, sls] = await Promise.all([
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
      setBookings(bks)
      setOpponents(opps)
      setSlots(sls)
    } catch (err) {
      console.error('Failed to fetch admin bookings:', err)
    } finally {
      setIsLoading(false)
      setHasLoaded(true)
    }
  }, [seasonId])

  useEffect(() => { fetchAll() }, [fetchAll])

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

  const blockSlot = useCallback(async (slotId: string, action: 'block' | 'unblock') => {
    await kscwApi('/terminplanung/admin/block-slot', {
      method: 'POST',
      body: { slot_id: slotId, action },
    })
    await fetchAll()
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
  const finalizeNotify = useCallback(async (teamId: string, seasonIdParam: string) => {
    const resp = await kscwApi('/terminplanung/admin/finalize-notify', {
      method: 'POST',
      body: { team_id: teamId, season_id: seasonIdParam },
    })
    return resp as { staff: number; home: number; away: number; pending: number }
  }, [])

  return {
    bookings,
    opponents,
    slots,
    isLoading,
    hasLoaded,
    confirmAwayProposal,
    confirmHomeProposal,
    blockSlot,
    generateSlots,
    finalizeNotify,
    refetch: fetchAll,
  }
}

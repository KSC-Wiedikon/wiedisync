import { useCallback, useMemo, useState } from 'react'
import { kscwApi, updateRecord } from '../../../lib/api'
import { useCollection } from '../../../lib/query'
import type { BasketballSlotPlan } from '../../../types'

/**
 * The offer half of the basketball club portal: which placed home games are
 * published to which opponent club, and what that club answered
 * (`basketball_slot_plan` + the migration-280 offer lifecycle).
 *
 * The placed game IS the proposal — there is no separate fixture-anchor table.
 * A row starts as `draft` (visible only to us), becomes `offered` when a planner
 * publishes it, and then carries the club's own answer.
 *
 * Reads go through the items API (the collection is already granted, and
 * `fields: ['*']` picks up the new columns); the two state transitions go through
 * the endpoints, which capture the actor with `writeUserLog` and enforce the rules
 * a client cannot (never offer a guest game, never rewind an answered row).
 */

/** ⚠ Keep in step with the CHECK on basketball_slot_plan.proposal_status (migrations 280/289). */
export type BbProposalStatus =
  | 'draft'
  | 'offered'
  /** The opponent picked a free pitch through its portal; a planner has not answered yet. */
  | 'club_proposed'
  | 'accepted'
  | 'declined'
  | 'countered'

export interface BbCounterProposal {
  date: string
  time: string
}

export interface BbOfferRow extends BasketballSlotPlan {
  /** basketplan_clubs.id, or null while the game is not addressed to a club yet. */
  opponent_club?: number | string | null
  proposal_status?: BbProposalStatus | null
  offered_at?: string | null
  responded_at?: string | null
  responded_by_name?: string | null
  responded_by_email?: string | null
  opponent_note?: string | null
  counter_proposals?: BbCounterProposal[] | null
}

/** Statuses the opponent can see. Mirrors OFFER_VISIBLE_STATUSES in basketball-portal.js. */
export const OFFER_VISIBLE_STATUSES: BbProposalStatus[] = ['offered', 'accepted', 'declined', 'countered']

export const proposalStatusOf = (row: BbOfferRow): BbProposalStatus =>
  (row.proposal_status as BbProposalStatus | null) ?? 'draft'

function parseCounters(value: unknown): BbCounterProposal[] {
  if (Array.isArray(value)) return value as BbCounterProposal[]
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? (parsed as BbCounterProposal[]) : []
    } catch {
      return []
    }
  }
  return []
}

export function useBasketballOffers(seasonId: string | number | null | undefined) {
  const enabled = seasonId != null && seasonId !== ''
  const [busy, setBusy] = useState(false)

  const planQ = useCollection<Record<string, unknown>>('basketball_slot_plan', {
    filter: { season: { _eq: seasonId } },
    fields: ['*'],
    all: true,
    enabled,
  })

  /**
   * Home games only. A 'guest' row is somebody else's game borrowing our hall — the
   * backend refuses to offer one, so it must never appear as offerable here either.
   */
  const games = useMemo<BbOfferRow[]>(() => {
    const rows = (planQ.data ?? []) as unknown as BbOfferRow[]
    return rows
      .filter((r) => (r.game_type ?? 'home') === 'home')
      .map((r) => ({ ...r, counter_proposals: parseCounters(r.counter_proposals) }))
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
  }, [planQ.data])

  /** basketplan_clubs.id → the games addressed to that club. */
  const byClub = useMemo(() => {
    const m = new Map<string, BbOfferRow[]>()
    for (const g of games) {
      if (g.opponent_club == null) continue
      const k = String(g.opponent_club)
      const arr = m.get(k) ?? []
      arr.push(g)
      m.set(k, arr)
    }
    return m
  }, [games])

  /** Placed home games that are not addressed to any club yet — nothing can be offered for them. */
  const unassigned = useMemo(() => games.filter((g) => g.opponent_club == null), [games])

  const refetch = planQ.refetch

  /** Address a placed game to an opponent club (items API → Directus logs the actor). */
  const assignClub = useCallback(
    async (gameId: string | number, clubId: number | null) => {
      await updateRecord('basketball_slot_plan', gameId, { opponent_club: clubId })
      await refetch()
    },
    [refetch],
  )

  /** draft → offered. Publishes the games to the club's portal. */
  const offer = useCallback(
    async (ids: Array<string | number>, opponentClub?: number | null) => {
      if (!enabled || !ids.length) return null
      setBusy(true)
      try {
        const res = await kscwApi<{ success: boolean; updated: number }>(
          '/admin/terminplanung/bb/offer',
          {
            method: 'POST',
            body: {
              season: Number(seasonId),
              ids: ids.map(Number),
              ...(opponentClub != null ? { opponent_club: Number(opponentClub) } : {}),
            },
          },
        )
        await refetch()
        return res
      } finally {
        setBusy(false)
      }
    },
    [enabled, seasonId, refetch],
  )

  /** offered → draft. Only rows the club has not answered yet (enforced server-side). */
  /**
   * Answer what a club picked through its portal.
   *
   * ⚠ 'release' DELETES the row. That is the only thing that frees the pitch again —
   * migration 278's release-slots trigger fires on DELETE, so a 'declined' row would hold the
   * slot forever while looking rejected. Callers must confirm before calling it.
   */
  const answerClubProposal = useCallback(
    async (ids: Array<string | number>, decision: 'accept' | 'release') => {
      if (!enabled || !ids.length) return null
      setBusy(true)
      try {
        const res = await kscwApi<{ success: boolean; affected: number }>(
          '/admin/terminplanung/bb/club-proposals',
          { method: 'POST', body: { season: Number(seasonId), ids: ids.map(Number), decision } },
        )
        await refetch()
        return res
      } finally {
        setBusy(false)
      }
    },
    [enabled, seasonId, refetch],
  )

  const unoffer = useCallback(
    async (ids: Array<string | number>) => {
      if (!enabled || !ids.length) return null
      setBusy(true)
      try {
        const res = await kscwApi<{ success: boolean; updated: number }>(
          '/admin/terminplanung/bb/unoffer',
          { method: 'POST', body: { season: Number(seasonId), ids: ids.map(Number) } },
        )
        await refetch()
        return res
      } finally {
        setBusy(false)
      }
    },
    [enabled, seasonId, refetch],
  )

  return {
    games,
    byClub,
    unassigned,
    isLoading: planQ.isLoading,
    error: (planQ.error as Error | null) ?? null,
    busy,
    assignClub,
    offer,
    unoffer,
    answerClubProposal,
    refetch,
  }
}

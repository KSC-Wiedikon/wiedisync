import { useEffect, useState } from 'react'
import { useCollection } from '../lib/query'
import { useRealtime } from './useRealtime'
import { kscwApi } from '../lib/api'
import type { Participation } from '../types'

// Sourced from config (CF Pages env var) so a data reseed / different
// environment doesn't silently break the non-member add-on. Falls back to the
// current prod record ID when unset.
const MIXED_TOURNAMENT_EVENT_ID = import.meta.env.VITE_MIXED_TOURNAMENT_EVENT_ID ?? '5'

export interface ParticipationCounts {
  /** At least one source is still loading — never paint the numbers as settled. */
  pending: boolean
  /** Rows the counters were computed from (after the prefetch/fetch choice). */
  rowCount: number
  /** Green number: players + all guests + non-member signups. Staff excluded. */
  confirmedTotal: number
  confirmed: number
  allGuests: number
  hasGuestBreakdown: boolean
  tentative: number
  tentativeGuests: number
  declined: number
  waitlisted: number
  /** Coaches present (staff-only confirmed + player-coaches confirmed). */
  staffConfirmed: number
  extraConfirmed: number
}

interface Args {
  activityType: Participation['activity_type']
  activityId: string
  /** Pre-fetched participations — skips the internal fetch + realtime subscription. */
  participations?: Participation[]
  coachMemberIds?: string[]
}

/**
 * The RSVP tallies behind ParticipationSummary and RsvpAnswerButtons. One
 * implementation so the counters under a card and the totals inside the answer
 * buttons can never disagree (dedup per member, staff excluded, guests counted
 * on their host's row, mixed-tournament non-member add-on).
 */
export function useParticipationCounts({ activityType, activityId, participations: prefetched, coachMemberIds }: Args): ParticipationCounts {
  const skipFetch = !!prefetched
  const { data: fetchedRaw, isLoading, isError, isPlaceholderData, refetch } = useCollection<Participation>('participations', {
    filter: activityId
      ? { _and: [{ activity_type: { _eq: activityType } }, { activity_id: { _eq: activityId } }] }
      : { id: { _eq: -1 } },
    all: true,
    enabled: !!activityId && !skipFetch,
  })
  const fetched = fetchedRaw ?? []

  // Auto-refresh when participations change (create/update/delete).
  // ⚠ `skipFetch` MUST be the `disabled` argument, not just an early return inside the
  // callback. A guard in the callback still opens the subscription, and the server side
  // is not free: Directus dispatches create/update by calling `readMany` under the
  // SUBSCRIBER's accountability — one permission-filtered `participations` read per
  // subscription, awaited sequentially across every connected client. The home page
  // mounts both the desktop table and the mobile list (CSS-hidden, both in the DOM), so
  // at ~20 rows that was ~20 policy-filtered reads per client per RSVP, every one of
  // them discarded because `prefetched` was already supplying the data. This is the
  // (instances × clients) multiplier that turned the 26.08.2026 participations read
  // from 7s uncontended into 2m05s under load — see DEVLOG 26.08.2026.
  useRealtime('participations', () => { refetch() }, undefined, skipFetch)

  // Mixed tournament: non-member signups (kscw-website form) don't create a
  // participations row (FK to members), so fetch them separately and add to confirmed.
  const isMixedTournament = activityType === 'event' && String(activityId) === MIXED_TOURNAMENT_EVENT_ID
  const [extraConfirmed, setExtraConfirmed] = useState(0)
  // Seeded TRUE for the mixed tournament so the FIRST paint is already "pending".
  // The effect below only runs after that paint, so without this the green tally
  // always rendered the members-only headcount as a settled number and then jumped
  // once the non-member signups landed. Worse on a remount: the participations come
  // back from the TanStack cache instantly while this count — plain component state,
  // uncached — restarts at 0, so the wrong number arrives faster than the right one.
  const [extraLoading, setExtraLoading] = useState(isMixedTournament)
  // Reset the add-on count when the activity stops being the mixed tournament.
  // Adjust-state-during-render instead of a synchronous setState in the effect.
  const [prevIsMixed, setPrevIsMixed] = useState(isMixedTournament)
  if (prevIsMixed !== isMixedTournament) {
    setPrevIsMixed(isMixedTournament)
    setExtraConfirmed(0)
    setExtraLoading(isMixedTournament)
  }
  useEffect(() => {
    // Deliberately no setState for the non-mixed case: the adjust-during-render block
    // above has already put `extraLoading` at false, and a synchronous setState in an
    // effect body is both an eslint error here and an extra render.
    if (!isMixedTournament) return
    let cancelled = false
    kscwApi<{ count: number }>('/public/mixed-tournament/non-member-count')
      .then((r) => { if (!cancelled) { setExtraConfirmed(r?.count ?? 0); setExtraLoading(false) } })
      // Release the gate on failure too. A tally short by the non-member signups is
      // bad; a placeholder that never resolves is worse.
      .catch(() => { if (!cancelled) setExtraLoading(false) })
    return () => { cancelled = true }
  }, [isMixedTournament])

  const data = prefetched ?? fetched

  // Deduplicate by member: when an event has multiple sessions, a member may
  // have several participation records. Pick the "best" status per member
  // (confirmed > tentative > waitlisted > declined) so counters reflect unique members.
  const statusPriority: Record<string, number> = { confirmed: 4, tentative: 3, waitlisted: 2, declined: 1 }
  const deduped = (() => {
    const byMember = new Map<string, Participation>()
    for (const p of data) {
      const existing = byMember.get(p.member)
      if (!existing || (statusPriority[p.status] ?? 0) > (statusPriority[existing.status] ?? 0)) {
        byMember.set(p.member, p)
      }
    }
    return Array.from(byMember.values())
  })()

  // Separate player and staff participations — staff don't count towards totals
  const playerData = deduped.filter(p => !p.is_staff)
  const staffData = deduped.filter(p => p.is_staff)

  const confirmedParts = playerData.filter(p => p.status === 'confirmed')
  const confirmed = confirmedParts.length
  const confirmedGuests = confirmedParts.reduce((sum, p) => sum + (p.guest_count ?? 0), 0)
  const tentativeParts = playerData.filter(p => p.status === 'tentative')
  const tentative = tentativeParts.length
  const tentativeGuests = tentativeParts.reduce((sum, p) => sum + (p.guest_count ?? 0), 0)
  const declinedParts = playerData.filter(p => p.status === 'declined')
  const declined = declinedParts.length
  const waitlisted = playerData.filter(p => p.status === 'waitlisted').length

  // Guests ride on their host's participation row. A host who is out (declined,
  // typically auto-declined while on holiday) can still register a guest — e.g. a
  // tryout player — who IS coming. So a declined host's guests still count toward
  // attendance even though the host themselves is absent.
  const declinedGuests = declinedParts.reduce((sum, p) => sum + (p.guest_count ?? 0), 0)

  // Coach present: count staff-only confirmed + player-coaches confirmed (via coachMemberIds)
  const staffOnlyConfirmed = staffData.filter(p => p.status === 'confirmed')
  const playerCoachConfirmed = coachMemberIds?.length
    ? playerData.filter(p => p.status === 'confirmed' && coachMemberIds.includes(p.member))
    : []
  const staffConfirmed = staffOnlyConfirmed.length + playerCoachConfirmed.length
  const staffConfirmedGuests = staffOnlyConfirmed.reduce((sum, p) => sum + (p.guest_count ?? 0), 0)
  const staffDeclinedGuests = staffData
    .filter(p => p.status === 'declined')
    .reduce((sum, p) => sum + (p.guest_count ?? 0), 0)

  // Total for green counter = players + all guests + extra non-member signups
  // (coaches excluded from number; extraConfirmed is only > 0 for the mixed tournament event)
  const allGuests = confirmedGuests + staffConfirmedGuests + declinedGuests + staffDeclinedGuests
  const confirmedTotal = confirmed + allGuests + extraConfirmed
  const hasGuestBreakdown = allGuests > 0

  // Has every source these counters are summed from actually landed?
  //  • the participations query — skipped entirely when the rows arrive as a prop
  //  • the SAME query on a changed key: `placeholderData: keepPreviousData` is a
  //    global default (src/lib/query.tsx), so a modal swapped onto another activity
  //    gets the PREVIOUS activity's rows — plausible, settled-looking, and wrong
  //  • the non-member add-on above, which is 0 until its own fetch resolves
  // Two escape hatches, both mandatory: `isError`, because TanStack reports
  // `isLoading === false` on a failed fetch while `data` stays undefined (a gate
  // without it swaps a wrong number for a PERMANENT placeholder), and `activityId`,
  // because the query is disabled without one so nothing is ever coming.
  const listPending = !!activityId && !skipFetch && !isError && (isLoading || isPlaceholderData)
  const countsPending = listPending || extraLoading

  return {
    pending: countsPending,
    rowCount: data.length,
    confirmedTotal, confirmed, allGuests, hasGuestBreakdown,
    tentative, tentativeGuests, declined, waitlisted,
    staffConfirmed, extraConfirmed,
  }
}

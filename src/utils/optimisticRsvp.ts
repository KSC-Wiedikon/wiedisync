import type { Participation } from '../types'

type Status = Participation['status']

/**
 * Optimistic RSVP bookkeeping shared by the Yes / Maybe / No writers.
 *
 * The tapped answer is shown while the server still shows a value it may show
 * before the write lands: the value at the moment of the tap (`accept`), plus the
 * answers of earlier taps in the same quick burst (so a double tap does not flash
 * the first answer when its refetch lands). As soon as the server shows anything
 * else, the server wins — the write landed, or the waiting list moved this RSVP
 * (bumped or promoted, migration 437). Before, an optimistic Yes stayed on screen
 * until the card remounted, even after the server had moved the member to the
 * waiting list.
 */
export interface OptimisticRsvp {
  /** The activity (and session) the answer belongs to. */
  key: string
  status: Status
  accept: Array<Status | null>
}

function isLive(opt: OptimisticRsvp | null, key: string, serverStatus: Status | null): opt is OptimisticRsvp {
  return !!opt && opt.key === key && opt.accept.includes(serverStatus)
}

/** The viewer tapped `status` while the server shows `serverStatus`. */
export function optimisticPick(
  prev: OptimisticRsvp | null, key: string, serverStatus: Status | null, status: Status,
): OptimisticRsvp {
  const live = isLive(prev, key, serverStatus) ? prev : null
  return { key, status, accept: live ? [...live.accept, live.status] : [serverStatus] }
}

/**
 * The write came back as `saved` instead of the `requested` answer (a Yes to a
 * full activity is saved as `waitlisted`). Left alone when a later tap already
 * replaced the answer. `requested` leaves `accept`, so a later promotion to
 * `confirmed` is not hidden behind the waiting-list state.
 */
export function optimisticSaved(
  prev: OptimisticRsvp | null, key: string, requested: Status, saved: Status,
): OptimisticRsvp | null {
  if (!prev || prev.key !== key || prev.status !== requested) return prev
  return { key, status: saved, accept: prev.accept.filter((s) => s !== requested) }
}

/** What to show: the optimistic answer while it is live, else the server's. */
export function shownStatus(opt: OptimisticRsvp | null, key: string, serverStatus: Status | null): Status | null {
  return isLive(opt, key, serverStatus) ? opt.status : serverStatus
}

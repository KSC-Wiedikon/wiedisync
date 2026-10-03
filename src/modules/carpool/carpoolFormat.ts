import type { CarpoolBoard, CarpoolDirection, CarpoolKind, CarpoolLeg, CarpoolOffer, CarpoolRequest } from './carpoolApi'

/**
 * Pure helpers for the car pooling UI — kept apart from the components so the
 * rules about what a viewer may do are unit-tested without rendering. The
 * Going and Return boards are separate car pools (migration 393): every rule
 * below except `myRole` is per leg. Within a leg they are per DAY (397): a
 * driver of a two-day tournament has a Saturday and a Sunday car, and a
 * Saturday seat says nothing about Sunday. A ride without a day (old data)
 * matches every day.
 */

const sameDay = (a?: string | null, b?: string | null) => !a || !b || a === b

export const CARPOOL_DIRECTIONS: CarpoolDirection[] = ['there', 'back']
export const CARPOOL_MAX_SEATS = 8

/** Seats the viewer would take when joining on `day`: what they asked for, else one. */
export function seatsINeed(board: CarpoolLeg, day?: string | null): number {
  const mine = board.requests.find((r) => r.mine && sameDay(r.departure_date, day))
  return mine ? mine.seats : 1
}

/** Can the viewer take seat(s) in this offered car? */
export function canJoin(board: CarpoolLeg, offer: CarpoolOffer, open: boolean): boolean {
  if (!open || offer.mine || offer.i_am_passenger) return false
  // Drivers drive, they do not ride — on the day they drive.
  if (board.offers.some((o) => o.mine && sameDay(o.departure_date, offer.departure_date))) return false
  return offer.seats_free >= seatsINeed(board, offer.departure_date)
}

/** Can the viewer (a driver) take this request into their car? */
export function canTake(board: CarpoolLeg, request: CarpoolRequest, open: boolean): boolean {
  if (!open || request.mine || request.covered) return false
  const myOffer = board.offers.find((o) => o.mine && sameDay(o.departure_date, request.departure_date))
  return !!myOffer && myOffer.seats_free >= request.seats
}

/**
 * Can the viewer post a request? On a one-day activity not while already
 * riding or driving. A multi-day one always offers the button: the day is
 * picked in the form, which warns about a day that already has a ride.
 */
export function canRequest(board: CarpoolLeg, open: boolean, multiDay = false): boolean {
  if (!open) return false
  return multiDay || (board.mine.request == null && board.mine.offer == null && board.mine.riding_in.length === 0)
}

/** Can the viewer offer a ride? On a one-day activity not while riding in someone else's car. */
export function canOffer(board: CarpoolLeg, open: boolean, multiDay = false): boolean {
  if (!open) return false
  return multiDay || (board.mine.offer == null && board.mine.riding_in.length === 0)
}

/** Days on which the viewer already has an entry of `kind` on this leg (one per day, 397). */
export function myRideDays(board: CarpoolLeg, kind: CarpoolKind, exceptId?: number): string[] {
  const rows: (CarpoolOffer | CarpoolRequest)[] = kind === 'offer' ? board.offers : board.requests
  return rows.filter((e) => e.mine && e.id !== exceptId && e.departure_date).map((e) => e.departure_date!)
}

/** Every calendar day from `first` to `last` (YYYY-MM-DD), at most 31. */
export function activityDays(first?: string | null, last?: string | null): string[] {
  if (!first) return []
  const out: string[] = []
  const end = last && last > first ? last : first
  for (let d = new Date(`${first}T12:00:00Z`); out.length < 31; d = new Date(d.getTime() + 86400000)) {
    const s = d.toISOString().slice(0, 10)
    if (s > end) break
    out.push(s)
  }
  return out
}

/** The first of `days` without a ride yet, else `fallback`. */
export function firstFreeDay(days: readonly string[], taken: readonly string[], fallback: string | null): string | null {
  return days.find((d) => !taken.includes(d)) ?? fallback
}

/** The viewer's role on one leg (or across both), for the badges. */
export function myRole(board: CarpoolLeg | CarpoolBoard): 'driver' | 'passenger' | 'requester' | null {
  const legs = 'there' in board ? [board.there, board.back] : [board]
  if (legs.some((l) => l.mine.offer != null)) return 'driver'
  if (legs.some((l) => l.mine.riding_in.length > 0)) return 'passenger'
  if (legs.some((l) => l.mine.request != null)) return 'requester'
  return null
}

/** Rides (offers + requests) on a leg, or on both. */
export function entryCount(board: CarpoolLeg | CarpoolBoard): number {
  const legs = 'there' in board ? [board.there, board.back] : [board]
  return legs.reduce((n, l) => n + l.offers.length + l.requests.length, 0)
}

/**
 * Is the viewer inside a board's team scope (migration 379)? Mirrors the
 * server's check minus the "already riding" exemption — used only to decide
 * whether a card shows the chip; the server stays the authority.
 */
export function inCarpoolScope(scope: readonly (string | number)[] | null | undefined, myTeamIds: readonly (string | number)[]): boolean {
  if (!scope || scope.length === 0) return true
  const mine = new Set(myTeamIds.map(String))
  return scope.some((t) => mine.has(String(t)))
}

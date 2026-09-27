import type { CarpoolBoard, CarpoolDirection, CarpoolOffer, CarpoolRequest } from './carpoolApi'

/**
 * Pure helpers for the car pooling UI — kept apart from the components so the
 * rules about what a viewer may do are unit-tested without rendering.
 */

export const CARPOOL_DIRECTIONS: CarpoolDirection[] = ['both', 'there', 'back']
export const CARPOOL_MAX_SEATS = 8

/** Seats the viewer would take when joining: what they asked for, else one. */
export function seatsINeed(board: CarpoolBoard): number {
  const mine = board.requests.find((r) => r.mine)
  return mine ? mine.seats : 1
}

/** Can the viewer take seat(s) in this offered car? */
export function canJoin(board: CarpoolBoard, offer: CarpoolOffer, open: boolean): boolean {
  if (!open || offer.mine || offer.i_am_passenger) return false
  if (board.mine.offer != null) return false // drivers drive, they do not ride
  return offer.seats_free >= seatsINeed(board)
}

/** Can the viewer (a driver) take this request into their car? */
export function canTake(board: CarpoolBoard, request: CarpoolRequest, open: boolean): boolean {
  if (!open || request.mine || request.covered) return false
  const myOffer = board.offers.find((o) => o.mine)
  return !!myOffer && myOffer.seats_free >= request.seats
}

/** Can the viewer post a request? Not while already riding or driving. */
export function canRequest(board: CarpoolBoard, open: boolean): boolean {
  return open && board.mine.request == null && board.mine.offer == null && board.mine.riding_in.length === 0
}

/** Can the viewer offer a ride? Not while riding in someone else's car. */
export function canOffer(board: CarpoolBoard, open: boolean): boolean {
  return open && board.mine.offer == null && board.mine.riding_in.length === 0
}

/** The viewer's role on this board, for the banner badge. */
export function myRole(board: CarpoolBoard): 'driver' | 'passenger' | 'requester' | null {
  if (board.mine.offer != null) return 'driver'
  if (board.mine.riding_in.length > 0) return 'passenger'
  if (board.mine.request != null) return 'requester'
  return null
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

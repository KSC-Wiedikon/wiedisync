import type { Participation } from '../types'

/** The three RSVP statuses a member can pick on a card or detail modal. */
export type RsvpStatus = Extract<Participation['status'], 'confirmed' | 'tentative' | 'declined'>

// Brick-tone fill + text per status — mirrors the ParticipationSummary bars so
// an RSVP option pill reads as the same colour as its summary brick.
const RSVP_TINT: Record<RsvpStatus, string> = {
  confirmed: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300',
  tentative: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300',
  declined: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300',
}

// Ring that lights up the selected option.
const RSVP_RING: Record<RsvpStatus, string> = {
  confirmed: 'ring-1 ring-green-500 dark:ring-green-400',
  tentative: 'ring-1 ring-yellow-500 dark:ring-yellow-400',
  declined: 'ring-1 ring-red-500 dark:ring-red-400',
}

/**
 * Tailwind classes for one RSVP option pill, matching the summary bricks.
 * Every option keeps its own hue; the selected one stays at full opacity with a
 * coloured ring, the rest fade back and brighten on hover. Shared by the game /
 * training / event cards and their detail modals so all RSVP controls look the
 * same.
 */
export function rsvpButtonClass(status: RsvpStatus, active: boolean): string {
  return `${RSVP_TINT[status]} ${active ? `opacity-100 ${RSVP_RING[status]}` : 'opacity-40 hover:opacity-100'}`
}

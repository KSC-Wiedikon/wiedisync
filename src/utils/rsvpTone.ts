import type { RowTone } from '../components/activityRowTokens'

/**
 * The viewer's own RSVP → the card's state stripe (RowStripe) + rail tone.
 * Replaces the per-card `statusBorderColor` maps. `mixed` is a per-day event
 * the member answered differently per day — it has no single answer colour, so
 * it gets its own (sky) instead of the old green→red gradient bar.
 */
export function rsvpTone(status: string | null | undefined): RowTone {
  switch (status) {
    case 'confirmed': return 'green'
    case 'tentative': return 'amber'
    case 'waitlisted': return 'amber'
    case 'declined': return 'red'
    case 'mixed': return 'sky'
    default: return 'gray'
  }
}

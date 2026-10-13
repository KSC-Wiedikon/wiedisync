import type { Training } from '../../types'

/**
 * Why a live training runs shorter than its planned slot, or null.
 *   'game' — another team's home-game warm-up cut the end (migration 191).
 *   'hall' — a timed entry on the hall administration's calendar booked part
 *            of the time (migration 409). A row carrying that marker WITHOUT
 *            original times is a training a coach reinstated by hand: not
 *            shortened.
 */
export function shortenedBy(training: Training): 'game' | 'hall' | null {
  if (training.cancelled) return null
  if (training.auto_shortened_by_game != null) return 'game'
  if (training.auto_adjusted_by_booking != null
    && (training.original_start_time != null || training.original_end_time != null)) return 'hall'
  return null
}

/** The planned slot of a shortened training, "18:00–19:30". */
export function plannedTimeRange(training: Training): string {
  const start = (training.original_start_time ?? training.start_time ?? '').slice(0, 5)
  const end = (training.original_end_time ?? training.end_time ?? '').slice(0, 5)
  return `${start}–${end}`
}

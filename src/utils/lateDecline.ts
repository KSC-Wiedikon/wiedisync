import type { Participation } from '../types'

/**
 * After the respond-by deadline every answer is locked — except a No from somebody
 * the waiting list is holding (owner, 30.10.2026): they are on the waiting list, or
 * were moved up from it after the deadline (`promoted_at`, migration 438). Saying No
 * hands their place to the next person in line instead of leaving it empty.
 */
export function mayDeclineAfterDeadline(
  p: Pick<Participation, 'status'> & { promoted_at?: string | null } | null | undefined,
  deadline: Date | null | undefined,
): boolean {
  if (!p || !deadline) return false
  if (p.status === 'waitlisted') return true
  if (p.status !== 'confirmed' && p.status !== 'tentative') return false
  if (!p.promoted_at) return false
  const promoted = new Date(p.promoted_at)
  return !Number.isNaN(promoted.getTime()) && promoted >= deadline
}

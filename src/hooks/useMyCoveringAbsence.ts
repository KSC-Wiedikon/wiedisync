import { useMemo } from 'react'
import { useCollection } from '../lib/query'
import { useAuth } from './useAuth'
import { absenceCoversActivity } from '../utils/absenceHelpers'
import type { Absence, Participation } from '../types'

/**
 * Every field `absenceCoversActivity` + `useAbsenceNoteText` read. Module-level
 * so the array's *contents* are identical on every render — `useCollection`
 * hashes the options object into the query key, so a fresh literal here would
 * give each caller its own cache entry and undo the sharing below.
 *
 * ⚠ `indefinite` must stay in this list. Without it the helper sees `undefined`
 * and falls back to comparing `end_date`, which only happens to work because
 * migration 233's trigger normalizes an indefinite row's end_date to 2099-12-31.
 */
const MY_ABSENCE_FIELDS: string[] = [
  'id', 'member', 'start_date', 'end_date', 'indefinite',
  'affects', 'type', 'days_of_week', 'reason',
]

export function useMyCoveringAbsence(
  activityType: Participation['activity_type'],
  activityDate: string | undefined,
): { absence: Absence | null; hasAbsence: boolean; isLoading: boolean } {
  const { user } = useAuth()
  const dateOnly = activityDate?.split(' ')[0]?.split('T')[0] ?? ''
  const enabled = !!user && !!dateOnly

  // ⚠⚠ The filter is deliberately DATE-FREE, and must stay that way.
  //
  // This hook runs once per activity card (TrainingCard, GameCard, EventCard,
  // ParticipationButton, the calendar modal). It used to filter on the card's
  // own date — `start_date <= D AND end_date >= D` — which made every card its
  // own query key, so a season-long Trainings page fired one `/items/absences`
  // request per training. Each URL was unique, so each also needed its own CORS
  // preflight: one real page load measured on prod (2026-08-25) was 155 HTTP
  // requests, 94 of them this hook. Directus then queued them against itself and
  // the same trivial query on a 260-row table went from 48ms to 658ms.
  //
  // Filtering on the member alone gives every caller an identical query key, so
  // React Query collapses all of them into ONE request and serves the rest from
  // cache. A member holds a handful of absence rows, so fetching them all and
  // matching in JS is cheaper than a single one of the old round trips.
  const { data, isLoading } = useCollection<Absence>('absences', {
    filter: user ? { member: { _eq: user.id } } : undefined,
    fields: MY_ABSENCE_FIELDS,
    all: true,
    enabled: !!user,
  })

  return useMemo(() => {
    const absences = data ?? []
    const match = dateOnly
      ? absences.find((a) => absenceCoversActivity(a, activityType, dateOnly)) ?? null
      : null
    return { absence: match, hasAbsence: !!match, isLoading: enabled && isLoading }
  }, [data, activityType, dateOnly, enabled, isLoading])
}

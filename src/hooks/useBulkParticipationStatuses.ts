import { useMemo } from 'react'
import { useCollection } from '../lib/query'
import { useAuth } from './useAuth'
import { useRealtime } from './useRealtime'
import type { Participation, Absence } from '../types'
import { absenceCoversActivity } from '../utils/absenceHelpers'

/**
 * Bulk-fetch participation statuses for multiple activities in just 2 queries
 * (1 for participations, 1 for absences) instead of 2 per row.
 *
 * Includes realtime subscription so banners update when participation changes.
 * Returns a Map<activityId, effectiveStatus> that row components can look up.
 */
export function useBulkParticipationStatuses(
  activities: Array<{ id: string; type: Participation['activity_type']; date: string }>,
) {
  const { user } = useAuth()

  // Build a single filter for all participations: member=X && activity_type ∈ types
  // && activity_id ∈ ids. We MUST filter on activity_type as well — `(type, id)`
  // is the natural composite key for `participations`. A user can have separate
  // rows for `training:4` and `event:4` with different statuses; without the
  // type filter the JS map below collides them and the wrong row wins.
  const activityTypes = useMemo(() => Array.from(new Set(activities.map(a => a.type))), [activities])
  const activityIds = useMemo(() => activities.map(a => a.id), [activities])
  // Sentinel rather than `undefined` for the same reason as `useBulkParticipations`
  // below — a falsy filter is dropped by `buildQuery` and `all: true` forces
  // `limit: -1`, so the empty case would read the whole table. This hook's realtime
  // guard checks `e.record.member`, which is absent on a delete frame, so it is not
  // reachable the way the other one was — but the trap is identical and one line.
  const participationFilter = useMemo((): Record<string, unknown> => {
    if (!user || activities.length === 0) return { activity_id: { _in: [-1] } }
    return { _and: [
      { member: { _eq: user.id } },
      { activity_type: { _in: activityTypes } },
      { activity_id: { _in: activityIds } },
    ] }
  }, [user, activities, activityTypes, activityIds])

  // Determine date range for absences
  const { minDate, maxDate } = useMemo(() => {
    if (activities.length === 0) return { minDate: '', maxDate: '' }
    const dates = activities.map((a) => a.date).filter(Boolean).sort()
    return { minDate: dates[0] ?? '', maxDate: dates[dates.length - 1] ?? '' }
  }, [activities])

  const absenceFilter = useMemo((): Record<string, unknown> | undefined => {
    if (!user || !minDate || !maxDate) return undefined
    return { _and: [{ member: { _eq: user.id } }, { start_date: { _lte: maxDate } }, { end_date: { _gte: minDate } }] }
  }, [user, minDate, maxDate])

  const { data: participationsRaw, isLoading: partLoading, refetch: refetchParticipations } = useCollection<Participation>('participations', {
    filter: participationFilter,
    all: true,
    enabled: !!user && activities.length > 0,
  })
  const participations = participationsRaw ?? []

  const { data: absencesRaw, isLoading: absLoading } = useCollection<Absence>('absences', {
    filter: absenceFilter,
    limit: 50,
    enabled: !!user && !!minDate,
  })
  const absences = absencesRaw ?? []

  // Realtime: refetch when any participation for the current user changes
  const activityIdSet = useMemo(() => new Set(activities.map((a) => a.id)), [activities])
  useRealtime<Participation>('participations', (e) => {
    if (e.record.member === user?.id && activityIdSet.has(e.record.activity_id)) {
      refetchParticipations()
    }
  })

  const isLoading = partLoading || absLoading

  // Build lookup keyed by composite `type:id`. The numeric id alone is unsafe
  // when callers iterate mixed activity types (the home page passes trainings,
  // games and events together). A `training:1 declined` would otherwise be
  // overwritten by an `event:1 confirmed` for the same member, painting the
  // training row green. v4.4.12 fixed the input filter and `partByKey` lookup
  // but missed the output map — this is the rest of that fix.
  const statusMap = useMemo(() => {
    const map = new Map<string, Participation['status'] | 'absent'>()
    if (!user) return map

    const partByKey = new Map<string, Participation>()
    for (const p of participations) {
      partByKey.set(`${p.activity_type}:${p.activity_id}`, p)
    }

    for (const activity of activities) {
      const key = `${activity.type}:${activity.id}`
      const participation = partByKey.get(key)

      // Check if any absence covers this activity's date and type
      const hasAbsence = absences.some((a) => absenceCoversActivity(a, activity.type, activity.date))

      if (participation) {
        map.set(key, participation.status)
      } else if (hasAbsence) {
        // Will be auto-declined by useParticipation when the detail modal opens
        map.set(key, 'declined')
      }
    }

    return map
  }, [user, participations, absences, activities])

  const getStatus = useMemo(
    () => (type: Participation['activity_type'], id: string) => statusMap.get(`${type}:${id}`),
    [statusMap],
  )

  return { statusMap, getStatus, isLoading }
}

const EMPTY_PARTICIPATIONS: Participation[] = []

/**
 * Bulk-fetch ALL participation rows (every member, not just the current user)
 * for multiple activities in a single query, so the ParticipationSummary
 * counter bricks can render with the initial page paint instead of firing one
 * query per row after reveal.
 *
 * Pass the result to `<ParticipationSummary participations={...} />` — the
 * prefetched prop makes the component skip its own fetch. `getParticipations`
 * returns a (stable) empty array for activities with no rows so consumers
 * never fall back to self-fetching.
 *
 * Grouped `_or` per activity_type because `(type, id)` is the composite key —
 * a flat `type IN … AND id IN …` cross-product would over-fetch rows for
 * unrelated activities that happen to share a numeric id.
 */
export function useBulkParticipations(
  activities: Array<{ id: string; type: Participation['activity_type'] }>,
) {
  const { user } = useAuth()

  // ⚠⚠ NEVER return `undefined` here. `buildQuery` drops a falsy filter
  // (`src/lib/api.ts` — `if (query?.filter)`), and `fetchAllItems` forces `limit: -1`,
  // so an empty `activities` array would send `GET /items/participations?limit=-1`
  // with NO filter — a full-table read of every RSVP the policy lets you see, all of
  // which is then discarded because `byActivity` is keyed on an empty array.
  // `enabled` does not save us: TanStack's `refetch()` calls `fetch()` directly and
  // consults `enabled` only on mount/optional refetch, and the realtime handler below
  // calls `refetch()`. The empty window is reachable on the home page's hot path
  // (`allActivities` is `[]` until everything loads) and stays open permanently for a
  // teamless member, off-season, or during the season-rollover gap.
  // Same impossible-match sentinel the other participations consumers already use
  // (`EventsPage.tsx`, `EventCard.tsx`, `SessionParticipationSheet.tsx`).
  const filter = useMemo((): Record<string, unknown> => {
    if (!user || activities.length === 0) return { activity_id: { _in: [-1] } }
    const idsByType = new Map<string, string[]>()
    for (const a of activities) {
      const ids = idsByType.get(a.type) ?? []
      ids.push(a.id)
      idsByType.set(a.type, ids)
    }
    const groups = Array.from(idsByType.entries()).map(([type, ids]) => ({
      _and: [{ activity_type: { _eq: type } }, { activity_id: { _in: ids } }],
    }))
    return groups.length === 1 ? groups[0] : { _or: groups }
  }, [user, activities])

  const { data: rowsRaw, isLoading, refetch } = useCollection<Participation>('participations', {
    filter,
    all: true,
    enabled: !!user && activities.length > 0,
  })

  // Realtime: with prefetched data the bricks skip their own realtime refetch,
  // so live updates must come from here. Delete payloads may carry only the PK
  // — refetch on those too rather than going stale.
  const activityIdSet = useMemo(() => new Set(activities.map((a) => a.id)), [activities])
  // ⚠ A DELETE frame carries primary keys, not records, so `e.record.activity_id` is
  // ALWAYS undefined on a delete — the `!e.record.activity_id` arm therefore fired for
  // every participation delete anywhere in the club, on every connected client, and
  // `refetch()` bypasses `enabled`. Deletes are also the one action Directus does NOT
  // permission-filter before dispatching, so this was genuinely club-wide fan-out.
  // Keeping the arm (a delete we cannot identify may well be one of ours) but gating it
  // on actually having something to refetch, so the empty window can never issue the
  // unfiltered read the sentinel above now also guards.
  useRealtime<Participation>('participations', (e) => {
    if (activities.length === 0) return
    if (!e.record.activity_id || activityIdSet.has(String(e.record.activity_id))) refetch()
  }, undefined, activities.length === 0)

  const byActivity = useMemo(() => {
    const map = new Map<string, Participation[]>()
    for (const p of rowsRaw ?? []) {
      const key = `${p.activity_type}:${p.activity_id}`
      const list = map.get(key)
      if (list) list.push(p)
      else map.set(key, [p])
    }
    return map
  }, [rowsRaw])

  const getParticipations = useMemo(
    () => (type: Participation['activity_type'], id: string) =>
      byActivity.get(`${type}:${id}`) ?? EMPTY_PARTICIPATIONS,
    [byActivity],
  )

  return { getParticipations, isLoading }
}

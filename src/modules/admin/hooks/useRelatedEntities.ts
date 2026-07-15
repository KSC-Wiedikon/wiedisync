import { useCallback, useState } from 'react'
import { readItems } from '@directus/sdk'
import { client } from '../../../lib/api'
import type { BucketKey } from '../components/explorerHelpers'

export type SectionKey =
  | 'participations'
  | 'absences'
  | 'refereeExpenses'
  | 'scorerDelegations'
  | 'hallSlots'
  | 'inactiveMembers'

interface CachedEntry {
  data: unknown[]
  loading: boolean
  error: Error | null
  // Distinguishes "fetched, legitimately empty" from "never fetched" so a
  // section with zero rows isn't re-queried on every re-expand.
  loaded: boolean
}

type CacheMap = Record<string, CachedEntry>

/**
 * Directus query per (parent type, section) combination. Returns query params
 * to pass to the SDK. For sections that don't apply to a parent type,
 * these may return empty / mismatched filters — but the UI only renders
 * sections relevant to the parent type, so those combinations won't fire.
 */
const QUERIES: Record<
  SectionKey,
  (
    parent: BucketKey,
    id: string,
  ) => {
    collection: string
    filter: Record<string, unknown>
    fields?: string[]
    sort?: string[]
  }
> = {
  participations: (parent, id) => ({
    collection: 'participations',
    filter:
      parent === 'members'
        ? { member: { _eq: id } }
        : {
            _and: [
              // 'events' -> 'event', 'trainings' -> 'training', 'games' -> 'game'
              { activity_type: { _eq: parent.slice(0, -1) } },
              { activity_id: { _eq: id } },
            ],
          },
    fields: [
      'id',
      'member',
      'activity_type',
      'activity_id',
      'status',
      'note',
      'waitlisted_at',
      'date_created',
    ],
    sort: ['-date_created'],
  }),
  absences: (_parent, id) => ({
    collection: 'absences',
    filter: { member: { _eq: id } },
    fields: ['id', 'member', 'start_date', 'end_date', 'reason', 'affects'],
    sort: ['-start_date'],
  }),
  refereeExpenses: (_parent, id) => ({
    collection: 'referee_expenses',
    filter: { paid_by_member: { _eq: id } },
    fields: ['id', 'paid_by_member', 'game', 'team', 'amount', 'notes', 'date_created'],
    sort: ['-date_created'],
  }),
  scorerDelegations: (_parent, id) => ({
    collection: 'scorer_delegations',
    filter: { game: { _eq: id } },
    fields: ['id', 'game', 'from_member', 'to_member', 'status', 'role', 'date_created'],
  }),
  // Recurring hall slots assigned to a team (M2M via hall_slots_teams). Matches
  // the proven TrainingForm filter so the same junction walk applies.
  hallSlots: (_parent, id) => ({
    collection: 'hall_slots',
    filter: { teams: { teams_id: { _eq: id } } },
    fields: ['id', 'day_of_week', 'start_time', 'end_time', 'slot_type', 'label', 'hall.name'],
    sort: ['day_of_week', 'start_time'],
  }),
  // Deactivated members who still hold a member_teams row for this team. The
  // page-load cache only loads active members, so these never show otherwise.
  inactiveMembers: (_parent, id) => ({
    collection: 'member_teams',
    filter: { _and: [{ team: { _eq: id } }, { member: { kscw_membership_active: { _eq: false } } }] },
    fields: ['id', 'guest_level', 'member.id', 'member.first_name', 'member.last_name', 'member.nickname', 'member.number'],
    sort: ['member.last_name'],
  }),
}

const cacheKey = (parent: BucketKey, id: string, section: SectionKey, epoch: number) =>
  `${parent}:${id}:${section}:${epoch}`

/**
 * Lazy loader keyed per (parent, id, section). Consumers call `load()` on
 * first expansion of a section; `get()` returns the cached state. `clearAll()`
 * invalidates every cached entry (bumps the internal epoch — e.g. when the
 * page-load cache is refreshed).
 *
 * Uses the Directus SDK client directly (bypasses captureApiError) so that
 * 403s on restricted collections (e.g. referee_expenses for non-admins)
 * are silently swallowed instead of spamming Sentry.
 */
export function useRelatedEntities() {
  const [cache, setCache] = useState<CacheMap>({})
  const [epoch, setEpoch] = useState(0)

  const load = useCallback(
    async (parent: BucketKey, id: string, section: SectionKey) => {
      const key = cacheKey(parent, id, section, epoch)
      // A prior successful load (even one that returned []) or an in-flight
      // request short-circuits; errored entries stay `loaded: false` so a
      // re-expand can retry them.
      if (cache[key]?.loaded || cache[key]?.loading) return
      setCache((c) => ({ ...c, [key]: { data: [], loading: true, error: null, loaded: false } }))
      try {
        const q = QUERIES[section](parent, id)
        const data = await client.request(
          readItems(q.collection as Parameters<typeof readItems>[0], {
            filter: q.filter,
            fields: q.fields as string[],
            sort: q.sort as string[],
            limit: -1,
          }),
        ) as unknown[]
        setCache((c) => ({ ...c, [key]: { data, loading: false, error: null, loaded: true } }))
      } catch (err) {
        // Silently set error state — no Sentry capture
        setCache((c) => ({
          ...c,
          [key]: { data: [], loading: false, error: err as Error, loaded: false },
        }))
      }
    },
    [cache, epoch],
  )

  const get = useCallback(
    (parent: BucketKey, id: string, section: SectionKey): CachedEntry | null =>
      cache[cacheKey(parent, id, section, epoch)] ?? null,
    [cache, epoch],
  )

  const clearAll = useCallback(() => {
    setCache({})
    setEpoch((e) => e + 1)
  }, [])

  return { load, get, clearAll }
}

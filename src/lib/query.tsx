/**
 * TanStack Query integration — provides the QueryClientProvider
 * and reusable hook factories for Directus collections.
 *
 * Usage:
 *   const { data, isLoading } = useCollection('teams', { filter: { active: { _eq: true } } })
 *   const { mutate } = useCreate('participations')
 */

import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { fetchItems, fetchAllItems, fetchItem, countItems, aggregateItems, createRecord, updateRecord, deleteRecord, kscwApi, stringifyIds } from './api'
import { captureApiError } from './sentry'

// ── Query Client ────────────────────────────────────────────────────

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,        // 30s before refetch
      gcTime: 5 * 60_000,       // 5min garbage collection
      refetchOnWindowFocus: false,
      retry: 1,
      // Keep showing the previous result while a query with a changed key (e.g. a new
      // fiscal year / filter) refetches — no blank/“whole page reloading” flash.
      placeholderData: keepPreviousData,
    },
    mutations: {
      onError: (error) => {
        // Global fallback — individual api.ts helpers already capture with full context,
        // but this catches anything that slips through (e.g. post-mutation logic errors)
        captureApiError(error, { operation: 'mutation_global_fallback' })
      },
    },
  },
})

export function QueryProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

// ── Query key factory ───────────────────────────────────────────────

export const keys = {
  collection: (name: string) => [name] as const,
  list: (name: string, query?: Record<string, unknown>) =>
    query ? [name, 'list', query] as const : [name, 'list'] as const,
  detail: (name: string, id: string | number) => [name, 'detail', id] as const,
  count: (name: string, filter?: Record<string, unknown>) =>
    filter ? [name, 'count', filter] as const : [name, 'count'] as const,
}

// ── Collection query hook ───────────────────────────────────────────

interface UseCollectionOptions {
  filter?: Record<string, unknown>
  sort?: string | string[]
  fields?: string[]
  limit?: number
  offset?: number
  deep?: Record<string, unknown>
  search?: string
  enabled?: boolean
  /** Fetch all items (limit: -1). Default false. */
  all?: boolean
  /** Stale time override in ms. */
  staleTime?: number
}

/**
 * Fetch items from a Directus collection with automatic caching.
 */
export function useCollection<T = Record<string, unknown>>(
  collection: string,
  options?: UseCollectionOptions,
) {
  const {
    filter, sort, fields, limit, offset, deep, search,
    enabled = true, all = false, staleTime,
  } = options ?? {}

  const sortArr = sort ? (Array.isArray(sort) ? sort : sort.split(',').map(s => s.trim())) : undefined
  const queryOpts = { filter, sort: sortArr, fields, deep, search, limit: all ? -1 : limit, offset }

  return useQuery<T[]>({
    queryKey: keys.list(collection, queryOpts as Record<string, unknown>),
    queryFn: () => all
      ? fetchAllItems<T>(collection, { filter, sort: sortArr, fields, deep })
      : fetchItems<T>(collection, { filter, sort: sortArr, fields, limit, offset, deep, search }),
    enabled,
    staleTime,
  })
}

// ── Combined activity + participations hook ─────────────────────────

interface UseActivitiesWithParticipationsOptions {
  filter?: Record<string, unknown>
  sort?: string | string[]
  fields?: string[]
  limit?: number
  offset?: number
  /** Fields to fetch on each participation row. Endpoint has a safe default. */
  participationFields?: string[]
  enabled?: boolean
  staleTime?: number
}

/**
 * Fetch activities (games or trainings) AND their participations in one
 * HTTP round-trip via `POST /kscw/activities/:type/with-participations`.
 *
 * Eliminates the waterfall where the client fetches activities first, then
 * issues a second request for participations keyed by activity IDs.
 * Permissions are enforced server-side with the requester's accountability.
 */
export function useActivitiesWithParticipations<T = Record<string, unknown>, P = Record<string, unknown>>(
  type: 'game' | 'training',
  options?: UseActivitiesWithParticipationsOptions,
) {
  const {
    filter, sort, fields, limit, offset, participationFields,
    enabled = true, staleTime,
  } = options ?? {}

  const sortArr = sort ? (Array.isArray(sort) ? sort : sort.split(',').map(s => s.trim())) : undefined
  const body = {
    filter,
    sort: sortArr,
    fields,
    limit,
    offset,
    participation_fields: participationFields,
  }

  return useQuery<{ items: T[]; participations: P[] }>({
    queryKey: ['activities-with-participations', type, body],
    queryFn: async () => {
      const resp = await kscwApi<{ data: { items: T[]; participations: P[] } }>(
        `/activities/${type}/with-participations`,
        { method: 'POST', body },
      )
      // Match the rest of the app's convention (see fetchItems → stringifyIds):
      // stringify integer FKs so comparisons like `p.member === user.id` work
      // across both the standard REST path and this custom endpoint.
      return {
        items: stringifyIds(resp.data.items),
        participations: stringifyIds(resp.data.participations),
      }
    },
    enabled,
    staleTime,
  })
}

/** Fetch a single item by ID. */
export function useItem<T = Record<string, unknown>>(
  collection: string,
  id: string | number | null | undefined,
  options?: { fields?: string[]; enabled?: boolean },
) {
  return useQuery<T>({
    // `enabled: id != null` gates the query, so the sentinel key + guard below are
    // only ever hit when id is set — no `!` assertion needed to satisfy the types.
    queryKey: keys.detail(collection, id ?? ''),
    queryFn: () => {
      if (id == null) return Promise.reject(new Error('useItem called without an id'))
      return fetchItem<T>(collection, id, { fields: options?.fields })
    },
    enabled: (options?.enabled ?? true) && id != null,
  })
}

/** Count items in a collection. */
export function useCount(
  collection: string,
  filter?: Record<string, unknown>,
  options?: { enabled?: boolean },
) {
  return useQuery<number>({
    queryKey: keys.count(collection, filter),
    queryFn: () => countItems(collection, filter),
    enabled: options?.enabled ?? true,
  })
}

interface UseAggregateOptions {
  aggregate: Record<string, string | string[]>
  groupBy?: string[]
  filter?: Record<string, unknown>
  sort?: string[]
  enabled?: boolean
  staleTime?: number
}

/**
 * Run a Directus aggregate/`groupBy` query with caching. Lets a view compute
 * grouped totals (e.g. players vs guests per team) without pulling every row.
 * The key is prefixed with the collection so `invalidateForCollection(collection)`
 * (and any `keys.collection(collection)` invalidation) refetches it too.
 */
export function useAggregate<R = Record<string, unknown>>(
  collection: string,
  options: UseAggregateOptions,
) {
  const { aggregate, groupBy, filter, sort, enabled = true, staleTime } = options
  return useQuery<R[]>({
    queryKey: [collection, 'aggregate', { aggregate, groupBy, filter, sort }],
    queryFn: () => aggregateItems<R>(collection, { aggregate, groupBy, filter, sort }),
    enabled,
    staleTime,
  })
}

// ── Mutation hooks ──────────────────────────────────────────────────

/**
 * Invalidate the caches that depend on a mutated collection. Shared by the
 * TanStack `useCreate`/`useUpdate`/`useDelete` hooks AND the legacy
 * `hooks/useMutation.ts` wrapper so every write refreshes the same set of keys.
 *
 * The combined activities+participations query (games / trainings pages) lives
 * under its OWN key (`['activities-with-participations', …]`), so the standard
 * `keys.collection('participations')` = `['participations']` invalidation misses
 * it. Without this, clicking an RSVP in the game/training detail modal left the
 * card grid's participation counter + the viewer's own "reply" banner stale until
 * a manual reload — realtime was the only other refresh path and isn't guaranteed
 * on mobile / PWA.
 */
export function invalidateForCollection(collection: string) {
  queryClient.invalidateQueries({ queryKey: keys.collection(collection) })
  if (collection === 'participations') {
    queryClient.invalidateQueries({ queryKey: ['activities-with-participations'] })
  }
}

interface MutationCallbacks<T = Record<string, unknown>> {
  onSuccess?: (data: T) => void
  onError?: (error: Error) => void
}

/** Create a record in a collection. Invalidates the collection cache. */
export function useCreate<T = Record<string, unknown>>(
  collection: string,
  callbacks?: MutationCallbacks<T>,
) {
  return useMutation<T, Error, Record<string, unknown>>({
    mutationFn: (data) => createRecord<T>(collection, data),
    onSuccess: (data) => {
      invalidateForCollection(collection)
      callbacks?.onSuccess?.(data)
    },
    onError: (error) => {
      captureApiError(error, { operation: 'useCreate', collection })
      callbacks?.onError?.(error)
    },
  })
}

/** Update a record. Invalidates the collection cache. */
export function useUpdate<T = Record<string, unknown>>(
  collection: string,
  callbacks?: MutationCallbacks<T>,
) {
  return useMutation<T, Error, { id: string | number; data: Record<string, unknown> }>({
    mutationFn: ({ id, data }) => updateRecord<T>(collection, id, data),
    onSuccess: (data) => {
      invalidateForCollection(collection)
      callbacks?.onSuccess?.(data)
    },
    onError: (error, variables) => {
      captureApiError(error, { operation: 'useUpdate', collection, recordId: variables.id })
      callbacks?.onError?.(error)
    },
  })
}

/** Delete a record. Invalidates the collection cache. */
export function useDelete(
  collection: string,
  callbacks?: MutationCallbacks<void>,
) {
  return useMutation<void, Error, string | number>({
    mutationFn: (id) => deleteRecord(collection, id),
    onSuccess: () => {
      invalidateForCollection(collection)
      callbacks?.onSuccess?.(undefined)
    },
    onError: (error, id) => {
      captureApiError(error, { operation: 'useDelete', collection, recordId: id })
      callbacks?.onError?.(error)
    },
  })
}

/** Invalidate all queries for a collection (triggers refetch). */
export function useInvalidate() {
  const qc = useQueryClient()
  return (collection: string) => qc.invalidateQueries({ queryKey: keys.collection(collection) })
}

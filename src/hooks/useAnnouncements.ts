import { useState, useEffect, useCallback, useMemo } from 'react'
import { fetchItems } from '../lib/api'
import { useAuth } from './useAuth'
import { useRealtime } from './useRealtime'
import type { Announcement, AnnouncementLocale, AnnouncementTranslation } from '../types'

const FALLBACK_CHAIN: AnnouncementLocale[] = ['de', 'en', 'fr', 'gsw', 'it']

/**
 * Resolve translation for current locale with fallback chain:
 * requested → de → en → first available.
 */
export function pickTranslation(
  translations: Announcement['translations'] | undefined,
  locale: string,
): AnnouncementTranslation {
  const t = translations ?? {}
  const candidates: AnnouncementLocale[] = [
    locale.slice(0, 3) as AnnouncementLocale,
    locale.slice(0, 2) as AnnouncementLocale,
    ...FALLBACK_CHAIN,
  ]
  for (const code of candidates) {
    const entry = t[code]
    if (entry?.title) return entry
  }
  // Last resort — return the first defined entry
  const first = Object.values(t).find((v): v is AnnouncementTranslation => !!v?.title)
  return first ?? { title: '', body: '' }
}

/**
 * Fetch published announcements visible to the current user, sorted with
 * pinned first then newest published_at.
 *
 * Audience filter: `all` always visible; `sport` matches user's primarySport (or
 * shown when primarySport='both'); `teams`/`roles` are let through here and
 * narrowed server-side.
 *
 * Audit note (F2): the sport narrowing IS applied server-side — the
 * `audienceFilter` below is part of the Directus `_and/_or` query, so a member of
 * one sport is not sent the other sport's `sport`-targeted rows by the API.
 *
 * `teams`/`roles` (migration 219) work differently and deliberately so. Their
 * targeting arrays (audience_teams / audience_roles) are NOT in the member field
 * whitelist — exposing them would reveal targeting intent — so this hook has
 * nothing to match itself against and cannot narrow them. Instead the Member
 * policy filter (ANNOUNCEMENT_VISIBLE in setup-permissions.mjs) requires a
 * materialized `announcement_recipients` row for the requesting user, so the API
 * only ever returns targeted posts the member was actually addressed in. Passing
 * the type through here is therefore safe: the server has already decided.
 */
export function useAnnouncements(opts?: { limit?: number }) {
  const { user, isApproved, primarySport } = useAuth()
  const [items, setItems] = useState<Announcement[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const limit = opts?.limit ?? 30

  const fetchAnnouncements = useCallback(async () => {
    if (!user?.id || !isApproved) {
      setItems([])
      setIsLoading(false)
      return
    }
    try {
      const nowIso = new Date().toISOString()
      // all + (primarySport-matched sport rows) + (server-gated teams/roles rows)
      const audienceFilter: Record<string, unknown>[] = [
        { audience_type: { _eq: 'all' } },
      ]
      if (primarySport === 'volleyball' || primarySport === 'both') {
        audienceFilter.push({ _and: [{ audience_type: { _eq: 'sport' } }, { audience_sport: { _eq: 'volleyball' } }] })
      }
      if (primarySport === 'basketball' || primarySport === 'both') {
        audienceFilter.push({ _and: [{ audience_type: { _eq: 'sport' } }, { audience_sport: { _eq: 'basketball' } }] })
      }
      // Narrowed by the policy filter's recipients walk, not here — see the
      // doc comment above. Note this filter must never walk `recipients` itself:
      // a frontend filter and a policy filter traversing the same relation is the
      // documented silent-empty trap (CLAUDE.md → M2M deep filter + policy walk).
      audienceFilter.push({ audience_type: { _in: ['teams', 'roles'] } })
      const result = await fetchItems<Announcement>('announcements', {
        filter: {
          _and: [
            { published_at: { _nnull: true, _lte: nowIso } },
            { _or: [{ expires_at: { _null: true } }, { expires_at: { _gt: nowIso } }] },
            { _or: audienceFilter },
          ],
        },
        sort: ['-pinned', '-published_at'],
        limit,
      })
      setItems(result)
    } catch {
      // Empty feed on failure. fetchItems already reports the error via
      // captureApiError (Sentry + JSONL), so a genuine permission/500 is
      // observable — this fallback only keeps the UI from breaking when the
      // collection is absent (e.g. not yet migrated on dev).
      setItems([])
    } finally {
      setIsLoading(false)
    }
  }, [user?.id, isApproved, primarySport, limit])

  // Fetch on mount and whenever the query inputs change. The fetch lives in an
  // effect-local async function (React's documented data-fetching shape) so the
  // effect body itself stays free of state updates.
  useEffect(() => {
    async function run() { await fetchAnnouncements() }
    void run()
  }, [fetchAnnouncements])

  // Realtime: refetch on any change (audience evaluation is server-side via filter)
  useRealtime<Announcement>('announcements', () => {
    fetchAnnouncements()
  }, undefined, !user?.id || !isApproved)

  return useMemo(() => ({ announcements: items, isLoading, refetch: fetchAnnouncements }), [items, isLoading, fetchAnnouncements])
}

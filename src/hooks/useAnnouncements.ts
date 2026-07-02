import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
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
 * v1 audience filter: `all` always visible; `sport` matches user's primarySport
 * (or shown when primarySport='both'). `teams`/`roles` reserved for v2.
 *
 * Audit note (F2): the sport audience narrowing IS applied server-side — the
 * `sportFilter` below is part of the Directus `_and/_or` query, so a member of
 * one sport is not sent the other sport's `sport`-targeted rows by the API.
 * What is NOT enforced is `teams`/`roles` targeting: those audience types are
 * not matched by this filter and therefore never surfaced yet (reserved for
 * v2). Acceptable for v1 (low-sensitivity content) — revisit when teams/roles
 * audiences ship or announcements carry confidential payload.
 */
export function useAnnouncements(opts?: { limit?: number }) {
  const { user, isApproved, primarySport } = useAuth()
  const [items, setItems] = useState<Announcement[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const userIdRef = useRef(user?.id)
  userIdRef.current = user?.id
  const limit = opts?.limit ?? 30

  const fetchAnnouncements = useCallback(async () => {
    if (!user?.id || !isApproved) {
      setItems([])
      setIsLoading(false)
      return
    }
    try {
      const nowIso = new Date().toISOString()
      // Audience filter: all + (primarySport-matched sport rows)
      const sportFilter: Record<string, unknown>[] = [
        { audience_type: { _eq: 'all' } },
      ]
      if (primarySport === 'volleyball' || primarySport === 'both') {
        sportFilter.push({ _and: [{ audience_type: { _eq: 'sport' } }, { audience_sport: { _eq: 'volleyball' } }] })
      }
      if (primarySport === 'basketball' || primarySport === 'both') {
        sportFilter.push({ _and: [{ audience_type: { _eq: 'sport' } }, { audience_sport: { _eq: 'basketball' } }] })
      }
      const result = await fetchItems<Announcement>('announcements', {
        filter: {
          _and: [
            { published_at: { _nnull: true, _lte: nowIso } },
            { _or: [{ expires_at: { _null: true } }, { expires_at: { _gt: nowIso } }] },
            { _or: sportFilter },
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

  useEffect(() => {
    fetchAnnouncements()
  }, [fetchAnnouncements])

  // Realtime: refetch on any change (audience evaluation is server-side via filter)
  useRealtime<Announcement>('announcements', () => {
    fetchAnnouncements()
  }, undefined, !user?.id || !isApproved)

  return useMemo(() => ({ announcements: items, isLoading, refetch: fetchAnnouncements }), [items, isLoading, fetchAnnouncements])
}

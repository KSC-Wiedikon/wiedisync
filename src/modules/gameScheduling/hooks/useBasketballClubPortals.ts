import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { kscwApi, updateRecord, SCHEDULING_ORIGIN } from '../../../lib/api'

/**
 * Opponent-CLUB registry + per-club portal links for basketball
 * (`basketplan_clubs` migration 279, `game_scheduling_club_portals.sport`
 * migration 280, endpoints in kscw-endpoints/src/basketball-portal.js).
 *
 * Everything here goes through the custom endpoints rather than the items API,
 * for two reasons:
 *  · the club registry carries third-party contact PII, so it is read behind the
 *    basketball gate (Directus admin | admin/superuser | bb_admin | is_spielplaner)
 *    and never granted to Member/Coach/Public;
 *  · minting, reissuing, revoking and sending are raw-knex writes that capture the
 *    actor with `writeUserLog` — a client-side items-API loop would not.
 *
 * The ONE exception is `saveClubContact`: editing a club's contact block is a plain
 * record edit, so it uses the items API and is actor-logged by Directus for free.
 * The Terminplanung policy holds READ-only on `basketplan_clubs`, so a Spielplaner
 * gets a 403 there — the caller surfaces that rather than pretending it saved.
 */

export interface BasketplanClub {
  id: number
  bp_club_id: number | null
  name: string
  short_name: string | null
  is_own_club: boolean
  contact_name: string | null
  contact_email: string | null
  contact_email_secondary: string | null
  contact_phone: string | null
  contact_role_label: string | null
  contact_source: 'none' | 'basketplan' | 'manual'
  contact_verified_at: string | null
  source: string
  note: string | null
}

export interface BbPortalOffers {
  offered: number
  accepted: number
  declined: number
  countered: number
  total: number
}

export type BbPortalStatus = 'invited' | 'viewed' | 'booked' | 'revoked' | 'expired'

export interface BbClubPortal {
  id: number
  season: number
  club_id: string
  club_name: string | null
  token: string
  status: BbPortalStatus
  language: string | null
  contact_name: string | null
  contact_email: string | null
  club_note: string | null
  first_viewed_at: string | null
  email_sent_at: string | null
  reminder_sent_at: string | null
  expires_at: string | null
  revoked_at: string | null
  reissued_at: string | null
  bp_club: number | null
  bp_club_id: number | null
  contact_source: string | null
  /** Absolute link, rendered server-side from SCHEDULING_URL. */
  url: string
  offers: BbPortalOffers
}

/** One rendered invite email, exactly as it would be sent (dry run). */
export interface BbPortalPreview {
  id: number
  to: string | null
  club_name: string | null
  offers: number
  subject: string
  html: string
  text: string
}

export interface BbSendResult {
  previews: BbPortalPreview[]
  sent: number
  failed: Array<{ id: number; error: string }>
  dry_run: boolean
}

export interface BbSendOptions {
  ids?: number[]
  dryRun?: boolean
  reminder?: boolean
  allowEmpty?: boolean
}

const EMPTY_OFFERS: BbPortalOffers = { offered: 0, accepted: 0, declined: 0, countered: 0, total: 0 }

/** Fallback link when the server did not render one (older deploy). */
export const bbPortalUrl = (token: string) =>
  `${SCHEDULING_ORIGIN.replace(/\/$/, '')}/terminplanung/bb/${token}`

export function useBasketballClubPortals(seasonId: string | number | null | undefined) {
  const enabled = seasonId != null && seasonId !== ''
  const [busy, setBusy] = useState(false)

  const clubsQ = useQuery<BasketplanClub[]>({
    queryKey: ['bb-clubs'],
    queryFn: async () => {
      const res = await kscwApi<{ clubs: BasketplanClub[] }>('/admin/terminplanung/bb/clubs')
      return res?.clubs ?? []
    },
    staleTime: 5 * 60_000,
  })

  const portalsQ = useQuery<BbClubPortal[]>({
    queryKey: ['bb-portals', String(seasonId ?? '')],
    queryFn: async () => {
      const res = await kscwApi<{ portals: BbClubPortal[] }>(
        `/admin/terminplanung/bb/portals?season=${encodeURIComponent(String(seasonId))}`,
      )
      return (res?.portals ?? []).map((p) => ({
        ...p,
        url: p.url || bbPortalUrl(p.token),
        offers: p.offers ?? EMPTY_OFFERS,
      }))
    },
    enabled,
    staleTime: 30_000,
  })

  const clubs = useMemo(() => clubsQ.data ?? [], [clubsQ.data])
  const portals = useMemo(() => portalsQ.data ?? [], [portalsQ.data])

  /** basketplan_clubs.id → its portal for this season (a club has at most one). */
  const portalByClub = useMemo(() => {
    const m = new Map<string, BbClubPortal>()
    for (const p of portals) if (p.bp_club != null) m.set(String(p.bp_club), p)
    return m
  }, [portals])

  const refetchPortals = portalsQ.refetch
  const refetchClubs = clubsQ.refetch

  /** Mint (or refresh) the links. Without `clubIds` the backend covers every club that has an offer. */
  const ensure = useCallback(
    async (clubIds?: Array<string | number>) => {
      if (!enabled) return null
      setBusy(true)
      try {
        const res = await kscwApi<{ created: number; refreshed: number; skipped: unknown[] }>(
          '/admin/terminplanung/bb/portals/ensure',
          {
            method: 'POST',
            body: {
              season: Number(seasonId),
              ...(clubIds?.length ? { club_ids: clubIds.map(Number) } : {}),
            },
          },
        )
        await refetchPortals()
        return res
      } finally {
        setBusy(false)
      }
    },
    [enabled, seasonId, refetchPortals],
  )

  const reissue = useCallback(
    async (portalId: number) => {
      setBusy(true)
      try {
        const res = await kscwApi<{ success: boolean; url: string }>(
          `/admin/terminplanung/bb/portals/${portalId}/reissue`,
          { method: 'POST', body: {} },
        )
        await refetchPortals()
        return res
      } finally {
        setBusy(false)
      }
    },
    [refetchPortals],
  )

  const revoke = useCallback(
    async (portalId: number) => {
      setBusy(true)
      try {
        const res = await kscwApi<{ success: boolean }>(
          `/admin/terminplanung/bb/portals/${portalId}/revoke`,
          { method: 'POST', body: {} },
        )
        await refetchPortals()
        return res
      } finally {
        setBusy(false)
      }
    },
    [refetchPortals],
  )

  /**
   * Render (dry run) or actually send the invite mail.
   *
   * ⚠ A real send is only ever triggered by an explicit operator click — never on
   * mount, never on render. The preview path (`dryRun: true`) is the one the UI
   * calls automatically, and it sends nothing.
   */
  const send = useCallback(
    async (opts: BbSendOptions = {}): Promise<BbSendResult | null> => {
      if (!enabled) return null
      const dryRun = opts.dryRun !== false
      if (!dryRun) setBusy(true)
      try {
        const res = await kscwApi<BbSendResult>('/admin/terminplanung/bb/portals/send', {
          method: 'POST',
          body: {
            season: Number(seasonId),
            dry_run: dryRun,
            reminder: !!opts.reminder,
            allow_empty: !!opts.allowEmpty,
            ...(opts.ids?.length ? { ids: opts.ids } : {}),
          },
        })
        if (!dryRun) await refetchPortals()
        return res
      } finally {
        if (!dryRun) setBusy(false)
      }
    },
    [enabled, seasonId, refetchPortals],
  )

  /** Items-API edit of the club's contact block (Directus captures the actor). */
  const saveClubContact = useCallback(
    async (clubId: number, patch: Partial<BasketplanClub>) => {
      await updateRecord('basketplan_clubs', clubId, {
        ...patch,
        contact_source: 'manual',
        contact_verified_at: new Date().toISOString(),
      })
      await refetchClubs()
    },
    [refetchClubs],
  )

  return {
    clubs,
    portals,
    portalByClub,
    isLoading: clubsQ.isLoading || portalsQ.isLoading,
    error: (clubsQ.error as Error | null) ?? (portalsQ.error as Error | null) ?? null,
    busy,
    ensure,
    reissue,
    revoke,
    send,
    saveClubContact,
    refetchPortals,
    refetchClubs,
  }
}

import { useCallback, useEffect, useState } from 'react'
import { kscwApi } from '../../../lib/api'
import type { InviteSource, OpponentInvite } from '../../../types'

export interface SvrzContactPreview {
  name: string
  email: string
  phone: string
  source: 'per_game' | 'club_fallback'
}

export interface SvrzGamePreview {
  date: string | null
  display_name: string | null
  is_home_kscw: boolean
}

export interface SvrzOpponentPreview {
  club_id: string
  club_name: string
  team_name: string
  game_count: number
  games?: SvrzGamePreview[]
  contacts: SvrzContactPreview[]
  warning?: 'no_contact'
  source: 'club_league' | 'club_fallback' | 'team_responsible' | 'none'
}

export interface SvrzImportPreview {
  season: string
  season_uuid: string | null
  kscw_team: { id: string | number; name: string; league: string }
  opponents: SvrzOpponentPreview[]
  total_games_matched: number
}

export interface SvrzClubContact {
  name: string
  email: string
  phone: string
}

export interface SvrzClub {
  club_id: string
  club_name: string
  team_name: string
  game_count: number
  games?: SvrzGamePreview[]
  suggested_contacts: SvrzClubContact[]
}

export interface SvrzClubsResponse {
  season: string
  season_uuid: string | null
  kscw_team: { id: string | number; name: string; league: string }
  clubs: SvrzClub[]
}

export interface CreateInviteRow {
  team_name: string
  contact_email: string
  contact_name: string
}

interface InvitesListResponse {
  data: OpponentInvite[]
}

interface CreateInvitesResponse {
  created: number
  existing: number
  rows: Array<{ id: string | number; token: string; email: string; team_name: string }>
}

export interface InvitePreview {
  id: string | number
  to: string
  team_name: string
  subject: string
  html: string
  text: string
}

export interface SendInvitesResponse {
  previews: InvitePreview[]
  sent: number
  failed: Array<{ id: string | number; error: string }>
  dry_run: boolean
}

export interface SendInvitesContext {
  seasonName: string
  kscwTeamName: string
  kscwLeague: string
}

export function useInvites(kscwTeamId: string | number | null | undefined, seasonId: string | number | null | undefined) {
  const [invites, setInvites] = useState<OpponentInvite[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchInvites = useCallback(async () => {
    if (!kscwTeamId) return
    setIsLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ kscw_team: String(kscwTeamId) })
      if (seasonId) qs.set('season', String(seasonId))
      const resp = await kscwApi<InvitesListResponse>(`/admin/terminplanung/invites?${qs}`)
      setInvites(resp.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }, [kscwTeamId, seasonId])

  useEffect(() => {
    fetchInvites()
  }, [fetchInvites])

  const createInvites = useCallback(
    async (rows: CreateInviteRow[], source: InviteSource) => {
      if (!kscwTeamId || !seasonId) throw new Error('kscw_team and season required')
      const resp = await kscwApi<CreateInvitesResponse>('/admin/terminplanung/invites', {
        method: 'POST',
        body: {
          kscw_team: kscwTeamId,
          season: seasonId,
          rows: rows.map((r) => ({ ...r, source })),
        },
      })
      await fetchInvites()
      return resp
    },
    [kscwTeamId, seasonId, fetchInvites],
  )

  const reissue = useCallback(async (id: string | number) => {
    const resp = await kscwApi<{ success: true; token: string; expires_at: string }>(
      `/admin/terminplanung/invites/${id}/reissue`,
      { method: 'POST' },
    )
    await fetchInvites()
    return resp
  }, [fetchInvites])

  const revoke = useCallback(async (id: string | number) => {
    const resp = await kscwApi(`/admin/terminplanung/invites/${id}/revoke`, { method: 'POST' })
    await fetchInvites()
    return resp
  }, [fetchInvites])

  // Flag an invite as sent (used by the per-card "Draft email" mailto, which the
  // app can't observe). Flips the badge from "Not sent" to "Invited".
  const markSent = useCallback(async (id: string | number) => {
    const resp = await kscwApi(`/admin/terminplanung/invites/${id}/mark-sent`, { method: 'POST' })
    await fetchInvites()
    return resp
  }, [fetchInvites])

  // Auto-create invite links for every synced opponent with a contact, so the
  // panel list populates itself. Idempotent (deduped by team name server-side).
  const ensureFromSvrz = useCallback(async () => {
    if (!kscwTeamId || !seasonId) return { created: 0 }
    const resp = await kscwApi<{ created: number; invites: OpponentInvite[] }>(
      '/admin/terminplanung/invites/ensure-from-svrz',
      { method: 'POST', body: { kscw_team: kscwTeamId, season: seasonId } },
    )
    await fetchInvites()
    return resp
  }, [kscwTeamId, seasonId, fetchInvites])

  const importFromSvrz = useCallback(async () => {
    if (!kscwTeamId || !seasonId) throw new Error('kscw_team and season required')
    const qs = new URLSearchParams({ kscw_team: String(kscwTeamId), season: String(seasonId) })
    return kscwApi<SvrzImportPreview>(`/admin/terminplanung/invites/import-from-svrz?${qs}`)
  }, [kscwTeamId, seasonId])

  // Bulk-send invite emails per team. dryRun=true returns rendered previews
  // (byte-identical to what's sent) so the confirm modal can show each email.
  const sendInvites = useCallback(
    async (ids: Array<string | number>, opts: { dryRun: boolean } & SendInvitesContext) => {
      return kscwApi<SendInvitesResponse>('/admin/terminplanung/invites/send', {
        method: 'POST',
        body: {
          ids,
          dry_run: opts.dryRun,
          season_name: opts.seasonName,
          kscw_team_name: opts.kscwTeamName,
          kscw_league: opts.kscwLeague,
        },
      })
    },
    [],
  )

  // Semi-manual: fast league club list (no live SVRZ login) for prefilling drafts.
  const listSvrzClubs = useCallback(async () => {
    if (!kscwTeamId || !seasonId) throw new Error('kscw_team and season required')
    const qs = new URLSearchParams({ kscw_team: String(kscwTeamId), season: String(seasonId) })
    return kscwApi<SvrzClubsResponse>(`/admin/terminplanung/invites/svrz-clubs?${qs}`)
  }, [kscwTeamId, seasonId])

  return {
    invites,
    isLoading,
    error,
    createInvites,
    reissue,
    revoke,
    markSent,
    importFromSvrz,
    listSvrzClubs,
    ensureFromSvrz,
    sendInvites,
    refetch: fetchInvites,
  }
}

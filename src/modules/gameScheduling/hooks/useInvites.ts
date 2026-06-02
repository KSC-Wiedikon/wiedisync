import { useCallback, useEffect, useState } from 'react'
import { kscwApi } from '../../../lib/api'
import type { InviteSource, OpponentInvite } from '../../../types'

export interface SvrzContactPreview {
  name: string
  email: string
  phone: string
  source: 'per_game' | 'club_fallback'
}

export interface SvrzOpponentPreview {
  club_id: string
  club_name: string
  team_name: string
  game_count: number
  contacts: SvrzContactPreview[]
  warning?: 'no_contact'
  source: 'per_game' | 'club_fallback' | 'none'
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

  const importFromSvrz = useCallback(async () => {
    if (!kscwTeamId || !seasonId) throw new Error('kscw_team and season required')
    const qs = new URLSearchParams({ kscw_team: String(kscwTeamId), season: String(seasonId) })
    return kscwApi<SvrzImportPreview>(`/admin/terminplanung/invites/import-from-svrz?${qs}`)
  }, [kscwTeamId, seasonId])

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
    importFromSvrz,
    listSvrzClubs,
    refetch: fetchInvites,
  }
}

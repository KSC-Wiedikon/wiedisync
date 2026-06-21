import { useEffect, useState } from 'react'
import { kscwApi } from '../../../lib/api'
import { useAuth } from '../../../hooks/useAuth'

export interface OfficialContact {
  phone: string | null
  email: string | null
  hide_phone: boolean
  hide_email: boolean
}

const EMPTY: Map<string, OfficialContact> = new Map()

/**
 * Contact details (email/phone) of the officials assigned to games the current
 * coach/team-responsible has scorekeeping duty for — server-scoped per game by
 * `GET /kscw/scorer/official-contacts`.
 *
 * Admins already read member contacts via the items API, so the call is skipped
 * for them and for non-leaders (the endpoint returns {} for those anyway —
 * this just avoids a useless round-trip). Returns a Map keyed by member id.
 */
export function useOfficialContacts(): Map<string, OfficialContact> {
  const { user, isAdmin, coachTeamIds, teamResponsibleIds, teamsLoading } = useAuth()
  const [contacts, setContacts] = useState<Map<string, OfficialContact>>(EMPTY)

  const isLeader = coachTeamIds.length > 0 || teamResponsibleIds.length > 0
  const enabled = !!user && !isAdmin && isLeader && !teamsLoading

  // Poll every 60s while enabled: the contact window (1h before kickoff → 1h
  // after) opens/closes over time, so we refetch to surface/drop contacts as
  // the game approaches, and the resulting re-render re-evaluates the per-game
  // display gate in ScorerPage.
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = () => {
      kscwApi<{ data: Record<string, OfficialContact> }>('/scorer/official-contacts')
        .then((res) => {
          if (cancelled) return
          const map = new Map<string, OfficialContact>()
          for (const [id, c] of Object.entries(res?.data ?? {})) map.set(String(id), c)
          setContacts(map)
        })
        .catch(() => { if (!cancelled) setContacts(EMPTY) })
    }
    load()
    const id = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [enabled])

  // Never hand back contacts while disabled (logged out / lost leader role).
  return enabled ? contacts : EMPTY
}

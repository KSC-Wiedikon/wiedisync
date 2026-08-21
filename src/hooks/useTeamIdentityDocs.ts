import { useEffect, useState } from 'react'
import { kscwApi } from '../lib/api'

interface IdentityStatusResponse {
  data: { documents: { member: number; uploaded_at: string; uploaded_by_self: boolean }[] }
}

/**
 * Which people on a team have an identity document on file — member id → upload timestamp.
 *
 * PRESENCE ONLY. No envelope, no ciphertext, nothing that could reveal what the document is;
 * the server answers this outside the pre-load window precisely because "has one" and "may
 * look at it" are different questions. Staff-scoped: only a coach/TR of the team or an admin
 * gets an answer, so call it with `enabled` mirroring the roster's own `canManage`.
 *
 * `null` means WE DO NOT KNOW — still loading, disabled, or the call was refused. The roster
 * hides the column entirely in that state rather than painting every row "missing", which is
 * the one wrong answer this column must never give.
 */
export function useTeamIdentityDocs(teamId: string | undefined, enabled: boolean) {
  const [loaded, setLoaded] = useState<{ team: string; docs: Map<string, string> } | null>(null)

  useEffect(() => {
    if (!teamId || !enabled) return
    let cancelled = false
    kscwApi<IdentityStatusResponse>(`/identity/status/${teamId}`)
      .then((res) => {
        if (cancelled) return
        setLoaded({
          team: teamId,
          docs: new Map((res.data?.documents ?? []).map((d) => [String(d.member), d.uploaded_at])),
        })
      })
      .catch(() => { if (!cancelled) setLoaded(null) })
    return () => { cancelled = true }
  }, [teamId, enabled])

  // Derived, never cleared by a setState in the effect body: last team's answer is not this
  // team's answer, and writing that down synchronously cascades a render.
  return loaded && loaded.team === teamId && enabled ? loaded.docs : null
}

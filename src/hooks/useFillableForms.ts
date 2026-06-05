import { useMemo } from 'react'
import { useAuth } from './useAuth'
import { useCollection } from '../lib/query'
import type { FormDef } from '../modules/forms/types'

/** Extract the targeted team ids from a form's (possibly junction-expanded) teams. */
function teamIdsOf(form: FormDef): string[] {
  return (form.teams ?? []).map((tref) => {
    if (typeof tref === 'object' && tref !== null && 'teams_id' in tref) {
      const tid = (tref as { teams_id: unknown }).teams_id
      return String(typeof tid === 'object' && tid !== null ? (tid as { id: unknown }).id : tid)
    }
    return String(tref)
  })
}

interface SubRef { id: string; form: string }

/**
 * Open forms the current user can FILL IN — club-wide ∪ their player teams,
 * excluding ones they've already submitted (unless anonymous / multi-submit).
 * Surfaced on the Home page so regular members reach forms without a nav entry
 * (the /forms nav item is author-only). Scopes by `memberTeamIds` (the teams
 * you play for), not coach teams — filling is a player action.
 */
export function useFillableForms() {
  const { user, memberTeamIds } = useAuth()

  const { data: formsRaw, isLoading, refetch } = useCollection<FormDef>('forms', {
    filter: { status: { _eq: 'open' } },
    fields: ['*', 'teams.teams_id.id'],
    sort: ['-date_created'],
    limit: 200,
    enabled: !!user,
  })

  const { data: subsRaw } = useCollection<SubRef>('form_submissions', {
    filter: { member: { _eq: user?.id } },
    fields: ['id', 'form'],
    limit: 1000,
    enabled: !!user,
  })

  const submittedFormIds = useMemo(
    () => new Set((subsRaw ?? []).map((s) => String(s.form))),
    [subsRaw],
  )

  const forms = useMemo(
    () =>
      (formsRaw ?? []).filter((f) => {
        const targeted =
          f.audience === 'club_wide' || teamIdsOf(f).some((id) => memberTeamIds.includes(id))
        if (!targeted) return false
        const alreadyDone = !f.anonymous && !f.allow_multiple && submittedFormIds.has(String(f.id))
        return !alreadyDone
      }),
    [formsRaw, memberTeamIds, submittedFormIds],
  )

  return { forms, submittedFormIds, isLoading, refetch }
}

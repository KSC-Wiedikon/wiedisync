import { useMemo } from 'react'
import { useAuth } from './useAuth'
import { useCollection } from '../lib/query'
import type { FormDef, AnswerValue } from '../modules/forms/types'

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

interface SubRef { id: string; form: string; answers: Record<string, AnswerValue> }

export interface FillableForm {
  form: FormDef
  /** The member's existing submission, when the form is editable (non-anonymous,
   *  single-submission, already answered). Drives the Edit affordance + prefill. */
  submission: { id: string; answers: Record<string, AnswerValue> } | null
}

/**
 * Forms the current member can act on from Home — club-wide ∪ their player teams.
 * Includes both not-yet-submitted forms (→ "Fill in") and already-submitted,
 * still-editable ones (→ "Edit", with the prior answers for prefill). Anonymous
 * and multi-submission forms are never marked editable. Surfaced on Home because
 * the /forms nav item is author-only.
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
    fields: ['id', 'form', 'answers'],
    limit: 1000,
    enabled: !!user,
  })

  const subByForm = useMemo(() => {
    const m = new Map<string, SubRef>()
    for (const s of subsRaw ?? []) m.set(String(s.form), s)
    return m
  }, [subsRaw])

  const items = useMemo<FillableForm[]>(
    () =>
      (formsRaw ?? [])
        .filter((f) => f.audience === 'club_wide' || teamIdsOf(f).some((id) => memberTeamIds.includes(id)))
        .map((f) => {
          const sub = subByForm.get(String(f.id))
          const editable = !!sub && !f.anonymous && !f.allow_multiple
          // Hide forms that are answered and NOT editable (single-shot, already done).
          if (sub && !editable && !f.allow_multiple) return null
          return {
            form: f,
            submission: editable && sub ? { id: String(sub.id), answers: sub.answers ?? {} } : null,
          }
        })
        .filter((x): x is FillableForm => x !== null),
    [formsRaw, memberTeamIds, subByForm],
  )

  // Count of forms still needing a first answer (drives the Home badge / visibility).
  const todoCount = useMemo(() => items.filter((i) => !i.submission).length, [items])

  return { items, todoCount, isLoading, refetch }
}

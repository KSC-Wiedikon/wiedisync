import { useCollection } from '../lib/query'

/**
 * Load the single activity named by a share link (`/events/42`).
 *
 * Fetched by id in its OWN query rather than picked out of the page's list.
 * The list is always filtered — team chip, "show past", the tab — so resolving
 * the link against it would make a perfectly good link fail for reasons the
 * recipient cannot see: a past event, another team's training, a game outside
 * the active tab. That is exactly the bug that hid a saved hall closure behind
 * the week filter (commit 624273b); a share link is far more exposed to it,
 * because the sender's filters are never the recipient's.
 *
 * A filtered read rather than `fetchItem`, on purpose: when the member is not
 * allowed to see the activity, Directus returns an empty list instead of
 * throwing a 403, so "you can't open this" is a normal render path and not an
 * error boundary. Both cases collapse to `notFound` — the caller must not tell
 * the two apart in the UI either, or the link becomes an existence oracle for
 * events a member was never invited to.
 */
export function useDeepLinkedActivity<T extends { id: string }>(
  collection: string,
  id: string | undefined,
  fields: string[],
): { item: T | null; isLoading: boolean; notFound: boolean } {
  const { data, isLoading } = useCollection<T>(collection, {
    filter: { id: { _eq: id } },
    fields,
    limit: 1,
    enabled: !!id,
  })

  if (!id) return { item: null, isLoading: false, notFound: false }
  const item = data?.[0] ?? null
  return {
    item,
    isLoading,
    // Only after the fetch settles — mid-flight there is nothing to report yet.
    notFound: !isLoading && !!data && !item,
  }
}

/**
 * Field sets for the three deep-linkable activities, matching what each detail
 * modal reads.
 *
 * ⚠ The `.members_id` expansions are load-bearing, not decoration: without them
 * Directus hands back the M2M aliases as junction-row PKs, and every
 * coach/team-responsible check downstream silently resolves against the wrong
 * member (CLAUDE.md → "M2M reads must expand `.members_id`").
 */
export const DEEP_LINK_FIELDS = {
  events: [
    '*',
    'teams.id', 'teams.teams_id.*',
    'teams.teams_id.coach.members_id', 'teams.teams_id.team_responsible.members_id',
    'invited_members.id', 'invited_members.members_id',
    'invited_roles', 'send_email_invite',
  ],
  trainings: [
    '*', 'team.*',
    'team.coach.members_id', 'team.team_responsible.members_id',
    'hall.*', 'coach.*',
  ],
  games: [
    '*', 'kscw_team.*',
    'kscw_team.coach.members_id', 'kscw_team.team_responsible.members_id',
    'hall.*',
  ],
} as const

import { useMemo } from 'react'
import { useCollection } from '../lib/query'
import { relId } from '../utils/relations'

interface Result {
  /** Games this member was invited to as a guest, beyond their own teams' fixtures. */
  guestGameIds: string[]
  /** The subset they were called up to as staff — coach / TR of the called-up team
   *  (migration 408). Their RSVP there is a staff answer, not a player's. */
  staffGameIds: string[]
  isLoading: boolean
  error: Error | null
}

/**
 * Resolve which games the current user can see — and RSVP to — through a guest
 * invitation (migration 271), returned as a flat ID array.
 *
 * Every personal game surface — home, calendar, the games list — filters on
 * `kscw_team ∈ my teams`, which is exactly the filter a borrowed player fails: a
 * guest has no `member_teams` row on the team whose fixture it is. Callers OR this
 * list into those filters as `{ id: { _in: [...] } }`.
 *
 * Deliberately a flat junction-first fetch rather than a filter that walks
 * `games.guests.member.user`: the read policy on `game_guests` walks the same
 * relation, and Directus cannot reliably AND a frontend filter with a policy filter
 * through one alias — it silently returns [] for non-admins while looking correct to
 * an admin. Same pattern as useUserVisibleEventIds / useMultiTeamMembers.
 *
 * Runs through React Query rather than a private `useState` + `fetch` effect so that
 * every caller shares one request: the page builds its visibility filter from it AND
 * each GameCard asks it whether to render RSVP buttons, which is one identical query
 * key and therefore one round-trip no matter how many cards are on screen.
 */
export function useUserVisibleGameIds(userId: string | undefined, enabled = true): Result {
  const { data, isLoading, error } = useCollection<{ game: string | number; is_staff?: boolean }>('game_guests', {
    // Keep the key stable across callers: same filter/fields object shape everywhere.
    filter: { member: { _eq: userId ?? '' } },
    fields: ['game', 'is_staff'],
    all: true,
    enabled: enabled && !!userId,
  })

  const guestGameIds = useMemo(
    () => [...new Set((data ?? []).map(r => relId(r.game)).filter(Boolean))],
    [data],
  )
  const staffGameIds = useMemo(
    () => [...new Set((data ?? []).filter(r => r.is_staff).map(r => relId(r.game)).filter(Boolean))],
    [data],
  )

  return { guestGameIds, staffGameIds, isLoading, error: error ?? null }
}

/**
 * Was the current member called up to this specific game, and as what? `calledUp`
 * drives the RSVP buttons: `canParticipateIn(game.kscw_team)` is team-scoped and a
 * guest is, by definition, not on that team's roster — without it they can see the
 * fixture but not answer it. `asStaff` marks a called-up team's coach / TR (migration
 * 408), who answers as staff: `isStaffOnly(game.kscw_team)` cannot see that — they
 * coach the called-up team, not this one — so the RSVP would land as a player's.
 */
export function useGameCallUp(userId: string | undefined, gameId: string | undefined): { calledUp: boolean; asStaff: boolean } {
  const { guestGameIds, staffGameIds } = useUserVisibleGameIds(userId, !!userId)
  const id = gameId ? String(gameId) : ''
  return { calledUp: !!id && guestGameIds.includes(id), asStaff: !!id && staffGameIds.includes(id) }
}

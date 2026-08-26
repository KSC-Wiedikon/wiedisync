import { useMemo } from 'react'
import { useCollection } from '../lib/query'
import { relId } from '../utils/relations'

/**
 * Games another team's fixture list owns, but THIS team was invited to play.
 *
 * The club enters some competitions under one team's name and fields a different
 * squad: the Mobiliar Cup is registered for H1 and D1 only, so an H1 cup tie is
 * played by H3. `games.kscw_team` says H1 and always will — the entry is H1's — so
 * a calendar scoped to `kscw_team` alone cannot show H3 the match it is playing.
 *
 * `game_guest_teams` is the club's own statement of that ("game 572 invites H3"),
 * and a trigger materialises it into the individual `game_guests` rows.
 *
 * ⚠ Read `game_guest_teams`, NOT `game_guests`. The latter's read policy is
 * viewer-scoped — you see an invitation if you are the invitee, on the host team's
 * roster, or a fellow guest — so filtering it by team would show the tie to the
 * called-up squad and hide it from every other member of the same team. That is a
 * silent, per-viewer split, and an invisible fixture looks exactly like no fixture.
 * `game_guest_teams` is readable by anyone on the invited team.
 *
 * A flat single-level junction fetch on purpose: the policy already walks
 * `team.members.member.user`, and this filter is a scalar FK comparison rather than
 * a second walk down the same alias — the pattern that silently returns [].
 */
export function useTeamGuestGameIds(teamId: string | number | undefined, enabled = true): {
  guestGameIds: string[]
  isLoading: boolean
} {
  const { data, isLoading } = useCollection<{ game: string | number }>('game_guest_teams', {
    filter: { team: { _eq: teamId ?? '' } },
    fields: ['game'],
    all: true,
    enabled: enabled && teamId != null && teamId !== '',
  })

  // Memoised: this array becomes part of a react-query filter, so a fresh
  // identity on every render would refetch the calendar forever.
  const guestGameIds = useMemo(
    () => [...new Set((data ?? []).map((r) => relId(r.game)).filter(Boolean))],
    [data],
  )

  return { guestGameIds, isLoading }
}

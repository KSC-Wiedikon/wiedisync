import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAllItems, wieplayGameUrl } from '../lib/api'
import { keys } from '../lib/query'
import { relId } from '../utils/relations'
import { todayLocal } from '../utils/dateHelpers'
import { showsWieplayLink } from '../utils/wieplay'
import { useAuth } from './useAuth'

const NO_TEAMS: ReadonlySet<string> = new Set()

/**
 * Ids of the teams that use WiePlay: `teams.wieplay_enabled` (migration 423), which the WiePlay
 * bridge sets on every hourly sync. One small request per session, shared by every card.
 *
 * An optional link, so a refused read means "no links", not an error: on dev the nightly prod
 * clone drops the column until `npm run db:deploy:dev` runs again (while prod lacks it), and
 * Directus answers a filter on a missing field with 403. `optional` keeps that out of the
 * error log, as for the other reads a viewer may simply not hold.
 */
export function useWieplayTeamIds(): ReadonlySet<string> {
  const { user } = useAuth()
  const { data } = useQuery({
    queryKey: keys.list('teams', { wieplay_enabled: true }),
    queryFn: () =>
      fetchAllItems<{ id: string }>('teams', {
        filter: { wieplay_enabled: { _eq: true } },
        fields: ['id'],
        optional: true,
      }).catch(() => [] as { id: string }[]),
    enabled: !!user,
    staleTime: 10 * 60_000,
  })
  return useMemo(() => (data?.length ? new Set(data.map((t) => String(t.id))) : NO_TEAMS), [data])
}

/**
 * The "Video" link of a game (WiePlay's page for it), or null when the card shows none — see
 * `showsWieplayLink`. "On the team" is what Wiedisync knows: player, coach, team responsible,
 * or an admin / sport admin of the team. WiePlay's own helpers are not known here; they open
 * WiePlay directly, and WiePlay decides what anyone sees either way.
 */
export function useWieplayGameUrl(game: { id: string; date?: string | null; status?: string | null; kscw_team?: unknown } | null | undefined): string | null {
  const { user, canViewTeam, teamResponsibleIds } = useAuth()
  const teamIds = useWieplayTeamIds()
  if (!game || !user) return null
  const teamId = relId(game.kscw_team)
  if (!teamId) return null
  const show = showsWieplayLink(game, {
    teamUsesWieplay: teamIds.has(teamId),
    viewerOnTeam: canViewTeam(teamId) || teamResponsibleIds.includes(teamId),
    today: todayLocal(),
  })
  return show ? wieplayGameUrl(game.id) : null
}

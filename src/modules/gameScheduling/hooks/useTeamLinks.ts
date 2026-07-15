import { useCallback, useMemo } from 'react'
import { createRecord, deleteRecord, updateRecord } from '../../../lib/api'
import { useCollection } from '../../../lib/query'
import { useAuth } from '../../../hooks/useAuth'
import type { TeamLink } from '../../../types'

export type LinkType = 'same' | 'diff' | 'adjacent'

/** teamId → the partner team ids it is linked to, bucketed by link type. */
export interface LinkPartners {
  same: Set<string>
  diff: Set<string>
  adjacent: Set<string>
}

/**
 * Coach/player-sharing links between teams for one season + sport (migration 218).
 * Sport-agnostic: the basketball planner and the volleyball scheduler both use it.
 * Exposes the raw links, a teamId→partners map for highlight logic, and upsert /
 * update / remove writers. addLink upserts by unordered pair so re-selecting an
 * existing pair changes its type instead of 400-ing on the UNIQUE(season, sport,
 * team_a, team_b) constraint.
 */
export function useTeamLinks(
  seasonId: string | number | null | undefined,
  sport: 'basketball' | 'volleyball',
) {
  const { user } = useAuth()
  const enabled = seasonId != null

  const linksQ = useCollection<TeamLink>('team_links', {
    filter: { season: { _eq: seasonId }, sport: { _eq: sport } },
    fields: ['*'],
    all: true,
    enabled,
  })
  const links = useMemo(() => linksQ.data ?? [], [linksQ.data])

  const partnersByTeam = useMemo(() => {
    const m = new Map<string, LinkPartners>()
    const ensure = (id: string) => {
      let e = m.get(id)
      if (!e) {
        e = { same: new Set(), diff: new Set(), adjacent: new Set() }
        m.set(id, e)
      }
      return e
    }
    for (const l of links) {
      const a = String(l.team_a)
      const b = String(l.team_b)
      const bucket = l.link_type === 'same' ? 'same' : l.link_type === 'adjacent' ? 'adjacent' : 'diff'
      ensure(a)[bucket].add(b)
      ensure(b)[bucket].add(a)
    }
    return m
  }, [links])

  const refetch = linksQ.refetch

  const addLink = useCallback(
    async (teamA: string | number, teamB: string | number, linkType: LinkType) => {
      if (seasonId == null || String(teamA) === String(teamB)) return
      const a = String(teamA)
      const b = String(teamB)
      // Upsert by unordered pair: a link in EITHER direction is the same relationship.
      const existing = links.find(
        (l) =>
          (String(l.team_a) === a && String(l.team_b) === b) ||
          (String(l.team_a) === b && String(l.team_b) === a),
      )
      if (existing) {
        await updateRecord('team_links', existing.id, { link_type: linkType })
      } else {
        await createRecord('team_links', {
          season: seasonId, sport, team_a: teamA, team_b: teamB, link_type: linkType, created_by: user?.id ?? null,
        })
      }
      await refetch()
    },
    [seasonId, sport, user?.id, refetch, links],
  )

  const updateLink = useCallback(
    async (id: string | number, linkType: LinkType) => {
      await updateRecord('team_links', id, { link_type: linkType })
      await refetch()
    },
    [refetch],
  )

  const removeLink = useCallback(
    async (id: string | number) => {
      await deleteRecord('team_links', id)
      await refetch()
    },
    [refetch],
  )

  return { links, partnersByTeam, addLink, updateLink, removeLink, isLoading: linksQ.isLoading }
}

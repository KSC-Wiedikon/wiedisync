import { useCallback, useMemo } from 'react'
import { createRecord, deleteRecord, updateRecord } from '../../../lib/api'
import { useCollection } from '../../../lib/query'
import { useAuth } from '../../../hooks/useAuth'
import { defaultRulePayload, normalizeRule, type BasketballTeamRule } from '../utils/basketballRules'
import type { Team } from '../../../types'

/**
 * Per-team basketball scheduling rules (`basketball_team_rules`, migration 278) — the
 * club's "Constrains BB Spielplanung" matrix, one row per (season, team).
 *
 * Written through the Directus items API on purpose: Directus actor-logs those writes on
 * its own, so no `writeUserLog` plumbing is needed (unlike the generator endpoint, which
 * writes raw knex). See migration 278's header for why this is a table and not a json blob
 * on the season row like volleyball's `team_slot_config`.
 *
 * ⚠ A team with NO row is NOT "a team without constraints" — it is a team that is not
 * slot-generated at all (the two DU18 squads today, whose Spark/Fire ↔ 1x/2x mapping is
 * unresolved). Callers must surface that as a gap, never as an empty rule set.
 *
 * The pure shapes (types, hall presets, defaults) live in `utils/basketballRules.ts` so
 * they are unit-testable without React.
 */

export function useBasketballTeamRules(seasonId: string | number | null | undefined) {
  const { user } = useAuth()
  const enabled = seasonId != null

  const rulesQ = useCollection<Record<string, unknown>>('basketball_team_rules', {
    filter: { season: { _eq: seasonId } },
    fields: ['*'],
    all: true,
    enabled,
  })

  const rules = useMemo(() => (rulesQ.data ?? []).map(normalizeRule), [rulesQ.data])

  const byTeam = useMemo(() => {
    const m = new Map<string, BasketballTeamRule>()
    for (const r of rules) m.set(String(r.team), r)
    return m
  }, [rules])

  const refetch = rulesQ.refetch

  /** Patch an existing row (by teams.id), or create one when the team has none yet. */
  const saveRule = useCallback(
    async (teamId: string | number, patch: Partial<BasketballTeamRule>) => {
      if (seasonId == null) return
      const existing = byTeam.get(String(teamId))
      if (existing) {
        await updateRecord('basketball_team_rules', existing.id, patch as Record<string, unknown>)
      } else {
        await createRecord('basketball_team_rules', {
          season: seasonId,
          team: teamId,
          created_by: user?.id ?? null,
          ...patch,
        })
      }
      await refetch()
    },
    [seasonId, user?.id, byTeam, refetch],
  )

  /** Create the rules row a team is missing, from `defaultRulePayload`. */
  const createRule = useCallback(
    async (team: Team) => {
      if (seasonId == null) return
      await createRecord('basketball_team_rules', {
        season: seasonId,
        team: team.id,
        created_by: user?.id ?? null,
        ...defaultRulePayload(team),
      })
      await refetch()
    },
    [seasonId, user?.id, refetch],
  )

  const removeRule = useCallback(
    async (id: string | number) => {
      await deleteRecord('basketball_team_rules', id)
      await refetch()
    },
    [refetch],
  )

  return {
    rules,
    byTeam,
    isLoading: rulesQ.isLoading,
    error: (rulesQ.error as Error | null) ?? null,
    saveRule,
    createRule,
    removeRule,
    refetch,
  }
}

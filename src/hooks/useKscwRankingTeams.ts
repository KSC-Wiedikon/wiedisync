import { useMemo } from 'react'
import { useCollection } from '../lib/query'
import { teamNameToColorKey, trimBBTeamName } from '../utils/teamColors'

/** A KSCW team as it appears in `rankings`, keyed by the ranking row's `team_id`. */
export interface KscwRankingTeam {
  /** `teams.name` — the same value the games team filter selects on. */
  name: string
  sport: 'volleyball' | 'basketball'
  /** Short display label ("H2" for BB "Herren 2"). */
  label: string
  /** Key for TeamChip / getTeamColor. */
  colorKey: string
}

interface TeamRow {
  name: string
  sport: 'volleyball' | 'basketball' | null
  team_id: string | null
  bb_source_id: string | number | null
}

/**
 * Which `rankings` rows are KSCW teams, derived from the active `teams` rows.
 *
 * Replaces the hardcoded `teamIds` map in utils/teamColors, which drifted every
 * season (missing HU20 + DU18 Spark, D1/D2 swapped after a promotion, renamed BB
 * teams). The ranking key is `teams.team_id` for volleyball but
 * `bb_<bb_source_id>` for basketball: bp-sync repoints `bb_source_id` on a
 * Basketplan rollover and leaves `team_id` stale (migration 369, DU18 Fire/Spark).
 */
export function useKscwRankingTeams(): Map<string, KscwRankingTeam> {
  const { data } = useCollection<TeamRow>('teams', {
    filter: { active: { _eq: true } },
    fields: ['name', 'sport', 'team_id', 'bb_source_id'],
    sort: ['name'],
    all: true,
  })
  return useMemo(() => {
    const map = new Map<string, KscwRankingTeam>()
    for (const t of data ?? []) {
      if (!t.sport) continue
      const key = t.sport === 'basketball' && t.bb_source_id ? `bb_${t.bb_source_id}` : t.team_id
      if (!key) continue
      map.set(key, {
        name: t.name,
        sport: t.sport,
        label: t.sport === 'basketball' ? trimBBTeamName(t.name) : t.name,
        colorKey: teamNameToColorKey(t.name, t.sport),
      })
    }
    return map
  }, [data])
}

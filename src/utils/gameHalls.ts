import type { Hall, Team } from '../types'
import { relId } from './relations'

// `relId` (utils/relations.ts) is the canonical relation-ID extractor. Re-exported
// here under the historical `normalizeRelId` name so existing importers (e.g.
// useGameConflicts) keep working without a second, drifting implementation.
export { relId as normalizeRelId } from './relations'

type GameHallFields = {
  hall?: string | number | null
  additional_halls?: string[] | null | undefined
  kscw_team?: string | number | null | { id: unknown }
}

export function allGameHallIds(
  game: GameHallFields,
  ctx?: { teams?: Team[]; halls?: Hall[] },
): string[] {
  const primary = game.hall ? [relId(game.hall)] : []
  const extras = (game.additional_halls ?? []).map((v) => relId(v))
  const ids = [...primary, ...extras].filter(Boolean)

  if (ids.length > 1) return Array.from(new Set(ids))

  // TODO: remove after backfill — see plan
  // Backward-compat: legacy basketball rows have no additional_halls. If the
  // primary hall is KWI A or KWI B and the team is basketball, span both.
  if (ids.length === 1 && ctx?.teams && ctx?.halls) {
    const team = ctx.teams.find((t) => String(t.id) === relId(game.kscw_team))
    if (team?.sport === 'basketball') {
      const primaryHall = ctx.halls.find((h) => String(h.id) === ids[0])
      if (primaryHall && (primaryHall.name === 'KWI A' || primaryHall.name === 'KWI B')) {
        const bbHalls = ctx.halls
          .filter((h) => h.name === 'KWI A' || h.name === 'KWI B')
          .map((h) => String(h.id))
        return Array.from(new Set([ids[0], ...bbHalls]))
      }
    }
  }

  return ids
}

export function hallsIntersect(
  a: GameHallFields,
  b: GameHallFields,
  ctx?: { teams?: Team[]; halls?: Hall[] },
): boolean {
  const aIds = new Set(allGameHallIds(a, ctx))
  if (aIds.size === 0) return false
  for (const id of allGameHallIds(b, ctx)) if (aIds.has(id)) return true
  return false
}

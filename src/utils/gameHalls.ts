import { relId } from './relations'

// `relId` (utils/relations.ts) is the canonical relation-ID extractor. Re-exported
// here under the historical `normalizeRelId` name so existing importers (e.g.
// useGameConflicts) keep working without a second, drifting implementation.
export { relId as normalizeRelId } from './relations'

type GameHallFields = {
  hall?: string | number | null
  additional_halls?: string[] | null | undefined
}

/**
 * Every hall a game books: `hall` plus `additional_halls`. A game across KWI A+B
 * (the big basketball court) is hall = KWI A, additional_halls = [KWI B]; any other
 * game is the one hall it names. Same rule as vb_slot_floors() in the database.
 *
 * There is deliberately no sport- or hall-name inference here. A "basketball in
 * KWI A or B means A+B" fallback lived here until 2026-10-28 and drew every
 * basketball game across both halls — two games side by side in A and B showed
 * as one double booking (user report, 26.10.2026).
 */
export function allGameHallIds(game: GameHallFields): string[] {
  const primary = game.hall ? [relId(game.hall)] : []
  // Array check, not `?? []`: a json OBJECT ('{}', written by a bp-sync bug
  // until 2026-10-25) is not iterable and took the whole view down.
  const extras = (Array.isArray(game.additional_halls) ? game.additional_halls : []).map((v) => relId(v))
  return Array.from(new Set([...primary, ...extras].filter(Boolean)))
}

export function hallsIntersect(a: GameHallFields, b: GameHallFields): boolean {
  const aIds = new Set(allGameHallIds(a))
  if (aIds.size === 0) return false
  for (const id of allGameHallIds(b)) if (aIds.has(id)) return true
  return false
}

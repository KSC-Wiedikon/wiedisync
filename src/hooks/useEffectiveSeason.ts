import { useCollection } from '../lib/query'
import { getCurrentSeason } from '../utils/dateHelpers'

/**
 * Resolves which season a season-scoped collection (`games`, `rankings`) should
 * display: the current season if it already has rows, otherwise the most recent
 * prior season that does. This lets the games/rankings/home views auto-flip to
 * the new season the instant sync data lands after a June-1 rollover, without
 * showing an empty page in the gap before Swiss Volley / Basketplan publish the
 * new season — and without ever showing stale data once the new season exists.
 *
 * Implemented as a single cheap query: the largest `season` that is `<= current`
 * (so a future season accidentally present is ignored). Falls back to the current
 * season string if the table is empty. Season strings are short form (`YYYY/YY`),
 * which sort lexically, so `-season` ordering is correct.
 */
export function useEffectiveSeason(collection: 'games' | 'rankings'): string {
  const current = getCurrentSeason()
  const { data } = useCollection<{ season: string }>(collection, {
    filter: { season: { _lte: current } },
    fields: ['season'],
    sort: ['-season'],
    limit: 1,
    staleTime: 60_000,
  })
  return data?.[0]?.season ?? current
}

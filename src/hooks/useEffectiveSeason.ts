import { useQuery } from '@tanstack/react-query'
import { fetchSeasons } from '../lib/api'
import { getCurrentSeason } from '../utils/dateHelpers'

/**
 * Resolves which season a season-scoped collection (`games`, `rankings`) should
 * display: the current season if it already has rows, otherwise the most recent
 * prior season that does. This lets the games/rankings/home views auto-flip to
 * the new season the instant sync data lands after a June-1 rollover, without
 * showing an empty page in the gap before Swiss Volley / Basketplan publish the
 * new season — and without ever showing stale data once the new season exists.
 *
 * Picks the largest stored `season` that is `<= current` (so a future season
 * accidentally present is ignored). Falls back to the current season string if
 * the table is empty. Season strings are short form (`YYYY/YY`) and sort
 * lexically, so the comparison and `-season` ordering are correct.
 *
 * The comparison is done client-side: Directus rejects `_lte`/`_lt` on
 * `string`-typed fields with a 400 (`"string" field type does not contain the
 * "_lte" filter operator`), so the season field can't be filtered server-side.
 * `fetchSeasons` uses a `groupBy` aggregate, so the payload is one row per
 * distinct season regardless of how many games/rankings each season holds.
 */
export function useEffectiveSeason(collection: 'games' | 'rankings'): string {
  const current = getCurrentSeason()
  const { data } = useQuery<string[]>({
    queryKey: ['effective-season', collection],
    queryFn: () => fetchSeasons(collection),
    staleTime: 60_000,
  })
  const effective = (data ?? [])
    .filter(s => s <= current)
    .sort()
    .pop()
  return effective ?? current
}

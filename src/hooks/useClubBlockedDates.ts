import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { kscwApi } from '../lib/api'
import { parseDate, toDateKey, eachDayOfInterval } from '../utils/dateUtils'

export interface ClubBlock {
  id: number
  start_date: string
  end_date: string
  reason: string | null
}

const NO_BLOCKS: Map<string, string> = new Map()

/**
 * Club-wide scheduling blackouts (`scheduling_global_blocks`, migration 160) —
 * a superadmin-set range that blocks HOME games for EVERY team (club holidays,
 * tournaments, the AGM). Distinct from `hall_closures` (the hall is shut) and from
 * per-team `scheduling_blocks`.
 *
 * Returns the ranges expanded to one entry per covered day: date key
 * (yyyy-MM-dd) -> reason (empty string when the block carries no reason).
 *
 * GET is open to any authenticated user; a caller who can't read them just gets an
 * empty map rather than an error, so the calendar still renders.
 */
export function useClubBlockedDates(): { blockedDates: Map<string, string>; isLoading: boolean } {
  const { data, isLoading } = useQuery<ClubBlock[]>({
    queryKey: ['club-blocked-dates'],
    queryFn: async () => {
      const res = await kscwApi<{ blocks: ClubBlock[] }>('/terminplanung/admin/club-blocked-dates')
      return res.blocks ?? []
    },
    staleTime: 5 * 60_000,
  })

  const blockedDates = useMemo(() => {
    if (!data || data.length === 0) return NO_BLOCKS
    const map = new Map<string, string>()
    for (const block of data) {
      for (const day of eachDayOfInterval(parseDate(block.start_date), parseDate(block.end_date))) {
        map.set(toDateKey(day), block.reason ?? '')
      }
    }
    return map
  }, [data])

  return { blockedDates, isLoading }
}

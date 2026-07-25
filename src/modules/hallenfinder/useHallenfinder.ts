import { useQuery } from '@tanstack/react-query'
import { kscwApi } from '../../lib/api'

export interface HallResult {
  einrichtungId: number
  name: string
  hallType: string | null
  address: string | null
  plz: string | null
  stadtkreis: string | null
  stadtquartier: string | null
  schulkreis: string | null
  weekday: number
  weeksTotal: number
  weeksFree: number
  freeAllNonHolidayWeeks: boolean
  sampleWindow: string | null
  detailsUrl: string
  belegungsplanUrl: string
  reservationUrl: string
}

export interface HallenfinderResponse {
  season: { start: string; end: string } | null
  lastUpdated: string | null
  count?: number
  results: HallResult[]
  note?: string
}

export interface HallenfinderFilters {
  weekdays: number[]
  startFrom: string
  minMinutes: number
  district: string | null
  hallType: string | null
  freeAllNonHolidayWeeks: boolean
}

export function useHallenfinder(filters: HallenfinderFilters) {
  const params = new URLSearchParams()
  if (filters.weekdays.length) params.set('weekday', filters.weekdays.join(','))
  params.set('startFrom', filters.startFrom)
  params.set('minMinutes', String(filters.minMinutes))
  if (filters.district) params.set('district', filters.district)
  if (filters.hallType) params.set('hallType', filters.hallType)
  params.set('freeAllNonHolidayWeeks', filters.freeAllNonHolidayWeeks ? '1' : '0')

  return useQuery({
    queryKey: ['hallenfinder', filters],
    queryFn: () => kscwApi<HallenfinderResponse>(`/hallenfinder/search?${params.toString()}`),
    staleTime: 5 * 60 * 1000,
  })
}

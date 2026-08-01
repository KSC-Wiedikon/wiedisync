import { useQuery } from '@tanstack/react-query'
import { kscwApi } from '../../lib/api'

export interface HallPartition {
  label: string | null
  sizeLabel: string | null
  length: number | null
  width: number | null
  height: number | null
  segment: string | null
}

export interface HallResult {
  einrichtungId: number
  name: string
  hallType: string | null
  address: string | null
  plz: string | null
  stadtkreis: string | null
  stadtquartier: string | null
  schulkreis: string | null
  // Migration 269 — dimensions + photo, all null until the monthly detail pass
  // runs. `sizeLabel` is the city's own string ("23,00 x 10,90 x 5,40 m") and is
  // what the table shows; the parsed numbers are kept for sorting, not display.
  hallTypeLabel: string | null
  sizeLabel: string | null
  lengthM: number | null
  widthM: number | null
  heightM: number | null
  partitions: HallPartition[]
  photoUrl: string | null
  photoThumbUrl: string | null
  contactEmail: string | null
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

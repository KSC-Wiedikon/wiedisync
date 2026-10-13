import { describe, it, expect } from 'vitest'
import { clubEventToVirtualSlots, clubEventHallIds } from '../virtualSlots'
import type { Event, Hall } from '../../../../types'

const halls = [
  { id: '1', name: 'KWI A' }, { id: '2', name: 'KWI B' }, { id: '3', name: 'KWI C' },
] as unknown as Hall[]
// Mon 19.10.2026 – Sun 25.10.2026, local midnight like the page's weekDays.
const week = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 19 + i))
const ev = (extra: Partial<Event>): Event => ({
  id: '33', title: 'Freundschaftsspiel DU18 Fire', location: '', all_day: false, cancelled: false,
  // 22.10.2026 18:30–20:00 Zurich = 16:30–18:00 UTC (CEST)
  start_date: '2026-10-22T16:30:00.000Z', end_date: '2026-10-22T18:00:00.000Z',
  hall: '3', additional_halls: null, ...extra,
} as unknown as Event)

describe('clubEventToVirtualSlots — a club event that books halls, in the grid', () => {
  it('draws the 22.10 friendly in KWI C, Thursday, 18:30–20:00 Zurich time', () => {
    const [s, ...rest] = clubEventToVirtualSlots(ev({}), week, halls)
    expect(rest).toHaveLength(0)
    expect(s).toMatchObject({ hall: '3', day_of_week: 3, start_time: '18:30', end_time: '20:00', slot_type: 'event', label: 'Freundschaftsspiel DU18 Fire' })
    expect(s._virtual).toMatchObject({ source: 'club_event', sourceId: '33' })
  })
  it('one slot per booked hall — A+C never reads as A+B+C', () => {
    const slots = clubEventToVirtualSlots(ev({ hall: '1', additional_halls: ['3'] }), week, halls)
    expect(slots.map((s) => s.hall)).toEqual(['1', '3'])
  })
  it('a multi-day event: first day from its start, last day until its end, whole days between', () => {
    // Ends Sun 25.10.2026 — the day summer time ends, so 14:00 UTC is 15:00 in Zurich.
    const slots = clubEventToVirtualSlots(ev({
      start_date: '2026-10-23T16:00:00.000Z', end_date: '2026-10-25T14:00:00.000Z',
    }), week, halls)
    expect(slots.map((s) => [s.day_of_week, s.start_time, s.end_time])).toEqual([
      [4, '18:00', '22:00'], [5, '10:00', '22:00'], [6, '10:00', '15:00'],
    ])
  })
  it('an all-day event fills the grid\'s range on its day', () => {
    const slots = clubEventToVirtualSlots(ev({ all_day: true, start_date: '2026-10-23T22:00:00.000Z', end_date: '2026-10-23T22:00:00.000Z' }), week, halls)
    expect(slots.map((s) => [s.day_of_week, s.start_time, s.end_time])).toEqual([[5, '10:00', '22:00']])
  })
  it('a cancelled event books nothing; an unknown hall draws nothing', () => {
    expect(clubEventToVirtualSlots(ev({ cancelled: true }), week, halls)).toEqual([])
    expect(clubEventToVirtualSlots(ev({ hall: '99' }), week, halls)).toEqual([])
  })
  it('clubEventHallIds merges hall and additional_halls without duplicates', () => {
    expect(clubEventHallIds({ hall: '1', additional_halls: ['2', '1', 3] as (string | number)[] })).toEqual(['1', '2', '3'])
  })
})

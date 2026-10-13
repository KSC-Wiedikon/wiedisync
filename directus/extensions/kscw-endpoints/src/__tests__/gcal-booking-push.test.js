import { describe, it, expect } from 'vitest'
import { buildBookingEvent, findBookingDuplicate } from '../gcal-push.js'

const HALLS = [
  { id: 1, name: 'KWI A' }, { id: 2, name: 'KWI B' }, { id: 3, name: 'KWI C' },
  { id: 4, name: 'Döltschi 1' },
]
const m = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

describe('buildBookingEvent — one calendar entry per booked day of a club event', () => {
  it('is a timed entry in Zurich time, halls in the games\' "Halle A+B" form', () => {
    const ev = buildBookingEvent({ eventId: 33, title: 'Freundschaftsspiel DU18 Fire', day: '2026-10-22', start: m('18:30'), end: m('20:00'), letters: ['C'] })
    expect(ev.summary).toBe('KSCW: Freundschaftsspiel DU18 Fire (Halle C)')
    expect(ev.start).toEqual({ dateTime: '2026-10-22T18:30:00', timeZone: 'Europe/Zurich' })
    expect(ev.end).toEqual({ dateTime: '2026-10-22T20:00:00', timeZone: 'Europe/Zurich' })
    expect(ev.location).toMatch(/^Halle C, Kantonsschule Wiedikon/)
  })

  it('marks it ours — booking key per event AND day, the environment stamped', () => {
    const ev = buildBookingEvent({ eventId: 33, title: 'x', day: '2026-10-22', start: 0, end: 60, letters: ['A', 'B'] })
    expect(ev.extendedProperties.private).toMatchObject({ wiedisync: 'booking', booking_key: '33|2026-10-22', event_id: '33' })
    expect(ev.extendedProperties.private.env).toMatch(/^(dev|prod)$/)
    expect(ev.summary).toBe('KSCW: x (Halle A+B)')
  })

  it('a whole day becomes an all-day entry (Google\'s end date is exclusive)', () => {
    const ev = buildBookingEvent({ eventId: 5, title: 'Turnier', day: '2026-11-21', start: 0, end: 24 * 60, letters: ['A'] })
    expect(ev.start).toEqual({ date: '2026-11-21' })
    expect(ev.end).toEqual({ date: '2026-11-22' })
  })

  it('a first day running to midnight ends at 00:00 of the next day', () => {
    const ev = buildBookingEvent({ eventId: 5, title: 'Turnier', day: '2026-11-20', start: m('18:00'), end: 24 * 60, letters: ['A'] })
    expect(ev.end).toEqual({ dateTime: '2026-11-21T00:00:00', timeZone: 'Europe/Zurich' })
  })

  it('never blocks anyone\'s own calendar', () => {
    expect(buildBookingEvent({ eventId: 1, title: 'x', day: '2026-10-22', start: 0, end: 60, letters: ['A'] }).transparency).toBe('transparent')
  })
})

describe('findBookingDuplicate — the hall administration already has it', () => {
  // Their entry for the 22.10.2026 friendly, as it sits in hall_events.
  const theirs = { title: 'Freundschaftsspiel BB DU18 FIRE - Zürich 93 DU16 (Halle C)', location: '', all_day: false, date: '2026-10-22', end_date: null, start_time: '18:30:00', end_time: '20:00:00' }
  const ours = (extra) => ({ day: '2026-10-22', start: m('18:30'), end: m('20:00'), hallIds: [3], ...extra })

  it('same hall, overlapping time → already there, not pushed again', () => {
    expect(findBookingDuplicate([theirs], HALLS, ours())).toBe(theirs)
  })
  it('a different hall the same evening is not a duplicate', () => {
    expect(findBookingDuplicate([theirs], HALLS, ours({ hallIds: [1] }))).toBeNull()
  })
  it('the same hall at a different time is not a duplicate', () => {
    expect(findBookingDuplicate([theirs], HALLS, ours({ start: m('20:00'), end: m('21:30') }))).toBeNull()
  })
  it('another day is not a duplicate', () => {
    expect(findBookingDuplicate([theirs], HALLS, ours({ day: '2026-10-23' }))).toBeNull()
  })
  it('their all-day entry naming no hall covers every KWI hall all day', () => {
    const closed = { title: 'Halle geschlossen', location: '', all_day: true, date: '2026-10-22', end_date: '2026-10-22', start_time: null, end_time: null }
    expect(findBookingDuplicate([closed], HALLS, ours({ hallIds: [1] }))).toBe(closed)
  })
})

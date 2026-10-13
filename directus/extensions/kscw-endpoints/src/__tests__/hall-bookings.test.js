import { describe, it, expect } from 'vitest'
import {
  parseNamedKwiHalls, entryHallIds, timeWindow, planTraining, eventHallIds, eventBookingDays,
  MIN_REMAINING_MINUTES, MAX_BOOKING_DAYS,
} from '../hall-bookings.js'

const HALLS = [
  { id: 1, name: 'KWI A' }, { id: 2, name: 'KWI B' }, { id: 3, name: 'KWI C' },
  { id: 4, name: 'Döltschi 1' },
]

describe('parseNamedKwiHalls', () => {
  it.each([
    ['Freundschaftsspiel BB DU18 FIRE - Zürich 93 DU16 (Halle C)', ['C']],
    ['VB D4 vs. Rüschlikon 4 (Halle A+B)', ['A', 'B']],
    ['Training (Halle KWI B)', ['B']],
    ['Hallen A, B und C reserviert', ['A', 'B', 'C']],
    ['Halle A/B', ['A', 'B']],
    ['Turnier KWI C', ['C']],
    ['Halle C and B', ['B', 'C']], // the "A" inside "AND" is not a hall
    // No hall named → the caller falls back to all KWI halls.
    ['Halle geschlossen', []],
    ['Hallen geschlossen', []],
    ['Halle Resveiert für Prüfung', []],
    ['KWI Turnhalle für Handballturnier Pfadi Gloggi', []],
    // Words that merely START with A/B/C after "Halle" are not halls.
    ['Halle Abgesagt', []],
    ['Halle Closed', []],
    ['Halle C und Aula', ['C']],
    ['', []],
  ])('%s → %j', (text, letters) => {
    expect(parseNamedKwiHalls(text)).toEqual(letters)
  })
})

describe('entryHallIds', () => {
  it('names only the halls in the title', () => {
    expect(entryHallIds({ title: 'Freundschaftsspiel (Halle C)' }, HALLS)).toEqual([3])
  })
  it('reads the location too', () => {
    expect(entryHallIds({ title: 'Turnier', location: 'Halle A+B, Kantonsschule Wiedikon' }, HALLS)).toEqual([1, 2])
  })
  it('falls back to every KWI hall — never an outside one — when none is named', () => {
    expect(entryHallIds({ title: 'Halle geschlossen' }, HALLS)).toEqual([1, 2, 3])
  })
})

describe('timeWindow', () => {
  const friendly = { all_day: false, date: '2026-10-22', end_date: '2026-10-22', start_time: '18:30:00', end_time: '20:00:00' }
  it('is the literal booked window, no warm-up added', () => {
    expect(timeWindow(friendly)).toEqual({ start: 18 * 60 + 30, end: 20 * 60 })
  })
  it('accepts a missing end_date as the same day', () => {
    expect(timeWindow({ ...friendly, end_date: null })).not.toBeNull()
  })
  it.each([
    ['all-day', { ...friendly, all_day: true }],
    ['no start time', { ...friendly, start_time: null }],
    ['no end time', { ...friendly, end_time: null }],
    ['end before start', { ...friendly, end_time: '17:00:00' }],
    ['multi-day', { ...friendly, end_date: '2026-10-23' }],
  ])('%s → a whole-day closure, not a block', (_, entry) => {
    expect(timeWindow(entry)).toBeNull()
  })
})

const tr = (start, end, extra = {}) => ({ start_time: `${start}:00`, end_time: `${end}:00`, ...extra })
const block = (id, start, end, title = 'Freundschaftsspiel') => {
  const m = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  return { key: `calendar:${id}`, start: m(start), end: m(end), title }
}
const hm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const show = (p) => (p.kind === 'adjust' ? `${hm(p.start)}–${hm(p.end)}` : p.kind)

describe('planTraining — the 22.10.2026 friendly in KWI C, 18:30–20:00', () => {
  const friendly = [block(149, '18:30', '20:00')]
  it('cancels the training it fully covers (DU18 Fire 18:30–20:00)', () => {
    expect(planTraining(tr('18:30', '20:00'), friendly)).toMatchObject({ kind: 'cancel', key: 'calendar:149', reason: 'Freundschaftsspiel' })
  })
  it('leaves the trainings either side of it alone (they only touch)', () => {
    expect(planTraining(tr('17:00', '18:30'), friendly).kind).toBe('none')
    expect(planTraining(tr('20:00', '21:30'), friendly).kind).toBe('none')
  })
})

describe('planTraining — trim rules', () => {
  it('cuts the end when the block starts mid-training', () => {
    expect(show(planTraining(tr('17:00', '19:00'), [block(1, '18:00', '20:00')]))).toBe('17:00–18:00')
  })
  it('pushes the start when the block ends mid-training', () => {
    expect(show(planTraining(tr('19:30', '21:30'), [block(1, '18:00', '20:00')]))).toBe('20:00–21:30')
  })
  it('keeps the longer part when the block sits inside the training', () => {
    expect(show(planTraining(tr('18:00', '22:00'), [block(1, '18:30', '19:00')]))).toBe('19:00–22:00')
    expect(show(planTraining(tr('18:00', '22:00'), [block(1, '21:00', '21:30')]))).toBe('18:00–21:00')
  })
  it('keeps the usual start on a tie', () => {
    expect(show(planTraining(tr('18:00', '21:00'), [block(1, '19:00', '20:00')]))).toBe('18:00–19:00')
  })
  it(`cancels when under ${MIN_REMAINING_MINUTES} minutes would be left`, () => {
    expect(planTraining(tr('18:00', '19:30'), [block(1, '18:10', '19:30')]).kind).toBe('cancel')
    expect(show(planTraining(tr('18:00', '19:30'), [block(1, '18:30', '19:30')]))).toBe('18:00–18:30')
  })
  it('subtracts every block of the evening, not just the first', () => {
    const p = planTraining(tr('17:00', '22:00'), [block(2, '20:00', '21:00'), block(1, '17:30', '19:00')])
    expect(show(p)).toBe('19:00–20:00')
    expect(p.key).toBe('calendar:1') // the earliest booking is the one named on the training
  })
  it('recomputes from the PLANNED times, so a re-run does not trim the trimmed version', () => {
    const trimmed = tr('17:00', '18:00', { original_end_time: '19:00:00' })
    expect(show(planTraining(trimmed, [block(1, '18:00', '20:00')]))).toBe('17:00–18:00')
    // Block moved later → the training gets more time back, up to its plan.
    expect(show(planTraining(trimmed, [block(1, '18:30', '20:00')]))).toBe('17:00–18:30')
    // Block gone → nothing to do; the sweep restores the originals.
    expect(planTraining(trimmed, []).kind).toBe('none')
  })
  it('ignores a training without usable times', () => {
    expect(planTraining({ start_time: null, end_time: '19:00:00' }, [block(1, '18:00', '20:00')]).kind).toBe('none')
  })
})

describe('eventHallIds', () => {
  it('books hall plus additional_halls, deduplicated, ids as numbers', () => {
    expect(eventHallIds({ hall: 1, additional_halls: ['2', 1] })).toEqual([1, 2])
  })
  it('reads a JSON string and tolerates junk', () => {
    expect(eventHallIds({ hall: 3, additional_halls: '[1]' })).toEqual([3, 1])
    expect(eventHallIds({ hall: 3, additional_halls: 'not json' })).toEqual([3])
    expect(eventHallIds({ hall: null, additional_halls: null })).toEqual([])
  })
})

describe('eventBookingDays', () => {
  it('a friendly books its own evening window', () => {
    expect(eventBookingDays({ all_day: false, start_day: '2026-10-22', start_hm: '18:30', end_day: '2026-10-22', end_hm: '20:00' }))
      .toEqual([{ day: '2026-10-22', start: 18 * 60 + 30, end: 20 * 60 }])
  })
  it('a timed weekend books from its start, whole days between, until its end', () => {
    expect(eventBookingDays({ all_day: false, start_day: '2026-11-20', start_hm: '18:00', end_day: '2026-11-22', end_hm: '16:00' }))
      .toEqual([
        { day: '2026-11-20', start: 18 * 60, end: 24 * 60 },
        { day: '2026-11-21', start: 0, end: 24 * 60 },
        { day: '2026-11-22', start: 0, end: 16 * 60 },
      ])
  })
  it('an all-day event books whole days, end day included', () => {
    expect(eventBookingDays({ all_day: true, start_day: '2026-11-21', start_hm: '00:00', end_day: '2026-11-22', end_hm: '00:00' }).map((d) => d.day))
      .toEqual(['2026-11-21', '2026-11-22'])
  })
  it('a timed event without a real end books nothing', () => {
    expect(eventBookingDays({ all_day: false, start_day: '2026-10-22', start_hm: '18:30', end_day: '2026-10-22', end_hm: '18:30' })).toEqual([])
  })
  it(`stops after ${MAX_BOOKING_DAYS} days`, () => {
    expect(eventBookingDays({ all_day: true, start_day: '2026-11-01', end_day: '2027-02-01' })).toHaveLength(MAX_BOOKING_DAYS)
  })
})

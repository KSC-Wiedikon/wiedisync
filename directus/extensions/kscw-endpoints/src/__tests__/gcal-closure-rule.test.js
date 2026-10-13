import { describe, it, expect } from 'vitest'
import { closesTheHall, materiallyChanged } from '../gcal-sync.js'

// Migration 325 made every hall-administration entry close the KWI halls unless
// an admin refused it. Migration 409 turned that round after a friendly typed
// onto the calendar (18:30–20:00, Halle C) closed all three halls for the whole
// day and cancelled six trainings with nobody asked: now nothing takes effect
// until an admin APPROVES it.
describe('closesTheHall — only an approved entry does anything', () => {
  it('approved closes', () => {
    expect(closesTheHall(true)).toBe(true)
  })

  it('pending (no decision yet) does nothing', () => {
    expect(closesTheHall(null)).toBe(false)
    expect(closesTheHall(undefined)).toBe(false)
  })

  it('refused does nothing', () => {
    expect(closesTheHall(false)).toBe(false)
  })

  // Wording still decides nothing — the decision is the only input. These
  // titles are real entries off the live KWI feed.
  it.each([
    'Halle Resveiert für Prüfung',
    'Halle Geschlossen',
    'Freundschaftsspiel BB DU18 FIRE - Zürich 93 DU16 (Halle C)',
    '',
  ])('a pending entry does nothing whatever its title (%s)', () => {
    expect(closesTheHall(null)).toBe(false)
  })

  // Anything that is not an explicit approval is not one.
  it.each([1, 'true', 'yes', {}])('junk is not an approval (%p)', (v) => {
    expect(closesTheHall(v)).toBe(false)
  })
})

describe('materiallyChanged — when an approval no longer holds', () => {
  const base = {
    title: 'Halle geschlossen', location: '', all_day: true,
    date: new Date('2026-10-24T00:00:00Z'), end_date: new Date('2026-10-25T00:00:00Z'),
    start_time: null, end_time: null,
  }
  it('a re-run of the same entry keeps the decision', () => {
    expect(materiallyChanged(base, { ...base, date: '2026-10-24', end_date: '2026-10-25' })).toBe(false)
  })
  it('a re-wording keeps the decision', () => {
    expect(materiallyChanged(base, { ...base, date: '2026-10-24', end_date: '2026-10-25', title: 'Halle Geschlossen!' })).toBe(false)
  })
  it.each([
    ['moved', { date: '2026-10-31', end_date: '2026-11-01' }],
    ['longer', { date: '2026-10-24', end_date: '2026-10-26' }],
    ['now timed', { date: '2026-10-24', end_date: '2026-10-24', all_day: false, start_time: '08:00', end_time: '12:00' }],
    ['names a hall now', { date: '2026-10-24', end_date: '2026-10-25', title: 'Halle C geschlossen' }],
  ])('%s → back to pending', (_, patch) => {
    expect(materiallyChanged(base, { ...base, ...patch })).toBe(true)
  })
  it('a new time on a timed entry → back to pending', () => {
    const timed = { ...base, all_day: false, end_date: base.date, start_time: '18:30:00', end_time: '20:00:00' }
    expect(materiallyChanged(timed, { ...timed, date: '2026-10-24', end_date: '2026-10-24', start_time: '18:30', end_time: '20:00' })).toBe(false)
    expect(materiallyChanged(timed, { ...timed, date: '2026-10-24', end_date: '2026-10-24', start_time: '18:00', end_time: '20:00' })).toBe(true)
  })
})

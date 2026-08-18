import { describe, it, expect } from 'vitest'
import { closesTheHall } from '../gcal-sync.js'

// Migration 325 inverted the rule: a keyword test decided what counted as a
// closure until `Halle Resveiert für Prüfung` slipped past `reserv` and left six
// KWI trainings standing in a hall the school had booked for an exam.
describe('closesTheHall — every hall-administration entry closes, unless overridden', () => {
  it('closes by default (no override recorded)', () => {
    expect(closesTheHall(null)).toBe(true)
    expect(closesTheHall(undefined)).toBe(true)
  })

  it('the admin override is the ONLY way out', () => {
    expect(closesTheHall(false)).toBe(false)
  })

  it('an explicit admin yes still closes', () => {
    expect(closesTheHall(true)).toBe(true)
  })

  // The whole point of the flip: wording must no longer decide anything. These
  // titles are real entries off the live KWI feed — the first one is the typo
  // that defeated the old keyword test.
  it.each([
    'Halle Resveiert für Prüfung',
    'Halle Geschlossen',
    'Turnhalle Geschlossen',
    'Miniturnier KSCW',
    'ASVZ Volleynight 2026',
    'Spielsamstag',
    '',
  ])('closes regardless of the title (%s)', () => {
    expect(closesTheHall(undefined)).toBe(true)
  })

  // A pre-325 row read through an older client, or any non-boolean garbage,
  // must fail CLOSED (the hall is shut) rather than silently open a booked hall.
  it.each([0, '', 'false', NaN])('fails closed on non-false junk (%p)', (v) => {
    expect(closesTheHall(v)).toBe(true)
  })
})

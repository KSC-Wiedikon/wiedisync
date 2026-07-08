/**
 * Unit tests for the J+S export pure helpers (js-export.js) — the row-shaping
 * rules that carry the BASPO NDS format invariants:
 *   • DATUM is Swiss dot format dd.mm.yyyy.
 *   • Wettkampf rows carry NO time and NO location (spec forbids them).
 *   • Trainingstag carries a duration ≥240, Lagertag carries none.
 *   • Training duration honours the migration-191 game auto-shorten.
 *   • Attendance exclusion uses the POSITIVE absence signal only (date-range,
 *     weekly-aware) — a person is present unless explicitly absent/declined.
 *
 * Hermetic — pure functions, no DB or network.
 */
import { describe, it, expect } from 'vitest'
import {
  ymdToDots, hhmm, sanitizeDauer, computeTrainingMinutes, applyJsFieldRules,
  weekdayMon0, absenceCoversDate, seasonWindow, parseYmd,
} from '../js-export.js'

describe('date/time formatting', () => {
  it('ymdToDots → Swiss dd.mm.yyyy', () => {
    expect(ymdToDots('2026-07-10')).toBe('10.07.2026')
    expect(ymdToDots('2026-07-10T00:00:00Z')).toBe('10.07.2026')
    expect(ymdToDots('')).toBe('')
    expect(ymdToDots(null)).toBe('')
  })
  it('hhmm truncates to HH:MM and zero-pads', () => {
    expect(hhmm('16:15:00')).toBe('16:15')
    expect(hhmm('9:05')).toBe('09:05')
    expect(hhmm('')).toBe('')
    expect(hhmm(null)).toBe('')
  })
})

describe('sanitizeDauer', () => {
  it('accepts sane positive minutes, rejects the rest', () => {
    expect(sanitizeDauer(90)).toBe(90)
    expect(sanitizeDauer('120')).toBe(120)
    expect(sanitizeDauer(0)).toBe('')
    expect(sanitizeDauer(-30)).toBe('')
    expect(sanitizeDauer(9999)).toBe('')
    expect(sanitizeDauer('abc')).toBe('')
  })
})

describe('computeTrainingMinutes', () => {
  it('end − start in minutes', () => {
    expect(computeTrainingMinutes({ start_time: '16:15', end_time: '17:45' })).toBe(90)
    expect(computeTrainingMinutes({ start_time: '18:00:00', end_time: '20:00:00' })).toBe(120)
  })
  it('uses original_end_time when the block was game-shortened (migration 191)', () => {
    expect(computeTrainingMinutes({
      start_time: '18:00', end_time: '19:00',
      auto_shortened_by_game: 42, original_end_time: '20:00',
    })).toBe(120)
  })
  it('returns "" for invalid / non-positive spans', () => {
    expect(computeTrainingMinutes({ start_time: '20:00', end_time: '19:00' })).toBe('')
    expect(computeTrainingMinutes({ start_time: '', end_time: '19:00' })).toBe('')
  })
})

describe('applyJsFieldRules — per-type field suppression', () => {
  const raw = { zeit: '16:15', dauer: 90, ort: 'KWI C' }
  it('Training keeps time, duration and location', () => {
    expect(applyJsFieldRules('Training', raw)).toEqual({ zeit: '16:15', dauer: 90, ort: 'KWI C' })
  })
  it('Wettkampf drops time and location, uses the fixed game duration', () => {
    expect(applyJsFieldRules('Wettkampf', raw, { gameMin: 120 })).toEqual({ zeit: '', dauer: 120, ort: '' })
  })
  it('Trainingstag drops time/location, floors duration at 240', () => {
    expect(applyJsFieldRules('Trainingstag', { zeit: '09:00', dauer: 90, ort: 'x' })).toEqual({ zeit: '', dauer: 240, ort: '' })
    expect(applyJsFieldRules('Trainingstag', { zeit: '', dauer: 300, ort: '' })).toEqual({ zeit: '', dauer: 300, ort: '' })
  })
  it('Lagertag carries date only', () => {
    expect(applyJsFieldRules('Lagertag', raw)).toEqual({ zeit: '', dauer: '', ort: '' })
  })
  it('unknown type falls back to Training rules', () => {
    expect(applyJsFieldRules('Blah', raw)).toEqual({ zeit: '16:15', dauer: 90, ort: 'KWI C' })
  })
})

describe('weekdayMon0', () => {
  it('0=Mon .. 6=Sun', () => {
    expect(weekdayMon0('2026-07-06')).toBe(0) // Monday
    expect(weekdayMon0('2026-07-10')).toBe(4) // Friday
    expect(weekdayMon0('2026-07-12')).toBe(6) // Sunday
  })
})

describe('absenceCoversDate', () => {
  it('standard absence covers any day in [start,end]', () => {
    const a = { start_ymd: '2026-07-01', end_ymd: '2026-07-31', type: 'standard', days_of_week: [] }
    expect(absenceCoversDate(a, '2026-07-10', weekdayMon0('2026-07-10'))).toBe(true)
    expect(absenceCoversDate(a, '2026-08-01', weekdayMon0('2026-08-01'))).toBe(false)
  })
  it('weekly absence only covers matching weekdays within range', () => {
    const monday = { start_ymd: '2026-07-01', end_ymd: '2026-07-31', type: 'weekly', days_of_week: [0] }
    expect(absenceCoversDate(monday, '2026-07-06', weekdayMon0('2026-07-06'))).toBe(true)  // Mon
    expect(absenceCoversDate(monday, '2026-07-10', weekdayMon0('2026-07-10'))).toBe(false) // Fri
  })
})

describe('seasonWindow', () => {
  it('YYYY/YY → Sep 1 .. Aug 31', () => {
    expect(seasonWindow('2025/26')).toEqual({ season: '2025/26', start: '2025-09-01', end: '2026-08-31' })
  })
  it('rejects malformed input', () => {
    expect(seasonWindow('2025/2026')).toBeNull()
    expect(seasonWindow('nope')).toBeNull()
    expect(seasonWindow('')).toBeNull()
  })
})

describe('parseYmd — explicit date-window override', () => {
  it('accepts real calendar dates', () => {
    expect(parseYmd('2026-09-01')).toBe('2026-09-01')
    expect(parseYmd('2026-08-31')).toBe('2026-08-31')
  })
  it('rejects malformed or impossible dates', () => {
    expect(parseYmd('2026-13-40')).toBeNull()
    expect(parseYmd('2026-02-30')).toBeNull()
    expect(parseYmd('10.05.2026')).toBeNull()
    expect(parseYmd('')).toBeNull()
    expect(parseYmd(null)).toBeNull()
    expect(parseYmd(undefined)).toBeNull()
  })
})

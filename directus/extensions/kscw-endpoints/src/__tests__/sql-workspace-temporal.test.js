/**
 * Unit tests for `pgTemporalToText` — the per-column normaliser the SQL
 * workspace runs over every result row before `res.json()`.
 *
 * Why this exists. node-postgres parses a `date` (and a zone-less `timestamp`)
 * into a JS Date built with local constructors, and `res.json()` serialises a
 * Date with `toISOString()` — so `games.date = 2026-09-15` left the endpoint as
 * `2026-09-15T00:00:00.000Z` and the console showed "15.09.2026 02:00".
 * Surfaced 11.09.2026. The normaliser puts Postgres's own text back, using the
 * same local fields postgres-date used to build the Date, so the result does
 * not depend on the container's zone. `timestamptz` is an instant and must
 * pass through untouched.
 */
import { describe, it, expect } from 'vitest'
import { pgTemporalToText } from '../sql-workspace.js'

const DATE = 1082
const DATE_ARRAY = 1182
const TIMESTAMP = 1114
const TIMESTAMP_ARRAY = 1115
const TIMESTAMPTZ = 1184
const TEXT = 25

describe('pgTemporalToText', () => {
  it('turns a date column back into YYYY-MM-DD', () => {
    // postgres-date: `new Date(y, m, d)` in the process zone.
    expect(pgTemporalToText(DATE, new Date(2026, 8, 15))).toBe('2026-09-15')
    expect(pgTemporalToText(DATE, new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('turns a zone-less timestamp back into its wall-clock text', () => {
    expect(pgTemporalToText(TIMESTAMP, new Date(2026, 8, 15, 20, 0, 0))).toBe('2026-09-15 20:00:00')
    expect(pgTemporalToText(TIMESTAMP, new Date(2026, 8, 15, 7, 5, 9, 40))).toBe('2026-09-15 07:05:09.040')
  })

  it('maps array columns element-wise', () => {
    expect(pgTemporalToText(DATE_ARRAY, [new Date(2026, 8, 15), null, new Date(2026, 8, 16)]))
      .toEqual(['2026-09-15', null, '2026-09-16'])
    expect(pgTemporalToText(TIMESTAMP_ARRAY, [new Date(2026, 8, 15, 20, 0, 0)]))
      .toEqual(['2026-09-15 20:00:00'])
  })

  it('leaves timestamptz, text and nulls exactly as they are', () => {
    const instant = new Date('2026-09-10T12:32:00.000Z')
    expect(pgTemporalToText(TIMESTAMPTZ, instant)).toBe(instant)
    expect(pgTemporalToText(TEXT, '2026-09-15')).toBe('2026-09-15')
    expect(pgTemporalToText(DATE, null)).toBeNull()
    expect(pgTemporalToText(DATE, undefined)).toBeUndefined()
  })

  it('passes a date column through when it is already text', () => {
    // A host that registers its own pg type parser hands strings over.
    expect(pgTemporalToText(DATE, '2026-09-15')).toBe('2026-09-15')
  })
})

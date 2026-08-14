import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseTypedDate, formatDateZurich } from './dateHelpers'

describe('parseTypedDate', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads Swiss day-first dates, padded or not', () => {
    expect(parseTypedDate('10.05.2026')).toBe('2026-05-10')
    expect(parseTypedDate('1.5.2026')).toBe('2026-05-01')
    expect(parseTypedDate('  24.03.1998  ')).toBe('1998-03-24')
  })

  it('accepts slash and dash separators in the same day-first order', () => {
    expect(parseTypedDate('10/05/2026')).toBe('2026-05-10')
    expect(parseTypedDate('10-05-2026')).toBe('2026-05-10')
  })

  /**
   * ⚠ The whole app renders dd.mm.yyyy, so text that a user could have copied
   * out of the UI must round-trip. An en-US reading of `03.04.2026` (4 March)
   * would silently change the date somebody just retyped.
   */
  it('is day-first, never month-first', () => {
    expect(parseTypedDate('03.04.2026')).toBe('2026-04-03')
    expect(parseTypedDate(formatDateZurich('2026-04-03'))).toBe('2026-04-03')
  })

  it('reads a 4-digit leading token as ISO year-first', () => {
    expect(parseTypedDate('2026-05-10')).toBe('2026-05-10')
    expect(parseTypedDate('2026.5.10')).toBe('2026-05-10')
  })

  it('reads bare digits day-first, falling back to yyyymmdd only when it must', () => {
    expect(parseTypedDate('10052026')).toBe('2026-05-10')
    // 20 26 as day/month is impossible (month 26), so this can only be ISO.
    expect(parseTypedDate('20260510')).toBe('2026-05-10')
    expect(parseTypedDate('100526')).toBe('2026-05-10')
  })

  it('expands a 2-digit year on the sliding window around today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T12:00:00Z'))
    expect(parseTypedDate('10.05.26')).toBe('2026-05-10')
    expect(parseTypedDate('24.03.98')).toBe('1998-03-24')
    // The boundary itself is "this century": 26 <= 26.
    expect(parseTypedDate('01.01.27')).toBe('1927-01-01')
  })

  it('rejects impossible calendar dates instead of rolling them over', () => {
    // new Date(2026, 1, 31) would silently answer 3 March.
    expect(parseTypedDate('31.02.2026')).toBeNull()
    expect(parseTypedDate('29.02.2025')).toBeNull()
    expect(parseTypedDate('29.02.2024')).toBe('2024-02-29')
    expect(parseTypedDate('32.01.2026')).toBeNull()
    expect(parseTypedDate('10.13.2026')).toBeNull()
  })

  it('returns null for anything that is not a date', () => {
    expect(parseTypedDate('')).toBeNull()
    expect(parseTypedDate('   ')).toBeNull()
    expect(parseTypedDate(null)).toBeNull()
    expect(parseTypedDate(undefined)).toBeNull()
    expect(parseTypedDate('10.05.')).toBeNull()
    expect(parseTypedDate('tomorrow')).toBeNull()
    expect(parseTypedDate('12345678')).toBeNull()
    expect(parseTypedDate('10.05.2026.01')).toBeNull()
  })

  /** Guards the `Date.UTC` 0-99 → 19xx remapping and truncated 3-digit years. */
  it('refuses years below 1000 rather than remapping them', () => {
    expect(parseTypedDate('10.5.202')).toBeNull()
    expect(parseTypedDate('0026-05-10')).toBeNull()
  })
})

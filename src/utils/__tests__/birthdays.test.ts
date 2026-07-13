import { describe, it, expect } from 'vitest'
import {
  isBirthdayVisible,
  birthMonthDay,
  birthdayOccurrence,
  nextBirthday,
  upcomingBirthdays,
  birthdayOccurrencesInRange,
} from '../birthdays'
import type { Member } from '../../types'

// Minimal member shape — only the fields the util reads (mirrors the util's
// internal BirthdayMember, which isn't exported).
type TestMember = Pick<Member, 'first_name' | 'last_name'> & {
  id: string
  birthdate: string | null
  birthdate_visibility: string | null
}

// Minimal member factory — only the fields the util reads.
function m(overrides: Partial<TestMember> = {}): TestMember {
  return {
    id: '1',
    first_name: 'Anna',
    last_name: 'Meier',
    birthdate: '1990-05-10',
    birthdate_visibility: 'full',
    ...overrides,
  }
}

describe('isBirthdayVisible', () => {
  it('true only for full visibility with a birthdate', () => {
    expect(isBirthdayVisible(m())).toBe(true)
  })
  it('false for year_only (day/month hidden)', () => {
    expect(isBirthdayVisible(m({ birthdate_visibility: 'year_only' }))).toBe(false)
  })
  it('false for hidden', () => {
    expect(isBirthdayVisible(m({ birthdate_visibility: 'hidden' }))).toBe(false)
  })
  it('false when birthdate missing', () => {
    expect(isBirthdayVisible(m({ birthdate: null }))).toBe(false)
    expect(isBirthdayVisible(m({ birthdate: '' }))).toBe(false)
  })
})

describe('birthMonthDay', () => {
  it('parses YYYY-MM-DD ignoring any time part', () => {
    expect(birthMonthDay('1990-05-10')).toEqual({ year: 1990, month: 5, day: 10 })
    expect(birthMonthDay('1990-05-10T00:00:00')).toEqual({ year: 1990, month: 5, day: 10 })
  })
  it('returns null for malformed / empty input', () => {
    expect(birthMonthDay(null)).toBeNull()
    expect(birthMonthDay('nonsense')).toBeNull()
    expect(birthMonthDay('1990-13-01')).toBeNull()
  })
})

describe('birthdayOccurrence — Feb 29 handling', () => {
  it('keeps Feb 29 in a leap year', () => {
    const d = birthdayOccurrence(2, 29, 2028) // 2028 is a leap year
    expect(d.getMonth()).toBe(1)
    expect(d.getDate()).toBe(29)
  })
  it('clamps Feb 29 to Feb 28 in a non-leap year (no roll to March)', () => {
    const d = birthdayOccurrence(2, 29, 2027) // not a leap year
    expect(d.getMonth()).toBe(1) // still February
    expect(d.getDate()).toBe(28)
  })
})

describe('nextBirthday', () => {
  it('returns daysUntil 0 and isToday for a birthday today', () => {
    const from = new Date(2026, 4, 10) // 10 May 2026
    const b = nextBirthday(m({ birthdate: '1990-05-10' }), from)
    expect(b).not.toBeNull()
    expect(b!.daysUntil).toBe(0)
    expect(b!.isToday).toBe(true)
    expect(b!.age).toBe(36) // turns 36 in 2026
  })
  it('rolls to next year once the birthday has passed', () => {
    const from = new Date(2026, 4, 11) // 11 May 2026, day after
    const b = nextBirthday(m({ birthdate: '1990-05-10' }), from)
    expect(b!.date.getFullYear()).toBe(2027)
    expect(b!.age).toBe(37)
    expect(b!.daysUntil).toBeGreaterThan(300)
  })
  it('counts an upcoming birthday later this month', () => {
    const from = new Date(2026, 4, 4) // 4 May 2026
    const b = nextBirthday(m({ birthdate: '2000-05-10' }), from)
    expect(b!.daysUntil).toBe(6)
    expect(b!.isToday).toBe(false)
    expect(b!.age).toBe(26)
  })
  it('returns null for non-visible members', () => {
    expect(nextBirthday(m({ birthdate_visibility: 'hidden' }), new Date(2026, 4, 10))).toBeNull()
    expect(nextBirthday(m({ birthdate_visibility: 'year_only' }), new Date(2026, 4, 10))).toBeNull()
  })
})

describe('upcomingBirthdays', () => {
  const from = new Date(2026, 4, 10) // 10 May 2026
  it('keeps only those within the window, sorted soonest-first, deduped', () => {
    const members = [
      m({ id: '1', first_name: 'Today', birthdate: '1990-05-10' }),   // day 0
      m({ id: '2', first_name: 'In3', birthdate: '1995-05-13' }),     // day 3
      m({ id: '2', first_name: 'Dup', birthdate: '1995-05-13' }),     // duplicate id → dropped
      m({ id: '3', first_name: 'Far', birthdate: '1995-06-20' }),     // outside 7d
      m({ id: '4', first_name: 'Hidden', birthdate: '1995-05-11', birthdate_visibility: 'hidden' }),
    ]
    const result = upcomingBirthdays(members, from, 7)
    expect(result.map((r) => r.member.first_name)).toEqual(['Today', 'In3'])
    expect(result[0].daysUntil).toBe(0)
    expect(result[1].daysUntil).toBe(3)
  })
})

describe('birthdayOccurrencesInRange', () => {
  it('emits one occurrence per intersecting year within the range', () => {
    // Range straddles a year boundary: Dec 2026 → Jan 2027.
    const start = new Date(2026, 11, 20) // 20 Dec 2026
    const end = new Date(2027, 0, 10)    // 10 Jan 2027
    const occ = birthdayOccurrencesInRange(m({ birthdate: '2000-01-05' }), start, end)
    expect(occ).toHaveLength(1)
    expect(occ[0].date.getFullYear()).toBe(2027)
    expect(occ[0].age).toBe(27)
  })
  it('returns nothing when the birthday falls outside the range', () => {
    const start = new Date(2026, 4, 1)
    const end = new Date(2026, 4, 8)
    expect(birthdayOccurrencesInRange(m({ birthdate: '1990-05-10' }), start, end)).toHaveLength(0)
  })
  it('returns nothing for non-visible members', () => {
    const start = new Date(2026, 4, 1)
    const end = new Date(2026, 4, 31)
    expect(birthdayOccurrencesInRange(m({ birthdate_visibility: 'hidden' }), start, end)).toHaveLength(0)
  })
})

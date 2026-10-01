import { describe, it, expect } from 'vitest'
import { plusDays } from './familyAgenda'

describe('plusDays', () => {
  it('crosses month and year ends', () => {
    expect(plusDays('2026-10-01', 21)).toBe('2026-10-22')
    expect(plusDays('2026-12-20', 21)).toBe('2027-01-10')
  })
  it('is calendar arithmetic across the DST switch', () => {
    expect(plusDays('2026-10-20', 7)).toBe('2026-10-27')
  })
})

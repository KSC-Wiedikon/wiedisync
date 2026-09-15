/**
 * The two pure helpers behind GET /kscw/admin/vm-team-assign's plan. Both
 * encode a 2026-09-15 finding: `sv_vm_check.team_ids` is written as
 * `join(', ')`, and `members.license_nr` keeps ClubDesk's leading zeros while
 * VM's associationId is an integer.
 */
import { describe, it, expect } from 'vitest'
import { isOnVmTeam, normalizeLicenceNr } from '../vm-team-assign.js'

describe('isOnVmTeam', () => {
  it('matches every team in a comma+space list, not only the first', () => {
    expect(isOnVmTeam('2301, 1393', 2301)).toBe(true)
    expect(isOnVmTeam('2301, 1393', 1393)).toBe(true)
    expect(isOnVmTeam('2301,1393', 1393)).toBe(true)
    expect(isOnVmTeam('1393', '1393')).toBe(true)
  })
  it('never matches a prefix, an empty list or a missing team', () => {
    expect(isOnVmTeam('13930, 2301', 1393)).toBe(false)
    expect(isOnVmTeam('', 1393)).toBe(false)
    expect(isOnVmTeam(null, 1393)).toBe(false)
    expect(isOnVmTeam('2301', null)).toBe(false)
  })
})

describe('normalizeLicenceNr', () => {
  it('drops leading zeros and whitespace, keeps the rest', () => {
    expect(normalizeLicenceNr('038514')).toBe('38514')
    expect(normalizeLicenceNr(' 87458 ')).toBe('87458')
    expect(normalizeLicenceNr(87458)).toBe('87458')
  })
  it('reads placeholders and blanks as no licence number', () => {
    expect(normalizeLicenceNr('TBD')).toBeNull()
    expect(normalizeLicenceNr('')).toBeNull()
    expect(normalizeLicenceNr(null)).toBeNull()
    expect(normalizeLicenceNr('12a')).toBeNull()
  })
})

// Member values (migration 415): slugs in wiedisync, German at the ClubDesk border.
import { describe, it, expect } from 'vitest'
import {
  normalizeSalutation, salutationToClubdesk, salutationForSex,
  normalizeCantonalSchool, cantonalSchoolToLegacy,
  normalizeLicenceCategory, licenceCategoryToClubdesk,
} from '../member-values.js'

describe('member values', () => {
  it('salutation', () => {
    expect(normalizeSalutation('Herr')).toBe('mr')
    expect(normalizeSalutation('frau')).toBe('ms')
    expect(normalizeSalutation('')).toBeNull()
    expect(salutationToClubdesk('ms')).toBe('Frau')
    expect(salutationToClubdesk('Herr')).toBe('Herr')
    expect(salutationForSex('m')).toBe('mr')
    expect(salutationForSex(null)).toBeNull()
  })
  it('cantonal school keeps names and NULL', () => {
    expect(normalizeCantonalSchool('Nein')).toBe('none')
    expect(normalizeCantonalSchool('Andere Kantonsschule')).toBe('other')
    expect(normalizeCantonalSchool('KS Wiedikon')).toBe('KS Wiedikon')
    expect(normalizeCantonalSchool('  ')).toBeNull()
    expect(cantonalSchoolToLegacy('none')).toBe('Nein')
    expect(cantonalSchoolToLegacy('other')).toBe('Andere Kantonsschule')
  })
  it('licence category: only the officials word changes', () => {
    expect(normalizeLicenceCategory('Offizielle/r')).toBe('official')
    expect(normalizeLicenceCategory('Ufficiale')).toBe('official')
    expect(normalizeLicenceCategory('U 14')).toBe('U 14')
    expect(licenceCategoryToClubdesk('official')).toBe('Offizielle/r')
  })
})

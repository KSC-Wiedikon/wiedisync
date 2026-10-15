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

describe('fee category vocabulary (migration 417)', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { FEE_CATEGORY_LABELS, normalizeFeeCategory, feeCategoryLabel, feeCategorySport } = await import('../member-values.js')
  const { CD_BEITRAG_MAP } = await import('../clubdesk-update.js')
  const scripts = path.resolve(import.meta.dirname, '../../../../scripts')
  const seed = ['412-clubdesk-maps.sql', '417-fee-category-english.sql']
    .map((f) => fs.readFileSync(path.join(scripts, f), 'utf8')).join('\n')
  const rows = [...seed.matchAll(/\('fee_category',\s*'([^']+)',\s*'([^']+)',\s*(true|false)\)/g)]
    .map(([, slug, cd, canonical]) => ({ slug, cd, canonical: canonical === 'true' }))

  it('matches clubdesk_value_map, row by row', () => {
    expect(rows.length).toBeGreaterThan(25)
    for (const r of rows) {
      expect(normalizeFeeCategory(r.cd), r.cd).toBe(r.slug)
      if (r.canonical) expect(FEE_CATEGORY_LABELS[r.slug], r.slug).toBe(r.cd)
    }
    for (const slug of Object.keys(FEE_CATEGORY_LABELS)) {
      expect(rows.some((r) => r.slug === slug && r.canonical), slug).toBe(true)
    }
  })
  it('every priced category is a known slug', () => {
    for (const slug of Object.keys(CD_BEITRAG_MAP)) expect(FEE_CATEGORY_LABELS[slug], slug).toBeTruthy()
  })
  it('labels and sports', () => {
    expect(feeCategoryLabel('bb_youth_league')).toBe('BB Jugend Meisterschaft')
    expect(feeCategoryLabel('BB Junior:innen')).toBe('BB Jugend Meisterschaft')
    expect(feeCategorySport('vb_employed')).toBe('volleyball')
    expect(feeCategorySport('Passivmitglied')).toBeNull()
  })
})

// Migration 422: the board's role token 'vorstand' → 'board'.
import { normalizeAppRoles } from '../member-values.js'
describe('normalizeAppRoles', () => {
  it('renames the legacy token, keeps order and drops duplicates', () => {
    expect(normalizeAppRoles(['user', 'vorstand', 'admin'])).toEqual(['user', 'board', 'admin'])
    expect(normalizeAppRoles(['vorstand', 'board'])).toEqual(['board'])
  })
  it('handles announcement audience tokens and JSON text', () => {
    expect(normalizeAppRoles(['role:vorstand', 'fn:coach'])).toEqual(['role:board', 'fn:coach'])
    expect(normalizeAppRoles('["user","vorstand"]')).toBe('["user","board"]')
  })
  it('leaves everything else alone', () => {
    expect(normalizeAppRoles(['user', 'finance'])).toEqual(['user', 'finance'])
    expect(normalizeAppRoles(null)).toBe(null)
    expect(normalizeAppRoles('not json')).toBe('not json')
    expect(normalizeAppRoles(['constructor'])).toEqual(['constructor'])
  })
})

/**
 * Unit tests for the reader-facing rendering of the coded member fields
 * (federations.js), split out on 2026-07-26 after the admin ClubDesk email
 * printed "federation_of_origin: Schweiz" at an English-speaking admin.
 *
 * The invariant under test is the two-shapes rule:
 *   • DISPLAY (here) — the reader's language, and for the federation the NAME OF
 *     THE BODY ("🇨🇭 Swiss Volley"), because that is what the member was asked.
 *   • PUSH (federationCell / name_de_clubdesk, clubdesk-update.js) — German,
 *     ClubDesk's exact picklist spelling, whatever language the reader speaks.
 * Nothing here may ever be fed to ClubDesk.
 *
 * Hermetic — pure functions, no DB or network (the country map is injected).
 */
import { describe, it, expect } from 'vitest'
import {
  countryCodesDisplay, countryDisplay, countryFlag, federationDisplay,
  federationName, federationNames, sexDisplay, sexPushLabel,
} from '../federations.js'

/** Stand-in for loadCountryDisplayNames() — code → { de, en } from country_codes. */
const NAMES = new Map([
  ['CH', { de: 'Schweiz', en: 'Switzerland' }],
  ['DE', { de: 'Deutschland', en: 'Germany' }],
  ['IT', { de: 'Italien', en: 'Italy' }],
  ['LV', { de: 'Lettland', en: 'Latvia' }],
])

describe('federationName', () => {
  it('names the body per sport — the whole reason the field is not "country"', () => {
    expect(federationName('IT', 'volleyball')).toBe('FIPAV')
    expect(federationName('IT', 'basketball')).toBe('FIP')
    expect(federationName('CH', 'volleyball')).toBe('Swiss Volley')
    expect(federationName('CH', 'basketball')).toBe('Swiss Basketball')
  })

  it('has no single-sport answer without a sport, or for an unmapped country', () => {
    expect(federationName('IT', undefined)).toBe('')
    expect(federationName('LV', 'volleyball')).toBe('')
  })

  it('names BOTH bodies when the sport is ambiguous — better than naming neither', () => {
    // `primarySport` collapses "two sports" AND "no team yet" into 'both'.
    expect(federationNames('IT', undefined)).toBe('FIPAV / FIP')
    expect(federationNames('CH', undefined)).toBe('Swiss Volley / Swiss Basketball')
    expect(federationNames('IT', 'volleyball')).toBe('FIPAV')
    expect(federationNames('LV', undefined)).toBe('')
  })
})

describe('federationDisplay', () => {
  it('renders flag + federation, identically in every language', () => {
    expect(federationDisplay('CH', 'volleyball', 'en', NAMES)).toBe('🇨🇭 Swiss Volley')
    expect(federationDisplay('CH', 'volleyball', 'de', NAMES)).toBe('🇨🇭 Swiss Volley')
    expect(federationDisplay('DE', 'volleyball', 'en', NAMES)).toBe('🇩🇪 DVV')
  })

  it('falls back to the LOCALIZED country name where no federation is mapped', () => {
    expect(federationDisplay('LV', 'volleyball', 'en', NAMES)).toBe('🇱🇻 Latvia')
    expect(federationDisplay('LV', 'volleyball', 'de', NAMES)).toBe('🇱🇻 Lettland')
    expect(federationDisplay('LV', undefined, 'en', NAMES)).toBe('🇱🇻 Latvia')
  })

  it('names both bodies for an ambiguous sport instead of dropping to the country', () => {
    expect(federationDisplay('CH', undefined, 'en', NAMES)).toBe('🇨🇭 Swiss Volley / Swiss Basketball')
  })

  it('renders the NONE sentinel as a word, and unanswered as empty', () => {
    expect(federationDisplay('NONE', 'volleyball', 'en', NAMES)).toBe('None')
    expect(federationDisplay('NONE', 'volleyball', 'de', NAMES)).toBe('Keiner')
    expect(federationDisplay('', 'volleyball', 'en', NAMES)).toBe('')
    expect(federationDisplay(null, 'volleyball', 'en', NAMES)).toBe('')
  })

  it('passes a non-code value through instead of blanking it', () => {
    // A cached older frontend still sends a rendered label — show it verbatim
    // rather than dropping the change row.
    expect(federationDisplay('🇩🇪 DVV', 'volleyball', 'en', NAMES)).toBe('🇩🇪 DVV')
  })
})

describe('countryDisplay / countryCodesDisplay', () => {
  it('uses the club spellings for de/en and CLDR for the rest', () => {
    expect(countryDisplay('CH', 'de', NAMES)).toBe('Schweiz')
    expect(countryDisplay('CH', 'en', NAMES)).toBe('Switzerland')
    expect(countryDisplay('CH', 'gsw', NAMES)).toBe('Schweiz')
    expect(countryDisplay('CH', 'fr', NAMES)).toBe('Suisse')
    expect(countryDisplay('CH', 'it', NAMES)).toBe('Svizzera')
  })

  it('falls back to the bare code rather than inventing a name', () => {
    expect(countryDisplay('CH', 'en', null)).toBe('CH')
    expect(countryDisplay('zz', 'en', NAMES)).toBe('ZZ')
    expect(countryDisplay('', 'en', NAMES)).toBe('')
  })

  it('renders the FULL code list — the member edited a list, not just the primary', () => {
    expect(countryCodesDisplay('DE,CH', 'en', NAMES)).toBe('Germany, Switzerland')
    expect(countryCodesDisplay('DE,CH', 'de', NAMES)).toBe('Deutschland, Schweiz')
    expect(countryCodesDisplay('de , ch', 'en', NAMES)).toBe('Germany, Switzerland')
    expect(countryCodesDisplay('CH,CH', 'en', NAMES)).toBe('Switzerland')
  })

  it('passes legacy free text through and treats empty as empty', () => {
    expect(countryCodesDisplay('Deutschland, Schweiz', 'en', NAMES)).toBe('Deutschland, Schweiz')
    expect(countryCodesDisplay('', 'en', NAMES)).toBe('')
    expect(countryCodesDisplay(null, 'en', NAMES)).toBe('')
  })
})

describe('countryFlag', () => {
  it('builds the regional-indicator pair, and nothing for a non-code', () => {
    expect(countryFlag('ch')).toBe('🇨🇭')
    expect(countryFlag('NONE')).toBe('')
    expect(countryFlag('')).toBe('')
  })
})

describe('sex labels', () => {
  it('keeps ClubDesk on the German lowercase pair while the reader gets their own language', () => {
    expect(sexPushLabel('m')).toBe('männlich')
    expect(sexPushLabel('f')).toBe('weiblich')
    expect(sexPushLabel('')).toBe('')
    expect(sexDisplay('m', 'en')).toBe('Male')
    expect(sexDisplay('f', 'fr')).toBe('Féminin')
    expect(sexDisplay('m', 'de')).toBe('Männlich')
    expect(sexDisplay('x', 'en')).toBe('')
  })
})

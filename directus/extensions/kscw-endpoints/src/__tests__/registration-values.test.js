// Registration vocabulary (migration 413): the public form posts English keys
// (German form values are still normalised), the DB stores English slugs,
// ClubDesk wants the German back.
import { describe, it, expect } from 'vitest'
import {
  normalizeSex, sexToClubdesk, salutationFromSex,
  normalizeRole, roleToClubdesk, normalizeOfficials, officialsToClubdesk,
  normalizeBbSituation, normalizeRecentLicence,
} from '../registration-values.js'

describe('values', () => {
  it('sex', () => {
    expect(normalizeSex('männlich')).toBe('m')
    expect(normalizeSex('f')).toBe('f')
    expect(normalizeSex('divers')).toBeNull()
    expect(sexToClubdesk('m')).toBe('männlich')
    expect(salutationFromSex('f')).toBe('Frau')
  })

  it('role', () => {
    expect(normalizeRole('Spieler*in')).toBe('player')
    expect(normalizeRole('Teamverantwortliche*r')).toBe('team_responsible')
    expect(normalizeRole('VB Schiedsrichter')).toBeNull() // a passive licence list is not a role
    expect(roleToClubdesk('guest')).toBe('Guest')
    expect(roleToClubdesk('coach')).toBe('Trainer*in')
  })

  it('officials round-trip per membership', () => {
    expect(normalizeOfficials('OTR 1, Schiedsrichter', 'basketball')).toBe('otr1,bb_referee')
    expect(normalizeOfficials('Schreiber, Schiedsrichter', 'volleyball')).toBe('vb_scorer,vb_referee')
    expect(normalizeOfficials('VB Schreiber, BB OTN', 'passive')).toBe('vb_scorer,otn')
    expect(normalizeOfficials('', 'volleyball')).toBeNull()
    expect(officialsToClubdesk('otr1,bb_referee', 'basketball')).toBe('OTR 1, Schiedsrichter')
    expect(officialsToClubdesk('vb_scorer', 'volleyball')).toBe('Schreiber')
    expect(officialsToClubdesk('vb_scorer,otn', 'passive')).toBe('VB Schreiber, OTN')
  })

  it('basketball situation + recent licence', () => {
    expect(normalizeBbSituation('neu')).toBe('new')
    expect(normalizeBbSituation('rueckkehr')).toBe('returning')
    expect(normalizeBbSituation('transfer_ch')).toBe('transfer_ch')
    expect(normalizeBbSituation('x')).toBeNull()
    expect(normalizeRecentLicence('ja')).toBe(true)
    expect(normalizeRecentLicence('nein')).toBe(false)
    expect(normalizeRecentLicence(false)).toBe(false)
    expect(normalizeRecentLicence('')).toBeNull()
  })
})

// Registration vocabulary (migration 413): the public form still posts German
// keys and values, the DB stores English slugs, ClubDesk wants the German back.
import { describe, it, expect } from 'vitest'
import {
  englishRegistrationBody, normalizeSex, sexToClubdesk, salutationFromSex,
  normalizeRole, roleToClubdesk, normalizeOfficials, officialsToClubdesk,
  normalizeBbSituation, normalizeRecentLicence,
} from '../registration-values.js'

describe('englishRegistrationBody', () => {
  it('maps the website form keys onto the English columns', () => {
    const out = englishRegistrationBody({
      vorname: 'Mia', nachname: 'Muster', telefon_mobil: '079', adresse: 'Weg 1', plz: '8003', ort: 'Zürich',
      geburtsdatum: '2010-01-01', geschlecht: 'weiblich', lizenz: 'OTR 1', bb_doc_freibrief: 'uuid',
      nationalitaet: 'Italien', nationalitaet_code: 'IT', nationalitaet_codes: 'IT,CH', email: 'm@x.ch',
    })
    expect(out).toMatchObject({
      first_name: 'Mia', last_name: 'Muster', phone: '079', address: 'Weg 1', postal_code: '8003', city: 'Zürich',
      birthdate: '2010-01-01', sex: 'weiblich', officials_requested: 'OTR 1', bb_doc_release_letter: 'uuid',
      nationality_codes: 'IT,CH', email: 'm@x.ch',
    })
    expect(out).not.toHaveProperty('nationalitaet')
    expect(out).not.toHaveProperty('vorname')
  })

  it('falls back to the single code, and lets an English key win', () => {
    expect(englishRegistrationBody({ nationalitaet_code: 'DE' }).nationality_codes).toBe('DE')
    expect(englishRegistrationBody({ vorname: 'Old', first_name: 'New' }).first_name).toBe('New')
    expect(englishRegistrationBody(null)).toEqual({})
  })
})

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

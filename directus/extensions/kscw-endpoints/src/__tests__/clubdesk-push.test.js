/**
 * Unit tests for the sync-up push CSV builder (clubdesk-update.js) — the two-set
 * split introduced with migration 173: UPDATE rows carry contact fields only,
 * CREATE rows additionally carry Beitragskategorie + Eintritt + Gruppen. The
 * invariants here guard the legal-register safety rule: an UPDATE CSV must
 * NEVER contain a category/groups column (ClubDesk-authoritative on existing
 * contacts; empty-cell import semantics unvalidated).
 *
 * Hermetic — pure functions, no DB or network.
 */
import { describe, it, expect } from 'vitest'
import { buildPushCsv, CD_PUSH_CREATE_HEADERS, CD_KATEGORIE_MAP, mapKategorie, deriveGruppen, deriveStatus, deriveMitgliederbeitrag, deriveOffiziellenLizenz, deriveSektion, derivePassivmitglied, deriveSchiedsrichter } from '../clubdesk-update.js'

const kacper = {
  first_name: 'Kacper', last_name: 'Krawczyński', email: 'k@example.com',
  phone: '+41 79 000 00 00', adresse: 'Weg 1', plz: '8003', ort: 'Zürich',
  birthdate: '1999-03-15', sex: 'm',
  beitragskategorie: 'VB Erwerbstätige', eintritt: '2026-06-27T18:22:00.000Z',
  gruppen: 'VB H1 (Spieler*in)', cd_status: 'Aktivmitglied',
}

describe('buildPushCsv (update set)', () => {
  it('emits exactly the 13 contact columns — no category, no Eintritt', () => {
    const csv = buildPushCsv([kacper])
    const [header, row] = csv.trim().split('\n')
    expect(header).toBe('Vorname;Nachname;E-Mail;Telefon Privat;Adresse;PLZ;Ort;Geburtsdatum;Geschlecht;IBAN;Anrede;Nationalität;AHV Nummer')
    expect(header).not.toContain('Beitragskategorie')
    expect(row.split(';')).toHaveLength(13)
    expect(row).not.toContain('VB Erwerbstätige')
  })

  it('carries the echo-protected contact fields (anrede/nationalitaet/ahv) after IBAN', () => {
    const row = buildPushCsv([{ ...kacper, iban: 'CH93', anrede: 'Herr', nationalitaet: 'Schweiz', ahv_nummer: '756.1.2.3' }])
      .trim().split('\n')[1].split(';')
    expect(row[9]).toBe('CH93')      // IBAN
    expect(row[10]).toBe('Herr')     // Anrede
    expect(row[11]).toBe('Schweiz')  // Nationalität
    expect(row[12]).toBe('756.1.2.3') // AHV Nummer
    const empty = buildPushCsv([kacper]).trim().split('\n')[1].split(';')
    expect([empty[10], empty[11], empty[12]]).toEqual(['', '', '']) // /up echo-fills these
  })

  it('formats birthdate dd.mm.yyyy and maps sex to ClubDesk wording', () => {
    const row = buildPushCsv([kacper]).trim().split('\n')[1]
    expect(row).toContain('15.03.1999')
    expect(row.split(';')[8]).toBe('männlich')
  })

  it('carries the member IBAN (or the /up-resolved ClubDesk echo) at index 9', () => {
    const withIban = buildPushCsv([{ ...kacper, iban: 'CH9300762011623852957' }]).trim().split('\n')[1]
    expect(withIban.split(';')[9]).toBe('CH9300762011623852957')
    const withoutIban = buildPushCsv([kacper]).trim().split('\n')[1]
    expect(withoutIban.split(';')[9]).toBe('')
  })
})

describe('buildPushCsv (create set)', () => {
  it('appends the create-set columns (Telefon Mobil … Schiedsrichter) in order', () => {
    const csv = buildPushCsv([{ ...kacper, scorer_vb: true, referee_vb: true, iban: 'CH9300762011623852957', cd_passiv: 'Nein', cd_sektion: 'Volleyball' }], { create: true })
    const [header, row] = csv.trim().split('\n')
    expect(header).toBe(CD_PUSH_CREATE_HEADERS.join(';'))
    expect(header.endsWith('Mitgliederbeitrag;Passivmitglied;Sektion;Schiedsrichter')).toBe(true)
    const cells = row.split(';')
    expect(cells).toHaveLength(23)
    expect(cells[9]).toBe('CH9300762011623852957') // IBAN
    // [10..12] = Anrede/Nationalität/AHV Nummer (empty on this fixture); create extras start at [13]
    expect(cells[13]).toBe('+41 79 000 00 00')      // Telefon Mobil = Privat
    expect(cells[14]).toBe('VB Erwerbstätige')       // Beitragskategorie
    expect(cells[15]).toBe('27.06.2026')             // Eintritt
    expect(cells[16]).toBe('VB H1 (Spieler*in)')     // Gruppen
    expect(cells[17]).toBe('Aktivmitglied')          // Status
    expect(cells[18]).toBe('VB SC')                  // Offiziellen Lizenz (scorer, not VB SR)
    expect(cells[19]).toBe('440')                    // Mitgliederbeitrag
    expect(cells[20]).toBe('Nein')                   // Passivmitglied
    expect(cells[21]).toBe('Volleyball')             // Sektion
    expect(cells[22]).toBe('Ja')                     // Schiedsrichter (referee)
  })

  it('Telefon Mobil mirrors Telefon Privat (one number → both)', () => {
    const cells = buildPushCsv([kacper], { create: true }).trim().split('\n')[1].split(';')
    expect(cells[3]).toBe(cells[13]) // Privat === Mobil
  })

  it('empty create-set optional cells stay empty (safe on a new contact)', () => {
    const row = buildPushCsv([{ ...kacper, phone: '', beitragskategorie: null, eintritt: null, gruppen: '', cd_status: '' }], { create: true })
      .trim().split('\n')[1]
    const cells = row.split(';')
    // IBAN, Anrede, Nationalität, AHV, Telefon Mobil, Beitragskategorie, Eintritt, Gruppen, Status
    for (const i of [9, 10, 11, 12, 13, 14, 15, 16, 17]) expect(cells[i]).toBe('')
  })

  it('neutralises formula injection in the category cell', () => {
    const row = buildPushCsv([{ ...kacper, beitragskategorie: '=SUM(A1)' }], { create: true })
      .trim().split('\n')[1]
    expect(row.split(';')[14]).toBe("'=SUM(A1)")
  })

  it('leaves phone-style leading + unguarded but escapes +formula (2026-07-06 apostrophe bug)', () => {
    const cells = buildPushCsv([{ ...kacper, phone: '+41 79 000 00 00', adresse: '+HYPERLINK(1)' }])
      .trim().split('\n')[1].split(';')
    expect(cells[3]).toBe('+41 79 000 00 00')
    expect(cells[4]).toBe("'+HYPERLINK(1)")
  })

  it('multi-team Gruppen stays one cell (comma is safe in semicolon CSV)', () => {
    const row = buildPushCsv([{ ...kacper, gruppen: 'VB H1 (Spieler*in), VB H2 (Spieler*in)' }], { create: true })
      .trim().split('\n')[1]
    const cells = row.split(';')
    expect(cells).toHaveLength(23)
    expect(cells[16]).toBe('VB H1 (Spieler*in), VB H2 (Spieler*in)')
  })
})

describe('deriveOffiziellenLizenz', () => {
  it('VB scorer OR referee → VB SC (VB referee is auto a scorer), BB by level, none → empty', () => {
    expect(deriveOffiziellenLizenz({ referee_vb: true, scorer_vb: true })).toBe('VB SC')
    expect(deriveOffiziellenLizenz({ referee_vb: true })).toBe('VB SC') // VB referee ⇒ auto scorer
    expect(deriveOffiziellenLizenz({ referee_bb: true })).toBe('') // BB referee is NOT auto a scorer
    expect(deriveOffiziellenLizenz({ scorer_vb: true })).toBe('VB SC')
    expect(deriveOffiziellenLizenz({ otr1_bb: true })).toBe('OTR1')
    expect(deriveOffiziellenLizenz({ otr2_bb: true })).toBe('OTR2')
    expect(deriveOffiziellenLizenz({ otn_bb: true })).toBe('OTN')
    expect(deriveOffiziellenLizenz({})).toBe('')
    expect(deriveOffiziellenLizenz(null)).toBe('')
  })
})

describe('deriveSchiedsrichter', () => {
  it('Ja for a VB or BB referee, Nein otherwise', () => {
    expect(deriveSchiedsrichter({ referee_vb: true })).toBe('Ja')
    expect(deriveSchiedsrichter({ referee_bb: true })).toBe('Ja')
    expect(deriveSchiedsrichter({ scorer_vb: true })).toBe('Nein')
    expect(deriveSchiedsrichter({})).toBe('Nein')
    expect(deriveSchiedsrichter(null)).toBe('Nein')
  })
})

describe('deriveGruppen officials', () => {
  it('VB scorer → VB Schreiber*innen group; referees are NOT grouped', () => {
    expect(deriveGruppen({ membership_type: 'volleyball', lizenz: 'Schreiber' })).toBe('VB Schreiber*innen')
    expect(deriveGruppen({ membership_type: 'volleyball', team: 'H1', rolle: 'Spieler*in', lizenz: 'Schreiber' }))
      .toBe('VB H1 (Spieler*in), VB Schreiber*innen')
    expect(deriveGruppen({ membership_type: 'volleyball', lizenz: 'Schiedsrichter' })).toBe('')
    expect(deriveGruppen({ membership_type: 'basketball', lizenz: 'Schiedsrichter' })).toBe('')
  })
})

describe('deriveSektion / derivePassivmitglied', () => {
  it('sektion from sport, passive uses approver choice (default KSCW)', () => {
    expect(deriveSektion({ membership_type: 'volleyball' })).toBe('Volleyball')
    expect(deriveSektion({ membership_type: 'basketball' })).toBe('Basketball')
    expect(deriveSektion({ membership_type: 'passive', sektion_choice: 'Volleyball' })).toBe('Volleyball')
    expect(deriveSektion({ membership_type: 'passive' })).toBe('KSCW')
    expect(deriveSektion(null)).toBe('')
  })
  it('passivmitglied Ja only for passive registrations', () => {
    expect(derivePassivmitglied({ membership_type: 'passive' })).toBe('Ja')
    expect(derivePassivmitglied({ membership_type: 'volleyball' })).toBe('Nein')
    expect(derivePassivmitglied(null)).toBe('Nein')
  })
})

describe('deriveMitgliederbeitrag', () => {
  it('maps the confirmed fees for both name families', () => {
    expect(deriveMitgliederbeitrag('VB Erwerbstätige')).toBe('440')
    expect(deriveMitgliederbeitrag('VB Student*in Meisterschaft')).toBe('380')
    expect(deriveMitgliederbeitrag('VB Studenten/Lehrlinge')).toBe('380')
    expect(deriveMitgliederbeitrag('BB Erwerbstätige')).toBe('510')
    expect(deriveMitgliederbeitrag('BB Erwerbstätig 1. Liga')).toBe('560')
    expect(deriveMitgliederbeitrag('BB Jugend Meisterschaft')).toBe('310')
    expect(deriveMitgliederbeitrag('BB Minis Turnier')).toBe('210')
    expect(deriveMitgliederbeitrag('Gratis')).toBe('0')
    expect(deriveMitgliederbeitrag('Passivmitglied')).toBe('40')
  })

  it('unknown or empty category yields an empty cell, never a guess', () => {
    expect(deriveMitgliederbeitrag('Sponsor')).toBe('')
    expect(deriveMitgliederbeitrag('')).toBe('')
    expect(deriveMitgliederbeitrag(null)).toBe('')
  })

  it('surcharges adult categories (inherently U16+) on a missing licence, regardless of birthdate', () => {
    const adultNoLic = { scorer_vb: false, otr1_bb: false, otr2_bb: false, otn_bb: false }
    expect(deriveMitgliederbeitrag('VB Erwerbstätige', adultNoLic)).toBe('540')
    expect(deriveMitgliederbeitrag('VB Erwerbstätige', { scorer_vb: true })).toBe('440')
    expect(deriveMitgliederbeitrag('VB Student*in Meisterschaft', adultNoLic)).toBe('480')
    expect(deriveMitgliederbeitrag('BB Erwerbstätige', adultNoLic)).toBe('610')
    expect(deriveMitgliederbeitrag('BB Erwerbstätige', { otr1_bb: true })).toBe('510')
    expect(deriveMitgliederbeitrag('BB Erwerbstätige 1. Liga', adultNoLic)).toBe('660')
    expect(deriveMitgliederbeitrag('BB Lernende/Studierende', adultNoLic)).toBe('510')
  })

  it('surcharges youth categories ONLY when the member is U16+ (born <= year-15)', () => {
    const youngVb = { scorer_vb: false, birthdate: '2013-05-01' } // ~13 → below U16
    const olderVb = { scorer_vb: false, birthdate: '2009-05-01' } // ~17 → U16+
    expect(deriveMitgliederbeitrag('VB Schüler*in Meisterschaft', youngVb)).toBe('310')
    expect(deriveMitgliederbeitrag('VB Schüler*in Meisterschaft', olderVb)).toBe('410')
    const youngBb = { otr1_bb: false, otr2_bb: false, otn_bb: false, birthdate: '2014-05-01' }
    const olderBb = { otr1_bb: false, otr2_bb: false, otn_bb: false, birthdate: '2008-05-01' }
    expect(deriveMitgliederbeitrag('BB Jugend Meisterschaft', youngBb)).toBe('310')
    expect(deriveMitgliederbeitrag('BB Jugend Meisterschaft', olderBb)).toBe('410')
    expect(deriveMitgliederbeitrag('BB Minis Turnier', youngBb)).toBe('210')
  })

  it('unknown birthdate on a youth category → base (never over-charge without the age)', () => {
    expect(deriveMitgliederbeitrag('BB Jugend Meisterschaft', { otr1_bb: false })).toBe('310')
    expect(deriveMitgliederbeitrag('VB Schüler*in Meisterschaft', { scorer_vb: false })).toBe('310')
  })

  it('does NOT surcharge VB intro tiers, passive or gratis (even for adults)', () => {
    const bare = { scorer_vb: false, otr1_bb: false, birthdate: '1990-01-01' }
    expect(deriveMitgliederbeitrag('VB Turnier KWI', bare)).toBe('110')
    expect(deriveMitgliederbeitrag('VB Schüler*in 1. Jahr', bare)).toBe('110')
    expect(deriveMitgliederbeitrag('Passivmitglied', bare)).toBe('40')
    expect(deriveMitgliederbeitrag('Gratis', bare)).toBe('0')
  })

  it('no member arg → base amount (safe default)', () => {
    expect(deriveMitgliederbeitrag('VB Erwerbstätige')).toBe('440')
    expect(deriveMitgliederbeitrag('BB Erwerbstätige')).toBe('510')
  })
})

describe('deriveStatus', () => {
  it('registration → Aktivmitglied, passive registration → Passivmitglied', () => {
    expect(deriveStatus({ membership_type: 'volleyball' }, { wiedisync_active: false })).toBe('Aktivmitglied')
    expect(deriveStatus({ membership_type: 'basketball' }, null)).toBe('Aktivmitglied')
    expect(deriveStatus({ membership_type: 'passive' }, { wiedisync_active: true })).toBe('Passivmitglied')
  })

  it('no registration → Aktivmitglied only when wiedisync_active, else empty', () => {
    expect(deriveStatus(null, { wiedisync_active: true })).toBe('Aktivmitglied')
    expect(deriveStatus(null, { wiedisync_active: false })).toBe('')
    expect(deriveStatus(null, null)).toBe('')
    expect(deriveStatus(undefined, { wiedisync_active: 1 })).toBe('')
  })
})

describe('deriveGruppen', () => {
  it('derives sport-prefixed player groups from an approved registration', () => {
    expect(deriveGruppen({ membership_type: 'volleyball', team: 'H1', rolle: 'Spieler*in' }))
      .toBe('VB H1 (Spieler*in)')
    expect(deriveGruppen({ membership_type: 'basketball', team: 'HU14', rolle: 'Trainer*in' }))
      .toBe('BB HU14 (Trainer*in)')
  })

  it('joins multiple teams into one comma-separated cell', () => {
    expect(deriveGruppen({ membership_type: 'volleyball', team: 'H1, H2', rolle: 'Spieler*in' }))
      .toBe('VB H1 (Spieler*in), VB H2 (Spieler*in)')
  })

  it('returns empty for passive, unknown funktion or missing team', () => {
    expect(deriveGruppen({ membership_type: 'passive', team: '', rolle: 'VB Schiedsrichter' })).toBe('')
    expect(deriveGruppen({ membership_type: 'volleyball', team: 'H1', rolle: 'Andere' })).toBe('')
    expect(deriveGruppen({ membership_type: 'volleyball', team: '', rolle: 'Spieler*in' })).toBe('')
    expect(deriveGruppen(null)).toBe('')
  })
})

describe('mapKategorie', () => {
  it('passes unmapped values through verbatim (trimmed)', () => {
    expect(mapKategorie('  VB Erwerbstätige ')).toBe('VB Erwerbstätige')
    expect(mapKategorie(null)).toBe('')
    expect(mapKategorie(undefined)).toBe('')
  })

  it('applies the ClubDesk mapping when an entry exists', () => {
    CD_KATEGORIE_MAP['__test__'] = 'Mapped'
    try {
      expect(mapKategorie('__test__')).toBe('Mapped')
    } finally {
      delete CD_KATEGORIE_MAP.__test__
    }
  })

  it('translates the legacy BB youth form values (2026-07-06 rename)', () => {
    expect(mapKategorie('BB Junior:innen')).toBe('BB Jugend Meisterschaft')
    expect(mapKategorie('BB Minis')).toBe('BB Minis Turnier')
    // the new form values pass through untouched
    expect(mapKategorie('BB Jugend Meisterschaft')).toBe('BB Jugend Meisterschaft')
    expect(mapKategorie('BB Minis Turnier')).toBe('BB Minis Turnier')
  })
})

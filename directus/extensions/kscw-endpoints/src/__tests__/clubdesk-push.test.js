/**
 * Unit tests for the sync-up push CSV builder (clubdesk-update.js) — the two-set
 * split introduced with migration 173: UPDATE rows carry contact fields only,
 * CREATE rows additionally carry Beitragskategorie + Eintritt + Gruppen.
 *
 * Primary invariants (legal-register safety):
 *   • UPDATE rows are [Id]-KEYED and NAME-LESS (2026-07-08, spike-proven:
 *     ClubDesk's import consumes a `[Id]` column as the record identity and
 *     touches only the columns present). Vorname/Nachname must NEVER appear in
 *     the update set — they would overwrite the register's legal names.
 *   • An UPDATE CSV must NEVER contain a category/groups column
 *     (ClubDesk-authoritative on existing contacts). The same spike proved an
 *     empty mapped cell is a no-op on import — the echo-back/blank-risk guards
 *     stay as defense-in-depth regardless.
 *   • CREATE rows carry the real wiedisync name and never an [Id] (an unknown
 *     [Id] hard-aborts ClubDesk's whole import).
 *
 * Hermetic — pure functions, no DB or network.
 */
import { describe, it, expect } from 'vitest'
import { buildPushCsv, CD_PUSH_CREATE_HEADERS, CD_KATEGORIE_MAP, mapKategorie, deriveGruppen, deriveStatus, deriveMitgliederbeitrag, deriveOffiziellenLizenz, deriveSektion, derivePassivmitglied, deriveSchiedsrichter } from '../clubdesk-update.js'

const kacper = {
  first_name: 'Kacper', last_name: 'Krawczyński', email: 'k@example.com',
  phone: '+41 79 000 00 00', adresse: 'Weg 1', plz: '8003', ort: 'Zürich',
  birthdate: '1999-03-15', sex: 'm', clubdesk_id: '1001283',
  beitragskategorie: 'VB Erwerbstätige', eintritt: '2026-06-27T18:22:00.000Z',
  gruppen: 'VB H1 (Spieler*in)', cd_status: 'Aktivmitglied',
}

describe('buildPushCsv (update set)', () => {
  it('is [Id]-keyed and name-less — exactly the 13 contact columns, no category', () => {
    const csv = buildPushCsv([kacper])
    const [header, row] = csv.trim().split('\n')
    expect(header).toBe('[Id];E-Mail;Telefon Privat;Adresse;PLZ;Ort;Geburtsdatum;Geschlecht;IBAN;Anrede;Nationalität;AHV Nummer;Wiedisync ID')
    // Names must NEVER ride on an update row: [Id] is the upsert key (spike-proven
    // 2026-07-08) and a name column would overwrite the register's legal name.
    expect(header).not.toContain('Vorname')
    expect(header).not.toContain('Nachname')
    expect(header).not.toContain('Beitragskategorie')
    const cells = row.split(';')
    expect(cells).toHaveLength(13)
    expect(cells[0]).toBe('1001283')  // ClubDesk's own [Id] = members.clubdesk_id
    expect(row).not.toContain('Kacper')
    expect(row).not.toContain('Krawczyński')
    expect(row).not.toContain('VB Erwerbstätige')
  })

  it('emits an empty [Id] cell when clubdesk_id is missing (guarded upstream by /up)', () => {
    const cells = buildPushCsv([{ ...kacper, clubdesk_id: null }]).trim().split('\n')[1].split(';')
    expect(cells[0]).toBe('')
  })

  it('carries the echo-protected fields + the Wiedisync ID (uuid, id fallback) after IBAN', () => {
    const row = buildPushCsv([{ ...kacper, id: 531, iban: 'CH93', anrede: 'Herr', nationalitaet: 'Schweiz', ahv_nummer: '756.1.2.3' }])
      .trim().split('\n')[1].split(';')
    expect(row[8]).toBe('CH93')      // IBAN — invalid (mod-97 fail) passes through raw, never blanked
    expect(row[9]).toBe('Herr')      // Anrede
    expect(row[10]).toBe('Schweiz')  // Nationalität
    expect(row[11]).toBe('756.1.2.3') // AHV Nummer — unrewritable passes through raw
    expect(row[12]).toBe('531')      // Wiedisync ID: numeric id fallback (pre-184 rows)
    // members.uuid (migration 184) wins over the numeric id
    const uuid = 'a3e1f0b2-4c5d-4e6f-8a9b-0c1d2e3f4a5b'
    const withUuid = buildPushCsv([{ ...kacper, id: 531, uuid }]).trim().split('\n')[1].split(';')
    expect(withUuid[12]).toBe(uuid)
    const empty = buildPushCsv([kacper]).trim().split('\n')[1].split(';')
    expect([empty[9], empty[10], empty[11]]).toEqual(['', '', '']) // /up echo-fills these
    expect(empty[12]).toBe('') // no uuid/id on the fixture → empty
  })

  it('repairs outgoing contact cells to the canonical formats (normalize.js)', () => {
    const row = buildPushCsv([{
      ...kacper,
      email: ' K@Example.COM ',
      phone: '0791234567',
      iban: 'ch93 0076 2011 6238 5295 7',
      ahv_nummer: '7561234567897',
    }]).trim().split('\n')[1].split(';')
    expect(row[1]).toBe('k@example.com')
    expect(row[2]).toBe('+41 79 123 45 67')
    expect(row[8]).toBe('CH9300762011623852957')
    expect(row[11]).toBe('756.1234.5678.97')
    // unrewritable values pass through raw — the push never blanks what it can't parse
    const raw = buildPushCsv([{ ...kacper, phone: '01 451 60 38' }]).trim().split('\n')[1].split(';')
    expect(raw[2]).toBe('01 451 60 38')
  })

  it('formats birthdate dd.mm.yyyy and maps sex to ClubDesk wording', () => {
    const row = buildPushCsv([kacper]).trim().split('\n')[1]
    expect(row).toContain('15.03.1999')
    expect(row.split(';')[7]).toBe('männlich')
  })

  it('carries the member IBAN (or the /up-resolved ClubDesk echo) at index 8', () => {
    const withIban = buildPushCsv([{ ...kacper, iban: 'CH9300762011623852957' }]).trim().split('\n')[1]
    expect(withIban.split(';')[8]).toBe('CH9300762011623852957')
    const withoutIban = buildPushCsv([kacper]).trim().split('\n')[1]
    expect(withoutIban.split(';')[8]).toBe('')
  })

  it('leaves phone-style leading + unguarded but escapes +formula (2026-07-06 apostrophe bug)', () => {
    const cells = buildPushCsv([{ ...kacper, phone: '+41 79 000 00 00', adresse: '+HYPERLINK(1)' }])
      .trim().split('\n')[1].split(';')
    expect(cells[2]).toBe('+41 79 000 00 00') // Telefon Privat
    expect(cells[3]).toBe("'+HYPERLINK(1)")   // Adresse
  })
})

describe('buildPushCsv (create set)', () => {
  it('appends the create-set columns (Telefon Mobil … Schiedsrichter) in order', () => {
    const csv = buildPushCsv([{ ...kacper, scorer_vb: true, referee_vb: true, iban: 'CH9300762011623852957', cd_passiv: 'Nein', cd_sektion: 'Volleyball' }], { create: true })
    const [header, row] = csv.trim().split('\n')
    // FULL literal pin — `toBe(CD_PUSH_CREATE_HEADERS.join(';'))` alone is
    // self-referential (a header deleted from the array would still pass while
    // the cells shift against ClubDesk's mapper). CREATE rows carry the real
    // wiedisync name (a new contact needs one) and never an [Id] (an unknown
    // [Id] hard-aborts ClubDesk's whole import).
    expect(header).toBe('Vorname;Nachname;E-Mail;Telefon Privat;Adresse;PLZ;Ort;Geburtsdatum;Geschlecht;IBAN;Anrede;Nationalität;AHV Nummer;Wiedisync ID;Telefon Mobil;Beitragskategorie;Eintritt;Gruppen;Status;Offiziellen Lizenz;Mitgliederbeitrag;Passivmitglied;Sektion;Schiedsrichter')
    expect(header).toBe(CD_PUSH_CREATE_HEADERS.join(';'))
    expect(header).not.toContain('[Id]')
    // header/cell count equality — catches a header/cells drift in either direction
    expect(row.split(';')).toHaveLength(header.split(';').length)
    const cells = row.split(';')
    expect(cells).toHaveLength(24)
    expect(cells[9]).toBe('CH9300762011623852957') // IBAN
    // [10..12] = Anrede/Nationalität/AHV Nummer (empty on this fixture); [13] = Wiedisync ID; create extras start at [14]
    expect(cells[14]).toBe('+41 79 000 00 00')      // Telefon Mobil = Privat
    expect(cells[15]).toBe('VB Erwerbstätige')       // Beitragskategorie
    expect(cells[16]).toBe('27.06.2026')             // Eintritt
    expect(cells[17]).toBe('VB H1 (Spieler*in)')     // Gruppen
    expect(cells[18]).toBe('Aktivmitglied')          // Status
    expect(cells[19]).toBe('VB SC')                  // Offiziellen Lizenz (scorer, not VB SR)
    expect(cells[20]).toBe('440')                    // Mitgliederbeitrag
    expect(cells[21]).toBe('Nein')                   // Passivmitglied
    expect(cells[22]).toBe('Volleyball')             // Sektion
    expect(cells[23]).toBe('Ja')                     // Schiedsrichter (referee)
  })

  it('Telefon Mobil mirrors Telefon Privat (one number → both)', () => {
    const cells = buildPushCsv([kacper], { create: true }).trim().split('\n')[1].split(';')
    expect(cells[3]).toBe(cells[14]) // Privat === Mobil
  })

  it('empty create-set optional cells stay empty (safe on a new contact)', () => {
    const row = buildPushCsv([{ ...kacper, phone: '', beitragskategorie: null, eintritt: null, gruppen: '', cd_status: '' }], { create: true })
      .trim().split('\n')[1]
    const cells = row.split(';')
    // IBAN, Anrede, Nationalität, AHV, Wiedisync ID (no id), Telefon Mobil, Beitragskategorie, Eintritt, Gruppen, Status
    for (const i of [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) expect(cells[i]).toBe('')
  })

  it('neutralises formula injection in the category cell', () => {
    const row = buildPushCsv([{ ...kacper, beitragskategorie: '=SUM(A1)' }], { create: true })
      .trim().split('\n')[1]
    expect(row.split(';')[15]).toBe("'=SUM(A1)")
  })

  it('multi-team Gruppen stays one cell (comma is safe in semicolon CSV)', () => {
    const row = buildPushCsv([{ ...kacper, gruppen: 'VB H1 (Spieler*in), VB H2 (Spieler*in)' }], { create: true })
      .trim().split('\n')[1]
    const cells = row.split(';')
    expect(cells).toHaveLength(24)
    expect(cells[17]).toBe('VB H1 (Spieler*in), VB H2 (Spieler*in)')
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

  it('a guest pays base − 110 (floored at 0), never the no-Schreiber surcharge', () => {
    expect(deriveMitgliederbeitrag('VB Erwerbstätige', null, { isGuest: true })).toBe('330')
    expect(deriveMitgliederbeitrag('VB Schüler*in Meisterschaft', null, { isGuest: true })).toBe('200')
    expect(deriveMitgliederbeitrag('VB Turnier KWI', null, { isGuest: true })).toBe('0') // 110 − 110
    // The guest flag short-circuits the surcharge: an adult non-scorer (normally
    // 540) is billed 330, not 540 − 110.
    const adultNoLic = { scorer_vb: false, otr1_bb: false, otr2_bb: false, otn_bb: false, birthdate: '1990-01-01' }
    expect(deriveMitgliederbeitrag('VB Erwerbstätige', adultNoLic, { isGuest: true })).toBe('330')
    // An unknown category is still empty even for a guest.
    expect(deriveMitgliederbeitrag('Sponsor', null, { isGuest: true })).toBe('')
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

  it('derives a (Guest) group for a guest registration (VB and BB)', () => {
    expect(deriveGruppen({ membership_type: 'volleyball', team: 'H2', rolle: 'Guest' }))
      .toBe('VB H2 (Guest)')
    expect(deriveGruppen({ membership_type: 'basketball', team: 'HU16', rolle: 'Guest' }))
      .toBe('BB HU16 (Guest)')
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

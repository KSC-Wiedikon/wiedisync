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
import { buildPushCsv, CD_PUSH_CREATE_HEADERS, CD_KATEGORIE_MAP, mapKategorie, deriveGruppen, deriveStatus, deriveMitgliederbeitrag } from '../clubdesk-update.js'

const kacper = {
  first_name: 'Kacper', last_name: 'Krawczyński', email: 'k@example.com',
  phone: '+41 79 000 00 00', adresse: 'Weg 1', plz: '8003', ort: 'Zürich',
  birthdate: '1999-03-15', sex: 'm',
  beitragskategorie: 'VB Erwerbstätige', eintritt: '2026-06-27T18:22:00.000Z',
  gruppen: 'VB H1 (Spieler*in)', cd_status: 'Aktivmitglied',
}

describe('buildPushCsv (update set)', () => {
  it('emits exactly the 10 contact columns — no category, no Eintritt', () => {
    const csv = buildPushCsv([kacper])
    const [header, row] = csv.trim().split('\n')
    expect(header).toBe('Vorname;Nachname;E-Mail;Telefon Privat;Adresse;PLZ;Ort;Geburtsdatum;Geschlecht;IBAN')
    expect(header).not.toContain('Beitragskategorie')
    expect(row.split(';')).toHaveLength(10)
    expect(row).not.toContain('VB Erwerbstätige')
  })

  it('formats birthdate dd.mm.yyyy and maps sex to ClubDesk wording', () => {
    const row = buildPushCsv([kacper]).trim().split('\n')[1]
    expect(row).toContain('15.03.1999')
    expect(row.split(';')[8]).toBe('männlich')
  })

  it('carries the member IBAN (or the /up-resolved ClubDesk echo) as the last cell', () => {
    const withIban = buildPushCsv([{ ...kacper, iban: 'CH9300762011623852957' }]).trim().split('\n')[1]
    expect(withIban.split(';')[9]).toBe('CH9300762011623852957')
    const withoutIban = buildPushCsv([kacper]).trim().split('\n')[1]
    expect(withoutIban.split(';')[9]).toBe('')
  })
})

describe('buildPushCsv (create set)', () => {
  it('appends Beitragskategorie + Eintritt + Gruppen + Status + Offiziellen Lizenz + Mitgliederbeitrag as the last six columns', () => {
    const csv = buildPushCsv([{ ...kacper, scorer_vb: true, iban: 'CH9300762011623852957' }], { create: true })
    const [header, row] = csv.trim().split('\n')
    expect(header).toBe(CD_PUSH_CREATE_HEADERS.join(';'))
    expect(header.endsWith('Beitragskategorie;Eintritt;Gruppen;Status;Offiziellen Lizenz;Mitgliederbeitrag')).toBe(true)
    const cells = row.split(';')
    expect(cells).toHaveLength(16)
    expect(cells[9]).toBe('CH9300762011623852957')
    expect(cells[10]).toBe('VB Erwerbstätige')
    expect(cells[11]).toBe('27.06.2026')
    expect(cells[12]).toBe('VB H1 (Spieler*in)')
    expect(cells[13]).toBe('Aktivmitglied')
    expect(cells[14]).toBe('Volleyball Lizenz')
    expect(cells[15]).toBe('440')
  })

  it('empty IBAN / category / Eintritt / Gruppen / Status / licence / Beitrag yield empty cells (safe on a new contact)', () => {
    const row = buildPushCsv([{ ...kacper, beitragskategorie: null, eintritt: null, gruppen: '', cd_status: '' }], { create: true })
      .trim().split('\n')[1]
    const cells = row.split(';')
    for (let i = 9; i <= 15; i++) expect(cells[i]).toBe('')
  })

  it('neutralises formula injection in the category cell', () => {
    const row = buildPushCsv([{ ...kacper, beitragskategorie: '=SUM(A1)' }], { create: true })
      .trim().split('\n')[1]
    expect(row.split(';')[10]).toBe("'=SUM(A1)")
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
    expect(cells).toHaveLength(16)
    expect(cells[12]).toBe('VB H1 (Spieler*in), VB H2 (Spieler*in)')
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

  it('adds the CHF 100 no-scorer surcharge on active VB categories', () => {
    const noScorer = { scorer_vb: false }
    const scorer = { scorer_vb: true }
    expect(deriveMitgliederbeitrag('VB Erwerbstätige', noScorer)).toBe('540')
    expect(deriveMitgliederbeitrag('VB Erwerbstätige', scorer)).toBe('440')
    expect(deriveMitgliederbeitrag('VB Student*in Meisterschaft', noScorer)).toBe('480')
    expect(deriveMitgliederbeitrag('VB Schüler*in Meisterschaft', noScorer)).toBe('410')
    expect(deriveMitgliederbeitrag('VB Schüler*in Turnier', noScorer)).toBe('310')
  })

  it('adds the CHF 100 no-officials surcharge on active BB categories', () => {
    const noLic = { otr1_bb: false, otr2_bb: false, otn_bb: false }
    const withOtr = { otr1_bb: true }
    expect(deriveMitgliederbeitrag('BB Erwerbstätige', noLic)).toBe('610')
    expect(deriveMitgliederbeitrag('BB Erwerbstätige', withOtr)).toBe('510')
    expect(deriveMitgliederbeitrag('BB Erwerbstätige 1. Liga', noLic)).toBe('660')
    expect(deriveMitgliederbeitrag('BB Lernende/Studierende', noLic)).toBe('510')
    expect(deriveMitgliederbeitrag('BB Jugend Meisterschaft', noLic)).toBe('410')
    expect(deriveMitgliederbeitrag('BB Minis Turnier', noLic)).toBe('310')
    // OTN also counts as holding an officials licence
    expect(deriveMitgliederbeitrag('BB Jugend Meisterschaft', { otn_bb: true })).toBe('310')
  })

  it('does NOT surcharge VB intro tiers, passive or gratis', () => {
    const bare = { scorer_vb: false, otr1_bb: false, otr2_bb: false, otn_bb: false }
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

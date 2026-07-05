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
import { buildPushCsv, CD_PUSH_CREATE_HEADERS, CD_KATEGORIE_MAP, mapKategorie, deriveGruppen, deriveStatus } from '../clubdesk-update.js'

const kacper = {
  first_name: 'Kacper', last_name: 'Krawczyński', email: 'k@example.com',
  phone: '+41 79 000 00 00', adresse: 'Weg 1', plz: '8003', ort: 'Zürich',
  birthdate: '1999-03-15', sex: 'm',
  beitragskategorie: 'VB Erwerbstätige', eintritt: '2026-06-27T18:22:00.000Z',
  gruppen: 'VB H1 (Spieler*in)', cd_status: 'Aktivmitglied',
}

describe('buildPushCsv (update set)', () => {
  it('emits exactly the 9 contact columns — no category, no Eintritt', () => {
    const csv = buildPushCsv([kacper])
    const [header, row] = csv.trim().split('\n')
    expect(header).toBe('Vorname;Nachname;E-Mail;Telefon Privat;Adresse;PLZ;Ort;Geburtsdatum;Geschlecht')
    expect(header).not.toContain('Beitragskategorie')
    expect(row.split(';')).toHaveLength(9)
    expect(row).not.toContain('VB Erwerbstätige')
  })

  it('formats birthdate dd.mm.yyyy and maps sex to ClubDesk wording', () => {
    const row = buildPushCsv([kacper]).trim().split('\n')[1]
    expect(row).toContain('15.03.1999')
    expect(row.endsWith('männlich')).toBe(true)
  })
})

describe('buildPushCsv (create set)', () => {
  it('appends Beitragskategorie + Eintritt + Gruppen + Status as the last four columns', () => {
    const csv = buildPushCsv([kacper], { create: true })
    const [header, row] = csv.trim().split('\n')
    expect(header).toBe(CD_PUSH_CREATE_HEADERS.join(';'))
    expect(header.endsWith('Beitragskategorie;Eintritt;Gruppen;Status')).toBe(true)
    const cells = row.split(';')
    expect(cells).toHaveLength(13)
    expect(cells[9]).toBe('VB Erwerbstätige')
    expect(cells[10]).toBe('27.06.2026')
    expect(cells[11]).toBe('VB H1 (Spieler*in)')
    expect(cells[12]).toBe('Aktivmitglied')
  })

  it('empty category / Eintritt / Gruppen / Status yield empty cells (safe on a new contact)', () => {
    const row = buildPushCsv([{ ...kacper, beitragskategorie: null, eintritt: null, gruppen: '', cd_status: '' }], { create: true })
      .trim().split('\n')[1]
    const cells = row.split(';')
    expect(cells[9]).toBe('')
    expect(cells[10]).toBe('')
    expect(cells[11]).toBe('')
    expect(cells[12]).toBe('')
  })

  it('neutralises formula injection in the category cell', () => {
    const row = buildPushCsv([{ ...kacper, beitragskategorie: '=SUM(A1)' }], { create: true })
      .trim().split('\n')[1]
    expect(row.split(';')[9]).toBe("'=SUM(A1)")
  })

  it('multi-team Gruppen stays one cell (comma is safe in semicolon CSV)', () => {
    const row = buildPushCsv([{ ...kacper, gruppen: 'VB H1 (Spieler*in), VB H2 (Spieler*in)' }], { create: true })
      .trim().split('\n')[1]
    const cells = row.split(';')
    expect(cells).toHaveLength(13)
    expect(cells[11]).toBe('VB H1 (Spieler*in), VB H2 (Spieler*in)')
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
})

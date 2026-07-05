/**
 * Unit tests for the sync-up push CSV builder (clubdesk-update.js) — the two-set
 * split introduced with migration 173: UPDATE rows carry contact fields only,
 * CREATE rows additionally carry Beitragskategorie + Eintritt. The invariants
 * here guard the legal-register safety rule: an UPDATE CSV must NEVER contain a
 * category column (ClubDesk-authoritative on existing contacts; empty-cell
 * import semantics unvalidated).
 *
 * Hermetic — pure functions, no DB or network.
 */
import { describe, it, expect } from 'vitest'
import { buildPushCsv, CD_PUSH_CREATE_HEADERS, CD_KATEGORIE_MAP, mapKategorie } from '../clubdesk-update.js'

const kacper = {
  first_name: 'Kacper', last_name: 'Krawczyński', email: 'k@example.com',
  phone: '+41 79 000 00 00', adresse: 'Weg 1', plz: '8003', ort: 'Zürich',
  birthdate: '1999-03-15', sex: 'm',
  beitragskategorie: 'VB Erwerbstätige', eintritt: '2026-06-27T18:22:00.000Z',
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
  it('appends Beitragskategorie + Eintritt as the last two columns', () => {
    const csv = buildPushCsv([kacper], { create: true })
    const [header, row] = csv.trim().split('\n')
    expect(header).toBe(CD_PUSH_CREATE_HEADERS.join(';'))
    expect(header.endsWith('Beitragskategorie;Eintritt')).toBe(true)
    const cells = row.split(';')
    expect(cells).toHaveLength(11)
    expect(cells[9]).toBe('VB Erwerbstätige')
    expect(cells[10]).toBe('27.06.2026')
  })

  it('empty category / missing Eintritt yield empty cells (safe on a new contact)', () => {
    const row = buildPushCsv([{ ...kacper, beitragskategorie: null, eintritt: null }], { create: true })
      .trim().split('\n')[1]
    const cells = row.split(';')
    expect(cells[9]).toBe('')
    expect(cells[10]).toBe('')
  })

  it('neutralises formula injection in the category cell', () => {
    const row = buildPushCsv([{ ...kacper, beitragskategorie: '=SUM(A1)' }], { create: true })
      .trim().split('\n')[1]
    expect(row.split(';')[9]).toBe("'=SUM(A1)")
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

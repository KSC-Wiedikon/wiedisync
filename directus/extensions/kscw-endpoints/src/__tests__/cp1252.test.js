/**
 * Unit tests for toCp1252Buffer (clubdesk-update.js) — the Windows-1252 encoder
 * used for CSV attachments that admins import into ClubDesk by hand. ClubDesk's
 * CSV interface is CP1252-only; the invariants here mirror what the scripted
 * sync-up push gets from `iconv -t WINDOWS-1252//TRANSLIT`.
 *
 * Hermetic — pure function, no DB or network.
 */
import { describe, it, expect } from 'vitest'
import { toCp1252Buffer } from '../clubdesk-update.js'

describe('toCp1252Buffer', () => {
  it('passes ASCII through unchanged', () => {
    const buf = toCp1252Buffer('Vorname,Nachname\nKevin,Hunziker')
    expect(buf.toString('latin1')).toBe('Vorname,Nachname\nKevin,Hunziker')
  })

  it('encodes Latin-1 letters as single CP1252 bytes (ü ä é è ç)', () => {
    const buf = toCp1252Buffer('Hüsler Clüver Bolgé Naïve François')
    expect([...buf]).toEqual([...'Hüsler Clüver Bolgé Naïve François'].map(c => c.charCodeAt(0)))
  })

  it('encodes the CP1252 0x80-0x9F block (€ Š œ ž dashes quotes)', () => {
    expect([...toCp1252Buffer('€')]).toEqual([0x80])
    expect([...toCp1252Buffer('Šimun')]).toEqual([0x8A, 0x69, 0x6D, 0x75, 0x6E])
    expect([...toCp1252Buffer('œ–”')]).toEqual([0x9C, 0x96, 0x94])
  })

  it('transliterates letters CP1252 cannot hold instead of writing ?', () => {
    expect(toCp1252Buffer('Curavić').toString('latin1')).toBe('Curavic')
    expect(toCp1252Buffer('Krawczyński').toString('latin1')).toBe('Krawczynski')
    expect(toCp1252Buffer('Đoković').toString('latin1')).toBe('Dokovic')
    expect(toCp1252Buffer('Łukasz').toString('latin1')).toBe('Lukasz')
    // Dotless i has no CP1252 slot AND no decomposition, so without a table entry
    // it fell through to '?' — a Turkish member ("Işık", "Altınbaş" — not rare in
    // Zurich) reached the register as "Is?k" while the licence PDF said "Isik".
    expect(toCp1252Buffer('Işık').toString('latin1')).toBe('Isik')
    expect(toCp1252Buffer('Altınbaş').toString('latin1')).toBe('Altinbas')
    expect(toCp1252Buffer('Ħamrun').toString('latin1')).toBe('Hamrun')
    expect(toCp1252Buffer('Ŧoma').toString('latin1')).toBe('Toma')
  })

  // kscw-website writes the same names through admin.astro (CP1252_TRANSLIT, for
  // both the licence PDFs and the ClubDesk CSV) and registration-form.js
  // (NON_DECOMPOSING). All three tables must carry the same letters, or one member
  // is spelled two ways depending on which document they land in.
  it('covers every letter kscw-website transliterates', () => {
    const shared = { 'đ': 'd', 'Đ': 'D', 'ł': 'l', 'Ł': 'L', 'ı': 'i', 'ħ': 'h', 'Ħ': 'H', 'ŧ': 't', 'Ŧ': 'T' }
    for (const [ch, expected] of Object.entries(shared)) {
      expect(toCp1252Buffer(ch).toString('latin1'), `${ch} must transliterate to ${expected}`).toBe(expected)
    }
  })

  it('falls back to ? only for genuinely unmappable characters', () => {
    expect(toCp1252Buffer('北').toString('latin1')).toBe('?')
    expect(toCp1252Buffer('a北b').toString('latin1')).toBe('a?b')
  })

  it('never emits multi-byte sequences (every char becomes >=1 single bytes)', () => {
    const buf = toCp1252Buffer('Curavić; Hüsler; €10')
    for (const b of buf) expect(b).toBeLessThanOrEqual(0xFF)
  })
})

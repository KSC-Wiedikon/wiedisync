/**
 * Unit tests for bbRequiredDocs / bbIsMinor (bb-docs.js) — the shared basketball
 * required-document logic enforced at four points (registration create, doc-status,
 * approval gate, and the client form). Encodes Swiss Basketball's "Liste der
 * Dokumente für jeden Fall" per licensing situation × nationality × age.
 *
 * Hermetic — pure functions, no DB or network. bbIsMinor is season-relative
 * (Sept 1), so ages are chosen far from the boundary to stay stable year-round.
 */
import { describe, it, expect } from 'vitest'
import { bbRequiredDocs, bbIsMinor, BB_SITUATIONS } from '../bb-docs.js'

// A birthday ~10 years ago is always a minor; ~40 years ago always an adult,
// regardless of which side of Sept 1 the test runs on.
const now = new Date()
const minorDob = `${now.getUTCFullYear() - 10}-01-15`
const adultDob = `${now.getUTCFullYear() - 40}-01-15`

const set = (a) => [...a].sort()

describe('bbIsMinor', () => {
  it('is false for empty / malformed input', () => {
    expect(bbIsMinor(null)).toBe(false)
    expect(bbIsMinor('')).toBe(false)
    expect(bbIsMinor('2010')).toBe(false)
    expect(bbIsMinor(new Date('nonsense'))).toBe(false)
  })
  it('classifies a 10-year-old as a minor and a 40-year-old as an adult (string DOB)', () => {
    expect(bbIsMinor(minorDob)).toBe(true)
    expect(bbIsMinor(adultDob)).toBe(false)
  })
  it('accepts a JS Date (raw-knex reads of the PG `date` column) — regression for the doc-status/approval-gate backstop', () => {
    // pg returns `date` columns as local-midnight Date objects; String(date)
    // used to yield "Thu Jan 15" and make every applicant look adult.
    const minorAsDate = new Date(Number(minorDob.slice(0, 4)), 0, 15)
    const adultAsDate = new Date(Number(adultDob.slice(0, 4)), 0, 15)
    expect(bbIsMinor(minorAsDate)).toBe(true)
    expect(bbIsMinor(adultAsDate)).toBe(false)
  })
  it('bbRequiredDocs honours a Date DOB for a minor international transfer', () => {
    const minorAsDate = new Date(Number(minorDob.slice(0, 4)), 0, 15)
    expect(set(bbRequiredDocs('transfer_intl', 'CH', minorAsDate)))
      .toEqual(set(['id_upload_front', 'id_upload_back', 'bb_doc_lizenz', 'bb_doc_selfdecl', 'bb_doc_natdecl', 'bb_doc_u18parents']))
  })
})

describe('bbRequiredDocs — always requires the base three', () => {
  it('new Swiss adult → ID front/back + Lizenzantrag only', () => {
    expect(set(bbRequiredDocs('neu', 'CH', adultDob)))
      .toEqual(set(['id_upload_front', 'id_upload_back', 'bb_doc_lizenz']))
  })
})

describe('bbRequiredDocs — new player', () => {
  it('foreign adult → + self declaration (no national team decl.)', () => {
    expect(set(bbRequiredDocs('neu', 'IT', adultDob)))
      .toEqual(set(['id_upload_front', 'id_upload_back', 'bb_doc_lizenz', 'bb_doc_selfdecl']))
  })
  it('foreign minor → + self declaration + national team declaration', () => {
    expect(set(bbRequiredDocs('neu', 'IT', minorDob)))
      .toEqual(set(['id_upload_front', 'id_upload_back', 'bb_doc_lizenz', 'bb_doc_selfdecl', 'bb_doc_natdecl']))
  })
  it('Swiss minor → still just the base three', () => {
    expect(set(bbRequiredDocs('neu', 'CH', minorDob)))
      .toEqual(set(['id_upload_front', 'id_upload_back', 'bb_doc_lizenz']))
  })
})

describe('bbRequiredDocs — transfer from a Swiss club', () => {
  it('requires the Freibrief regardless of nationality/age', () => {
    const exp = set(['id_upload_front', 'id_upload_back', 'bb_doc_lizenz', 'bb_doc_freibrief'])
    expect(set(bbRequiredDocs('transfer_ch', 'CH', adultDob))).toEqual(exp)
    expect(set(bbRequiredDocs('transfer_ch', 'IT', minorDob))).toEqual(exp)
  })
})

describe('bbRequiredDocs — international transfer / returner', () => {
  for (const sit of ['transfer_intl', 'rueckkehr']) {
    it(`${sit} adult → + self declaration`, () => {
      expect(set(bbRequiredDocs(sit, 'CH', adultDob)))
        .toEqual(set(['id_upload_front', 'id_upload_back', 'bb_doc_lizenz', 'bb_doc_selfdecl']))
    })
    it(`${sit} minor → + self decl. + national team decl. + U18 parental consent (school cert stays optional)`, () => {
      expect(set(bbRequiredDocs(sit, 'CH', minorDob)))
        .toEqual(set(['id_upload_front', 'id_upload_back', 'bb_doc_lizenz', 'bb_doc_selfdecl', 'bb_doc_natdecl', 'bb_doc_u18parents']))
    })
    it(`${sit} never requires the optional school certificate`, () => {
      expect(bbRequiredDocs(sit, 'IT', minorDob)).not.toContain('bb_doc_schoolcert')
    })
  }
})

describe('bbRequiredDocs — legacy fallback (no/unknown situation)', () => {
  it('unknown situation + foreign → legacy natCode rule (self + national team decl.)', () => {
    expect(set(bbRequiredDocs(null, 'IT', adultDob)))
      .toEqual(set(['id_upload_front', 'id_upload_back', 'bb_doc_lizenz', 'bb_doc_selfdecl', 'bb_doc_natdecl']))
    expect(set(bbRequiredDocs('garbage', 'IT', adultDob)))
      .toEqual(set(['id_upload_front', 'id_upload_back', 'bb_doc_lizenz', 'bb_doc_selfdecl', 'bb_doc_natdecl']))
  })
  it('unknown situation + Swiss → base three', () => {
    expect(set(bbRequiredDocs(null, 'CH', adultDob)))
      .toEqual(set(['id_upload_front', 'id_upload_back', 'bb_doc_lizenz']))
  })
})

describe('BB_SITUATIONS', () => {
  it('is the exact whitelist the form + backend accept', () => {
    expect(BB_SITUATIONS).toEqual(['neu', 'transfer_ch', 'transfer_intl', 'rueckkehr'])
  })
})

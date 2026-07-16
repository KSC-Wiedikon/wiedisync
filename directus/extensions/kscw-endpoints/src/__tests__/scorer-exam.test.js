import { describe, it, expect } from 'vitest'
import {
  sniffType, signTicket, verifyTicket, zurichToday, normalizeEmail, normalizeLicence,
  answersOf, pick, SCORER_EXAM_FOLDER,
} from '../scorer-exam.js'

const SECRET = 'test-secret-not-the-real-one'

// Minimal 12-byte-plus headers — sniffType only ever looks at the first 12.
const pdf = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(8)])
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)])
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)])
const heic = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('heic')])
const avif = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('avif')])

describe('sniffType', () => {
  it('accepts the formats a participant can plausibly produce', () => {
    expect(sniffType(pdf)).toBe('application/pdf')
    expect(sniffType(jpeg)).toBe('image/jpeg')
    expect(sniffType(png)).toBe('image/png')
    expect(sniffType(avif)).toBe('image/avif')
  })

  // HEIC is a valid photo an iPhone really produces, and it is refused anyway: Chrome and
  // Firefox cannot decode it, so it can be neither previewed in /admin nor folded into the
  // PDF the SVRZ zip ships. Accepting it would mean storing a file nobody downstream can
  // open — better to say so at upload, while the participant can still re-shoot it.
  it('refuses HEIC even though the bytes are a real image', () => {
    expect(sniffType(heic)).toBeNull()
    for (const brand of ['heix', 'hevc', 'mif1', 'heim']) {
      expect(sniffType(Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from(brand)]))).toBeNull()
    }
  })

  // The whole point of sniffing: a filename and a Content-Type are attacker-chosen, so
  // HTML must not become a stored-XSS payload just by being named .pdf.
  it('rejects HTML, scripts and other non-document bytes', () => {
    expect(sniffType(Buffer.from('<!DOCTYPE html><script>alert(1)</script>'))).toBeNull()
    expect(sniffType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull()
    expect(sniffType(Buffer.from('PK\x03\x04' + '\0'.repeat(20)))).toBeNull() // zip/xlsx
    expect(sniffType(Buffer.from('#!/bin/sh\necho hi\n'))).toBeNull()
  })

  it('rejects a PDF magic that does not start at byte 0', () => {
    expect(sniffType(Buffer.concat([Buffer.from('XX'), pdf]))).toBeNull()
  })

  it('returns null rather than throwing on short or absent input', () => {
    expect(sniffType(Buffer.from('%PDF'))).toBeNull() // < 12 bytes
    expect(sniffType(Buffer.alloc(0))).toBeNull()
    expect(sniffType(null)).toBeNull()
  })

  it('does not accept an unknown ISO-BMFF brand', () => {
    expect(sniffType(Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('qt  ')]))).toBeNull()
  })
})

describe('ticket', () => {
  const payload = { k: 'scorercourse-de-2026:42', s: 'scorercourse-de-2026', i: '42' }

  it('round-trips a ticket it signed', () => {
    const t = signTicket({ ...payload, exp: Date.now() + 60_000 }, SECRET)
    expect(verifyTicket(t, SECRET)).toMatchObject(payload)
  })

  // This is what stops a caller uploading as someone whose email they never proved.
  it('rejects a tampered payload', () => {
    const t = signTicket({ ...payload, exp: Date.now() + 60_000 }, SECRET)
    const [body] = t.split('.')
    const evil = Buffer.from(JSON.stringify({
      k: 'scorercourse-de-2026:99', s: 'scorercourse-de-2026', i: '99', exp: Date.now() + 60_000,
    })).toString('base64url')
    expect(verifyTicket(`${evil}.${t.split('.')[1]}`, SECRET)).toBeNull()
    expect(verifyTicket(`${body}.deadbeef`, SECRET)).toBeNull()
  })

  it('rejects a ticket signed with a different secret', () => {
    const t = signTicket({ ...payload, exp: Date.now() + 60_000 }, 'other-secret')
    expect(verifyTicket(t, SECRET)).toBeNull()
  })

  it('rejects an expired ticket', () => {
    const t = signTicket({ ...payload, exp: 1_000 }, SECRET)
    expect(verifyTicket(t, SECRET, 2_000)).toBeNull()
    expect(verifyTicket(t, SECRET, 500)).toMatchObject(payload)
  })

  it('rejects a payload with no expiry — absent must never mean eternal', () => {
    const t = signTicket({ ...payload }, SECRET)
    expect(verifyTicket(t, SECRET)).toBeNull()
  })

  it('rejects malformed input without throwing', () => {
    for (const bad of ['', 'x', 'a.b.c', null, undefined, 'notbase64.notbase64']) {
      expect(verifyTicket(bad, SECRET)).toBeNull()
    }
  })

  // Fail closed: no secret configured must not degrade into "everything verifies".
  it('rejects everything when no secret is configured', () => {
    expect(verifyTicket(signTicket({ ...payload, exp: Date.now() + 60_000 }, SECRET), '')).toBeNull()
  })
})

describe('zurichToday', () => {
  it('formats as ISO YYYY-MM-DD (storage format, not the dd.mm.yyyy display format)', () => {
    expect(zurichToday(new Date('2026-08-19T10:00:00Z'))).toBe('2026-08-19')
  })

  // 23:30 UTC in summer is already the next day in Zurich (UTC+2). Storing the UTC date
  // would print the wrong Prüfungsdatum on an official SVRZ list.
  it('uses the Zurich calendar day, not the UTC one', () => {
    expect(zurichToday(new Date('2026-08-19T23:30:00Z'))).toBe('2026-08-20')
    expect(zurichToday(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16') // CET, +1
  })
})

describe('normalizeEmail', () => {
  it('matches registrations case- and whitespace-insensitively', () => {
    expect(normalizeEmail('  Max.Muster@Example.CH ')).toBe('max.muster@example.ch')
    expect(normalizeEmail(null)).toBe('')
  })
})

// The shape of a real OpnForm submission row, as returned by listSubmissions: the answers
// are nested under `data` and keyed by field id — the row itself carries only metadata.
const EMAIL_ID = '3ff796a7-33e3-42ac-9a29-b83b821c984a'
const FIRST_ID = '718ff4f7-48ad-48c3-bc48-76319fbdc89c'
const realRow = {
  id: 35,
  form_id: 7,
  submission_id: 'abc',
  completion_time: 42,
  data: { [EMAIL_ID]: 'Max.Muster@Example.CH', [FIRST_ID]: 'Max' },
}

describe('answersOf / pick', () => {
  // Regression: pick() originally read row[fieldId] instead of row.data[fieldId]. Field
  // DETECTION still succeeded, so nothing looked broken — every lookup just matched
  // nobody, and the upload gate was shut for all 24 registrants with a "you are not
  // registered" message. Verified against the live payload: 0/24 before, 24/24 after.
  it('reads answers out of row.data, not off the row', () => {
    expect(pick(realRow, [EMAIL_ID])).toBe('Max.Muster@Example.CH')
    expect(pick(realRow, [FIRST_ID])).toBe('Max')
  })

  it('does not confuse row metadata with an answer', () => {
    // 'id' is a row key, never a field id — it must not leak through as an answer.
    expect(pick(realRow, ['id'])).toBe('')
  })

  it('finds the email of every row in a realistic listing', () => {
    const rows = [realRow, { id: 36, data: { [EMAIL_ID]: 'a@b.ch' } }]
    const found = rows.map((r) => normalizeEmail(pick(r, [EMAIL_ID]))).filter(Boolean)
    expect(found).toEqual(['max.muster@example.ch', 'a@b.ch'])
  })

  it('tolerates a flat row too (admin.astro accepts both shapes)', () => {
    expect(pick({ [EMAIL_ID]: 'flat@b.ch' }, [EMAIL_ID])).toBe('flat@b.ch')
    expect(answersOf(null)).toEqual({})
  })

  it('falls through to the next candidate id when the first is empty', () => {
    expect(pick(realRow, ['missing-id', EMAIL_ID])).toBe('Max.Muster@Example.CH')
  })
})

describe('normalizeLicence', () => {
  it('keeps the digits of a real licence number', () => {
    // The four licences actually on file are all 6-digit.
    for (const n of ['337646', '331590', '333200', '323744']) expect(normalizeLicence(n)).toBe(n)
  })

  it('strips the separators people type', () => {
    expect(normalizeLicence(' 337 646 ')).toBe('337646')
    expect(normalizeLicence('337-646')).toBe('337646')
    expect(normalizeLicence('337.646')).toBe('337646')
    expect(normalizeLicence('Nr. 337646')).toBe('337646')
  })

  it('accepts a number, not just a string (the form field is type=number)', () => {
    expect(normalizeLicence(337646)).toBe('337646')
  })

  it('rejects empty, absent and non-numeric input', () => {
    for (const bad of ['', '   ', null, undefined, 'abcdef', '-']) expect(normalizeLicence(bad)).toBe('')
  })

  it('rejects lengths outside the plausible range rather than storing junk', () => {
    expect(normalizeLicence('123')).toBe('')
    expect(normalizeLicence('12345678901')).toBe('')
    expect(normalizeLicence('1234')).toBe('1234')
    expect(normalizeLicence('1234567890')).toBe('1234567890')
  })
})

describe('SCORER_EXAM_FOLDER', () => {
  // Not cosmetic: the Public file policy grants /assets reads on folder-less files only,
  // so an upload with folder=null would be world-readable by id.
  it('is a non-empty uuid the upload path can always set', () => {
    expect(SCORER_EXAM_FOLDER).toMatch(/^[0-9a-f-]{36}$/i)
  })
})

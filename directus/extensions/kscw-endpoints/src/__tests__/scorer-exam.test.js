import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The notification's two I/O dependencies. Mocked at the module edge so the tests can
// drive the failure paths (dead OpnForm, unreadable blob) that the whole design hinges
// on — those are exactly the branches that must not throw, and they are unreachable
// otherwise without a live form and a live storage driver.
vi.mock('../opnform.js', () => ({ listSubmissions: vi.fn() }))
vi.mock('../storage-read.js', () => ({ readManagedFile: vi.fn() }))

import { listSubmissions } from '../opnform.js'
import { readManagedFile } from '../storage-read.js'
import {
  sniffType, signTicket, verifyTicket, zurichToday, normalizeEmail, normalizeLicence,
  answersOf, pick, SCORER_EXAM_FOLDER, notifyExamUpload,
  SCORER_AUSBILDUNG_EMAIL, SCORER_AUSBILDUNG_FROM,
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

// ── notification ────────────────────────────────────────────────────────────────
// The upload used to be silent — a row landed in /admin and nothing told anyone, while
// the participant's success screen promised "wir melden uns per E-Mail". These pin the
// two things that matter: the mail goes to the club, and NOTHING in the notification
// path can throw. It runs after the file and the attendance row have committed, so an
// exception here would 500 a request whose work already succeeded and invite a retry
// that re-uploads the same sheet.
describe('notifyExamUpload', () => {
  const CLAIM = { k: 'schreiberkurs-de:42', s: 'schreiberkurs-de', i: '42' }
  const COURSE = { id: 7, date_iso: '2026-08-15' }
  const INFO = {
    claim: CLAIM, course: COURSE, fileId: 'f1e2d3c4-0000-4000-8000-000000000001',
    type: 'application/pdf', replaced: false, uploadedOn: '2026-07-29', licence: '337646',
  }

  /** Collects log lines instead of asserting on them one by one. */
  const makeLog = () => {
    const lines = { warn: [], error: [], info: [] }
    return {
      lines,
      warn: (o) => lines.warn.push(o),
      error: (o) => lines.error.push(o),
      info: (o) => lines.info.push(o),
    }
  }

  /** ctx with pluggable failure modes; `sent` captures what MailService received. */
  const makeCtx = ({ mailThrows = false } = {}) => {
    const sent = []
    return {
      sent,
      ctx: {
        database: {},
        getSchema: async () => ({}),
        services: {
          MailService: class {
            async send(msg) {
              if (mailThrows) throw new Error('SES refused the message')
              sent.push(msg)
            }
          },
        },
      },
    }
  }

  beforeEach(() => {
    vi.mocked(listSubmissions).mockReset()
    vi.mocked(readManagedFile).mockReset()
    // Happy path by default; individual tests break one dependency at a time.
    vi.mocked(listSubmissions).mockResolvedValue({
      fields: [
        { id: 'fa', name: 'E-Mail', type: 'email' },
        { id: 'fb', name: 'Vorname', type: 'text' },
        { id: 'fc', name: 'Nachname', type: 'text' },
      ],
      // ⚠ answers live in row.data, not on the row — see answersOf().
      data: [{ id: 42, data: { fa: 'Anna.Beispiel@example.ch', fb: 'Anna', fc: 'Beispiel' } }],
    })
    vi.mocked(readManagedFile).mockResolvedValue({
      file: { filename_download: 'matchblatt.pdf', type: 'application/pdf' },
      bytes: Buffer.alloc(2048),
    })
  })

  it('mails the Ausbildung mailbox with the scoresheet attached', async () => {
    const { sent, ctx } = makeCtx()
    await notifyExamUpload(ctx, makeLog(), INFO)

    expect(sent).toHaveLength(1)
    const [msg] = sent
    // The default recipient is the whole point of the feature.
    expect(msg.to).toBe('scorer@volleyball.kscw.ch')
    expect(msg.subject).toContain('Anna Beispiel')
    expect(msg.attachments).toHaveLength(1)
    expect(msg.attachments[0].content).toHaveLength(2048)
    // Identity + licence must be readable without opening the attachment.
    expect(msg.html).toContain('Anna Beispiel')
    expect(msg.html).toContain('anna.beispiel@example.ch')
    expect(msg.html).toContain('337646')
    // Swiss dot format everywhere, never 2026-08-15 (CLAUDE.md time &amp; date rule).
    expect(msg.html).toContain('15.08.2026')
    // Deep-links straight at the course that needs reviewing — and at kscw.ch directly,
    // NOT via kscw-website.pages.dev, whose 302 to kscw.ch is a transitional redirect
    // already past its keep-until date. Routing these mails through it would break them
    // the day it is removed.
    expect(msg.html).toContain('https://kscw.ch/admin/?tab=scorer_courses&amp;course=7')
  })

  it('still sends when OpnForm is down — an unnamed upload is worth knowing about', async () => {
    vi.mocked(listSubmissions).mockRejectedValue(new Error('opnform 502'))
    const { sent, ctx } = makeCtx()
    const log = makeLog()

    await expect(notifyExamUpload(ctx, log, INFO)).resolves.toBeUndefined()
    expect(sent).toHaveLength(1)
    // Falls back to the sub_key so the row is still identifiable by hand.
    expect(sent[0].subject).toContain(CLAIM.k)
    expect(log.lines.warn).toHaveLength(1)
  })

  it('still sends when the bytes cannot be read, and says the attachment is missing', async () => {
    vi.mocked(readManagedFile).mockRejectedValue(Object.assign(new Error('too large'), { status: 413 }))
    const { sent, ctx } = makeCtx()
    const log = makeLog()

    await notifyExamUpload(ctx, log, INFO)
    expect(sent).toHaveLength(1)
    expect(sent[0].attachments).toBeUndefined()
    expect(sent[0].html).toContain('konnte nicht angeh')
    expect(log.lines.warn).toHaveLength(1)
  })

  it('swallows a mail failure instead of 500-ing an upload that already succeeded', async () => {
    const { ctx } = makeCtx({ mailThrows: true })
    const log = makeLog()

    await expect(notifyExamUpload(ctx, log, INFO)).resolves.toBeUndefined()
    expect(log.lines.error).toHaveLength(1)
    expect(log.lines.error[0].msg).toContain('SES refused')
  })

  it('flags a re-upload so nobody reviews a superseded sheet', async () => {
    const { sent, ctx } = makeCtx()
    await notifyExamUpload(ctx, makeLog(), { ...INFO, replaced: true })
    expect(sent[0].html).toContain('Ersetzt ein fr')
  })
})

// The dev OFF switch. dev's .env carries `SCORER_EXAM_NOTIFY_EMAILS=` (present, empty) so
// test uploads there don't mail the club; prod leaves it unset and gets the default.
//
// That distinction rests entirely on `??` — an edit to `||` "for consistency" would make
// the empty string fall through to the default and silently start mailing the club from
// dev, with nothing failing. Re-imported per case because the list is read at module load.
describe('EXAM_NOTIFY_EMAILS env switch', () => {
  const load = async (value) => {
    vi.resetModules()
    if (value === undefined) vi.stubEnv('SCORER_EXAM_NOTIFY_EMAILS', undefined)
    else vi.stubEnv('SCORER_EXAM_NOTIFY_EMAILS', value)
    return import('../scorer-exam.js')
  }

  /** ctx whose MailService records sends; readManagedFile/listSubmissions stay mocked. */
  const probe = () => {
    const sent = []
    return {
      sent,
      ctx: {
        database: {}, getSchema: async () => ({}),
        services: { MailService: class { async send(m) { sent.push(m) } } },
      },
    }
  }
  const LOG = { warn() {}, error() {}, info() {} }
  const INFO = {
    claim: { k: 'kurs:1', s: 'kurs', i: '1' }, course: null,
    fileId: 'f', type: 'application/pdf', replaced: false, uploadedOn: '2026-07-29', licence: '1234',
  }

  beforeEach(() => {
    vi.mocked(listSubmissions).mockResolvedValue({ fields: [], data: [] })
    vi.mocked(readManagedFile).mockResolvedValue({ file: {}, bytes: Buffer.alloc(8) })
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it('present-but-empty sends nothing (the dev switch)', async () => {
    const mod = await load('')
    const { sent, ctx } = probe()
    await mod.notifyExamUpload(ctx, LOG, INFO)
    expect(sent).toHaveLength(0)
  })

  it('unset falls back to the Ausbildung mailbox (prod)', async () => {
    const mod = await load(undefined)
    const { sent, ctx } = probe()
    await mod.notifyExamUpload(ctx, LOG, INFO)
    expect(sent).toHaveLength(1)
    // Pinned against the exported constant, so the mailbox is named in exactly one
    // place and wadmin.js's Reply-To cannot drift away from the notification recipient.
    expect(sent[0].to).toBe(mod.SCORER_AUSBILDUNG_EMAIL)
    expect(sent[0].to).toBe('scorer@volleyball.kscw.ch')
  })

  it('a comma list is trimmed, lowercased and de-blanked', async () => {
    const mod = await load('A@x.ch, ,b@Y.CH ')
    const { sent, ctx } = probe()
    await mod.notifyExamUpload(ctx, LOG, INFO)
    expect(sent[0].to).toBe('a@x.ch, b@y.ch')
  })
})

// The address is also a From since 2026-08-15, and that is only safe on a domain AWS SES
// holds an identity for. wiedisync.kscw.ch is not one and is DMARC p=quarantine, so
// moving the box back there would not bounce — it would be silently quarantined at the
// receiver, i.e. invisible. Pin the domain so that move cannot happen quietly.
describe('the Ausbildung mailbox as a sender', () => {
  it('lives on an SES-verified domain', () => {
    expect(SCORER_AUSBILDUNG_EMAIL).toBe('scorer@volleyball.kscw.ch')
    expect(SCORER_AUSBILDUNG_EMAIL.split('@')[1]).toBe('volleyball.kscw.ch')
  })

  // Directus's MailService throws InvalidPayloadError on an object From missing either
  // half, and the exam-result mail is the only place we pass one.
  it('is a complete From object', () => {
    expect(SCORER_AUSBILDUNG_FROM.address).toBe(SCORER_AUSBILDUNG_EMAIL)
    expect(SCORER_AUSBILDUNG_FROM.name).toBeTruthy()
  })
})

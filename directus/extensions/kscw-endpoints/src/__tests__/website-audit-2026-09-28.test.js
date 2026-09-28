// Pins the public-endpoint fixes from the 2026-09-28 kscw-website audit
// (F-06, F-08/C2, F-09, F-13, F-14, F-32, F-33, F-34, F-35, F-36, F-37, F-59, F-60).
// Each block names its finding. (The pre-rebase C1 form-upload route and the
// has_licence lookup field were superseded by the deep audit's designs.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PassThrough } from 'node:stream'

vi.hoisted(() => {
  // Module-level reads in public-upload.js / scorer-exam.js happen at import time.
  process.env.TURNSTILE_SECRET = 'test-turnstile'
  process.env.SECRET = 'test-ticket-secret'
  // sv-sync.js (imported by index.js) refuses to load without it.
  process.env.SV_API_KEY ||= 'test-key'
  process.env.ERROR_LOG_DIR = `${require('node:os').tmpdir()}/kscw-audit-${process.pid}-${Date.now()}`
})

import {
  sniffUpload, ipBucket, createLimiter, safeFilename, parseMultipart, readRawBody,
} from '../public-upload.js'
import { registerPublicFeedback, buildFeedbackRow, FEEDBACK_FILES_FOLDER } from '../public-feedback.js'
import {
  capText, registrationNameOk, mintUploadTicket, checkUploadTicket, UPLOAD_TICKET_MAX_USES,
  feeCategoryRejected, registerRegistration, REGISTRATION_FILES_FOLDER,
} from '../registration.js'
import { approvedFeeCategory } from '../fee-category.js'
import { approvedFeeCategory as hooksApprovedFeeCategory } from '../../../kscw-hooks/src/fee-category.js'
import { isGraded, signTicket, registerScorerExam } from '../scorer-exam.js'
import endpoints, { pickPublicTeam, publicMemberName, PUBLIC_TEAM_DETAIL_FIELDS } from '../index.js'
import { capLogged } from '../error-log.js'
import { getCount, _resetCountCache } from '../opnform.js'
import { registerNewsletter } from '../newsletter.js'
import { registerPasswordReset } from '../password-reset.js'
import { registerBugfixes } from '../bugfixes.js'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'

// ── fakes ─────────────────────────────────────────────────────────────────────

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)])
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(40)])
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(20)])
const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)])
const html = Buffer.from('<!DOCTYPE html><script>alert(1)</script>')

/** knex-shaped fake: every builder method chains; `first()` and `await` read `tables[name]`. */
function makeDb(tables = {}) {
  const calls = []
  const db = (name) => {
    const t = tables[name] || {}
    const proxy = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') {
          const v = typeof t.result === 'function' ? t.result(calls) : t.result
          return (res, rej) => Promise.resolve(v).then(res, rej)
        }
        if (prop === 'first') {
          return (...a) => {
            calls.push([name, 'first', a])
            return Promise.resolve(typeof t.first === 'function' ? t.first(calls) : t.first)
          }
        }
        return (...a) => {
          calls.push([name, prop, a])
          if (typeof t[prop] === 'function' && prop !== 'where') {
            const r = t[prop](...a)
            if (r && typeof r.then === 'function') return r
          }
          if (typeof a[0] === 'function') { try { a[0](proxy) } catch { /* builder callback */ } }
          return proxy
        }
      },
    })
    return proxy
  }
  db.raw = (x) => ({ raw: x })
  db.fn = { now: () => 'now()' }
  db.calls = calls
  return db
}

function makeRes() {
  return {
    statusCode: 200, body: undefined, headersSent: false,
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; this.headersSent = true; return this },
    end() { this.headersSent = true; return this },
    set() { return this },
  }
}

function makeRouter() {
  const routes = {}
  const reg = (m) => (path, h) => { routes[`${m} ${path}`] = h }
  return { routes, get: reg('GET'), post: reg('POST'), delete: reg('DELETE'), patch: reg('PATCH') }
}

const noopLogger = { child: () => ({ info() {}, warn() {}, error() {} }) }

function makeServices() {
  const uploads = []
  const created = []
  const deleted = []
  class FilesService {
    async uploadOne(stream, data) {
      const chunks = []
      for await (const c of stream) chunks.push(Buffer.from(c))
      uploads.push({ data, bytes: Buffer.concat(chunks) })
      return `file-${uploads.length}`
    }
    async deleteMany(ids) { deleted.push(...ids) }
  }
  class ItemsService {
    constructor(collection, opts = {}) { this.collection = collection; this.accountability = opts.accountability }
    async createOne(row, opts) { created.push({ collection: this.collection, row, opts, accountability: this.accountability }); return 1 }
  }
  return { services: { FilesService, ItemsService }, uploads, created, deleted }
}

/** A real multipart body, produced by the platform's own FormData encoder. */
async function multipartReq(parts, { headers = {}, ip = '203.0.113.9' } = {}) {
  const fd = new FormData()
  for (const [k, v, name] of parts) {
    if (Buffer.isBuffer(v)) fd.append(k, new Blob([v]), name || 'file.bin')
    else fd.append(k, v)
  }
  const r = new Request('http://x/', { method: 'POST', body: fd })
  const body = Buffer.from(await r.arrayBuffer())
  const req = new PassThrough()
  req.headers = {
    'content-type': r.headers.get('content-type'),
    'content-length': String(body.length),
    'cf-connecting-ip': ip,
    ...headers,
  }
  req.query = {}
  req.body = {}
  req.end(body)
  return req
}

let realFetch
beforeEach(() => {
  realFetch = global.fetch
  global.fetch = vi.fn(async () => ({ json: async () => ({ success: true }) }))
})
afterEach(() => { global.fetch = realFetch })

// ── shared upload guards ──────────────────────────────────────────────────────

describe('public-upload guards', () => {
  it('sniffs by bytes: accepts WebP/GIF on top of sniffType, refuses HTML', () => {
    expect(sniffUpload(png)).toBe('image/png')
    expect(sniffUpload(pdf)).toBe('application/pdf')
    expect(sniffUpload(webp)).toBe('image/webp')
    expect(sniffUpload(gif)).toBe('image/gif')
    expect(sniffUpload(html)).toBeNull()
    // A BOM / whitespace before %PDF- is still a PDF; markup before it is not.
    expect(sniffUpload(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('\r\n'), pdf]))).toBe('application/pdf')
    expect(sniffUpload(Buffer.concat([Buffer.from('<html><script>x</script>'), pdf]))).toBeNull()
    expect(sniffUpload(Buffer.from('GIF8'))).toBeNull()
  })

  it('keys IPv6 on the /64, so rotating the interface id buys no fresh bucket (F-09)', () => {
    expect(ipBucket('2001:db8:1:2:aaaa::1')).toBe(ipBucket('2001:db8:1:2:bbbb:cccc:dddd:eeee'))
    expect(ipBucket('2001:db8:1:2::1')).not.toBe(ipBucket('2001:db8:1:3::1'))
    expect(ipBucket('203.0.113.9')).toBe('203.0.113.9')
    // IPv4-mapped addresses key on the IPv4, never on a shared all-zero /64.
    expect(ipBucket('::ffff:203.0.113.9')).toBe('203.0.113.9')
    expect(ipBucket('::ffff:203.0.113.9')).not.toBe(ipBucket('::ffff:198.51.100.1'))
  })

  it('limiter counts requests or bytes per bucket', () => {
    const l = createLimiter(10, 60_000)
    const req = { headers: { 'cf-connecting-ip': '2001:db8::1' } }
    const other = { headers: { 'cf-connecting-ip': '2001:db8::ffff' } } // same /64
    expect(l.take(req, 6)).toBe(true)
    expect(l.take(other, 5)).toBe(false)
    expect(l.take(other, 4)).toBe(true)
    expect(l.take(req, 11)).toBe(false)
  })

  it('forces the stored extension to the sniffed type and strips path characters', () => {
    expect(safeFilename('../../evil.html', 'image/png')).toBe('....evil.png')
    expect(safeFilename('', 'application/pdf', 'doc')).toBe('doc.pdf')
    expect(safeFilename('scan.JPG', 'image/jpeg')).toBe('scan.jpg')
  })

  it('parseMultipart refuses an oversized file with 413', async () => {
    const req = await multipartReq([['file', Buffer.alloc(2048, 1), 'a.bin']])
    await expect(parseMultipart(req, { fileFields: ['file'], maxFileBytes: 1024 }))
      .rejects.toMatchObject({ status: 413 })
  })

  it('parseMultipart ignores file parts under unexpected field names', async () => {
    const req = await multipartReq([['other', png, 'a.png'], ['file', png, 'b.png'], ['x', 'y']])
    const out = await parseMultipart(req, { fileFields: ['file'], maxFiles: 2, maxFileBytes: 1024 })
    expect(out.files.map((f) => f.field)).toEqual(['file'])
    expect(out.fields.x).toBe('y')
  })

  it('readRawBody caps the body', async () => {
    const req = new PassThrough(); req.end(Buffer.alloc(100))
    await expect(readRawBody(req, 50)).rejects.toMatchObject({ status: 413 })
  })
})

// ── C2 / F-08: POST /kscw/public/feedback ─────────────────────────────────────

describe('POST /public/feedback (F-08, contract C2)', () => {
  function setup(tables = {}) {
    const router = makeRouter()
    const s = makeServices()
    const database = makeDb({ directus_files: { first: { total: 0 } }, directus_folders: { first: { id: FEEDBACK_FILES_FOLDER } }, ...tables })
    registerPublicFeedback(router, { database, logger: noopLogger, services: s.services, getSchema: async () => ({}) })
    return { handler: router.routes['POST /public/feedback'], ...s }
  }

  // Exactly what kscw-website public/js/feedback-form.js puts in its FormData.
  const websiteParts = (extra = []) => [
    ['type', 'bug'], ['title', 'Broken link'], ['description', 'The footer link 404s'],
    ['source', 'website'], ['status', 'new'], ['source_url', 'https://kscw.ch/club'],
    ['name', 'Anna'], ['email', 'anna@example.ch'], ...extra,
  ]

  it('stores the website form fields and the screenshot in the PRIVATE feedback folder', async () => {
    const { handler, uploads, created } = setup()
    const req = await multipartReq(websiteParts([['screenshot', png, 'shot.png']]), {
      headers: { 'x-turnstile-token': 'tok' }, ip: '198.51.100.1',
    })
    const res = makeRes()
    await handler(req, res)
    expect(res.body).toEqual({ ok: true })
    expect(uploads).toHaveLength(1)
    expect(uploads[0].data.folder).toBe(FEEDBACK_FILES_FOLDER)
    expect(uploads[0].data.type).toBe('image/png')
    const row = created[0].row
    expect(created[0].collection).toBe('feedback')
    expect(row).toMatchObject({
      type: 'bug', title: 'Broken link', description: 'The footer link 404s',
      source: 'website', status: 'new', source_url: 'https://kscw.ch/club',
      name: 'Anna', email: 'anna@example.ch', screenshot: 'file-1', screenshots: ['file-1'],
    })
    expect(row.user).toBeUndefined()
    // Events are emitted (Flows on feedback.items.create keep firing); the create is
    // sudo (no accountability), which is what makes the kscw-hooks Turnstile filter
    // skip it instead of re-verifying the spent token.
    expect(created[0].opts?.emitEvents).not.toBe(false)
    expect(created[0].accountability ?? null).toBeNull()
  })

  it('fails CLOSED when Turnstile fails, storing nothing', async () => {
    global.fetch = vi.fn(async () => ({ json: async () => ({ success: false }) }))
    const { handler, uploads, created } = setup()
    const req = await multipartReq(websiteParts([['screenshot', png, 'shot.png']]), {
      headers: { 'x-turnstile-token': 'bad' }, ip: '198.51.100.2',
    })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(400)
    expect(uploads).toHaveLength(0)
    expect(created).toHaveLength(0)
  })

  it('refuses a screenshot whose bytes are not an image (415), storing nothing', async () => {
    const { handler, uploads, created } = setup()
    const req = await multipartReq(websiteParts([['screenshot', html, 'shot.png']]), {
      headers: { 'x-turnstile-token': 'tok' }, ip: '198.51.100.3',
    })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(415)
    expect(uploads).toHaveLength(0)
    expect(created).toHaveLength(0)
  })

  it('never takes status/source/user from the client', () => {
    const { row } = buildFeedbackRow({
      title: 't', description: 'd', status: 'done', source: 'wiedisync', user: 5,
      type: 'evil', source_url: 'javascript:alert(1)', email: 'x\r\nbcc: y@z.ch',
    })
    expect(row).toMatchObject({ status: 'new', source: 'website', type: 'feedback', source_url: null, email: null })
    expect(row.user).toBeUndefined()
    expect(buildFeedbackRow({ title: 't' }).error).toBeTruthy()
  })

  it('deletes stored screenshots when the row cannot be created', async () => {
    const { handler, deleted, services } = setup()
    services.ItemsService.prototype.createOne = async () => { throw new Error('db down') }
    const req = await multipartReq(websiteParts([['screenshot', png, 'shot.png']]), {
      headers: { 'x-turnstile-token': 'tok' }, ip: '198.51.100.4',
    })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(500)
    expect(deleted).toEqual(['file-1'])
  })
})

// ── F-09: registration upload tickets ─────────────────────────────────────────

describe('registration upload ticket (F-09)', () => {
  const SECRET = 'reg-test-secret'

  it('a minted ticket authorizes a bounded number of uploads', () => {
    const uses = new Map()
    const t = mintUploadTicket(Date.now(), SECRET)
    for (let i = 0; i < UPLOAD_TICKET_MAX_USES; i++) {
      expect(checkUploadTicket(t, uses, Date.now(), SECRET)).toMatchObject({ p: 'reg-upload' })
    }
    expect(checkUploadTicket(t, uses, Date.now(), SECRET)).toBe('exhausted')
  })

  it('refuses forged, expired, and other-purpose tickets', () => {
    const uses = new Map()
    const t = mintUploadTicket(Date.now(), SECRET)
    expect(checkUploadTicket(t, uses, Date.now(), 'other-secret')).toBeNull()
    expect(checkUploadTicket(t, uses, Date.now() + 3 * 60 * 60 * 1000, SECRET)).toBeNull()
    // A scorer-exam ticket is signed with the same key but is not an upload ticket.
    const scorer = signTicket({ k: 'x:1', s: 'x', i: '1', exp: Date.now() + 60_000 }, SECRET)
    expect(checkUploadTicket(scorer, uses, Date.now(), SECRET)).toBeNull()
    expect(checkUploadTicket('', uses)).toBeNull()
  })
})

describe('POST /registration/upload stores the sniffed type (F-09)', () => {
  function setup() {
    const router = makeRouter()
    const s = makeServices()
    const deletedOne = []
    s.services.FilesService.prototype.deleteOne = async function (id) { deletedOne.push(id) }
    const database = makeDb({ directus_files: { first: { total: 0 } } })
    registerRegistration(router, { database, logger: noopLogger, services: s.services, getSchema: async () => ({}) })
    return { handler: router.routes['POST /registration/upload'], database, deletedOne, ...s }
  }
  function rawReq(buf, { type = 'application/pdf', filename = 'scan.pdf', ip = '198.51.100.7' } = {}) {
    const req = new PassThrough()
    req.headers = { 'content-type': type, 'content-length': String(buf.length), 'cf-connecting-ip': ip }
    req.query = { filename }
    req.end(buf)
    return req
  }

  it('ignores the declared Content-Type and corrects the row to the sniffed type', async () => {
    const { handler, database, uploads } = setup()
    const res = makeRes()
    await handler(rawReq(pdf, { type: 'image/png', filename: 'id.png' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ id: 'file-1' })
    expect(uploads[0].data.folder).toBe(REGISTRATION_FILES_FOLDER)
    expect(uploads[0].bytes.equals(pdf)).toBe(true)
    const upd = database.calls.find(([t, m]) => t === 'directus_files' && m === 'update')
    expect(upd[2][0]).toEqual({ type: 'application/pdf', filename_download: 'id.pdf' })
  })

  it('refuses bytes that are not an allowed type — the stream fails, nothing is kept', async () => {
    const { handler, uploads } = setup()
    const res = makeRes()
    await handler(rawReq(html, { type: 'application/pdf', ip: '198.51.100.8' }), res)
    expect(res.statusCode).toBe(400)
    expect(uploads).toEqual([])
  })

  it('purges the row when a store resolves despite the type failure', async () => {
    const { handler, deletedOne, services } = setup()
    // A store that stops reading on 'error' and resolves anyway (same shape as the
    // F16 truncated-body test in upload-stream-errors.test.js).
    services.FilesService.prototype.uploadOne = async function (stream) {
      await new Promise((r) => { stream.once('error', r); stream.resume() })
      return 'file-lenient'
    }
    const res = makeRes()
    await handler(rawReq(html, { ip: '198.51.100.9' }), res)
    expect(res.statusCode).toBe(400)
    expect(deletedOne).toEqual(['file-lenient'])
  })
})

// ── F-33: registration names in the applicant mail ────────────────────────────

describe('registration free text (F-33)', () => {
  it('refuses names that carry links or markup', () => {
    expect(registrationNameOk('Anna-Lena')).toBe(true)
    expect(registrationNameOk("D'Angelo Müller")).toBe(true)
    for (const bad of ['Win at https://evil.example', 'www.evil.ch', 'a<b>c', 'x@y.ch', 'go evil.com/login', 'a\r\nBcc: x', 'A'.repeat(81), '']) {
      expect(registrationNameOk(bad)).toBe(false)
    }
    expect(registrationNameOk({ toString: () => 'x' })).toBe(false)
  })

  it('capText trims, caps and drops non-strings', () => {
    expect(capText('  hi  ', 10)).toBe('hi')
    expect(capText('x'.repeat(50), 10)).toHaveLength(10)
    expect(capText({ a: 1 }, 10)).toBeNull()
    expect(capText('', 10)).toBeNull()
  })
})

// ── F-32: fee category checked at submit, same rule as at approval ────────────

describe('registration fee category (F-32, submit side)', () => {
  // Every <option value> the website signup form offers (anmeldung.astro), per sport.
  const WEBSITE_OPTIONS = {
    volleyball: ['VB Turnier KWI', 'VB Schüler*in Turnier', 'VB Schüler*in Meisterschaft',
      'VB Student*in Meisterschaft', 'VB Erwerbstätige', 'Gratis'],
    basketball: ['BB Erwerbstätige 1. Liga', 'BB Lernende/Studierende 1. Liga', 'BB Erwerbstätige',
      'BB Lernende/Studierende', 'BB Jugend Meisterschaft', 'BB Minis Turnier', 'Gratis'],
    passive: ['Passivmitglied', 'Gratis'],
  }

  it('accepts every category the website form offers for its sport', () => {
    for (const [type, opts] of Object.entries(WEBSITE_OPTIONS)) {
      for (const o of opts) {
        expect(feeCategoryRejected(o, type), `${type}: ${o}`).toBe(false)
        expect(approvedFeeCategory(o, type)).toBe(o)
      }
    }
  })

  it('refuses another sport\'s category, the non-member bucket, free text and non-strings', () => {
    expect(feeCategoryRejected('BB Erwerbstätige', 'volleyball')).toBe(true)
    expect(feeCategoryRejected('VB Erwerbstätige', 'basketball')).toBe(true)
    expect(feeCategoryRejected('VB Erwerbstätige', 'passive')).toBe(true)
    expect(feeCategoryRejected('Kein Beitrag', 'volleyball')).toBe(true)
    expect(feeCategoryRejected('Kein Beitrag', 'passive')).toBe(true)
    expect(feeCategoryRejected('VB Gratis-Deluxe', 'volleyball')).toBe(true)
    expect(feeCategoryRejected('toString', 'volleyball')).toBe(true)
    expect(feeCategoryRejected(['VB Erwerbstätige'], 'volleyball')).toBe(true)
    expect(feeCategoryRejected({ toString: () => 'Gratis' }, 'volleyball')).toBe(true)
    expect(feeCategoryRejected(0, 'volleyball')).toBe(true)
  })

  it('lets an empty/missing category through (stored as null, set in review)', () => {
    expect(feeCategoryRejected(undefined, 'volleyball')).toBe(false)
    expect(feeCategoryRejected(null, 'basketball')).toBe(false)
    expect(feeCategoryRejected('   ', 'passive')).toBe(false)
    expect(approvedFeeCategory('   ', 'passive')).toBeNull()
  })

  it('the approval hook uses the very same rule (one implementation)', () => {
    expect(hooksApprovedFeeCategory).toBe(approvedFeeCategory)
  })
})

// ── F-14: graded exams are closed ─────────────────────────────────────────────

describe('scorer exam grading lock (F-14)', () => {
  it('isGraded is true for a recorded verdict only', () => {
    expect(isGraded({ exam_result: 'passed' })).toBe(true)
    expect(isGraded({ exam_result: 'failed' })).toBe(true)
    expect(isGraded({ exam_result: null })).toBe(false)
    expect(isGraded({ exam_result: '' })).toBe(false)
    expect(isGraded(null)).toBe(false)
  })
})

describe('scorer exam upload refuses a graded exam (F-14, emailed-ticket flow)', () => {
  function setup(attendance) {
    const router = makeRouter()
    const database = makeDb({
      scorer_courses: { result: [{ id: 1, date_iso: '2026-10-01', form_slug_de: 'kurs-de', form_slug_en: null }] },
      scorer_course_attendance: { first: attendance },
    })
    registerScorerExam(router, { database, logger: noopLogger, services: makeServices().services, getSchema: async () => ({}) })
    const ticket = signTicket({ k: 'kurs-de:7', s: 'kurs-de', i: '7', exp: Date.now() + 60_000 }, 'test-ticket-secret')
    return { router, ticket }
  }

  it('/upload answers 409 already_graded before reading any bytes', async () => {
    const { router, ticket } = setup({ id: 3, exam_file: 'f', sv_license: '123456', exam_result: 'passed' })
    const req = new PassThrough()
    req.headers = { 'content-length': String(pdf.length), 'cf-connecting-ip': '192.0.2.44' }
    req.query = { ticket, licence: '123456' }
    const res = makeRes()
    await router.routes['POST /scorer-exam/upload'](req, res)
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'already_graded' })
  })

  it('/ticket tells the page up front', async () => {
    const graded = setup({ exam_date: '2026-10-02', exam_file: 'f', sv_license: '', exam_result: 'failed' })
    const res = makeRes()
    await graded.router.routes['POST /scorer-exam/ticket']({ headers: { 'cf-connecting-ip': '192.0.2.45' }, body: { ticket: graded.ticket } }, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.data.graded).toBe(true)
    const open = setup({ exam_date: null, exam_file: null, sv_license: '', exam_result: null })
    const res2 = makeRes()
    await open.router.routes['POST /scorer-exam/ticket']({ headers: { 'cf-connecting-ip': '192.0.2.46' }, body: { ticket: open.ticket } }, res2)
    expect(res2.body.data.graded).toBe(false)
  })
})

// ── F-06 / F-36: public team payload ──────────────────────────────────────────

describe('public team payload (F-06, F-36)', () => {
  it('officials get the same name-privacy transform as the roster', () => {
    expect(publicMemberName({ first_name: 'Anna', last_name: 'Muster', website_name_private: true })).toBe('Anna M.')
    expect(publicMemberName({ first_name: 'Anna', last_name: 'Muster', website_name_private: false })).toBe('Anna Muster')
    expect(publicMemberName(null)).toBeNull()
  })

  it('the team row is an allow-list: internal columns never leave', () => {
    const team = {
      id: 1, name: 'H1', captain: 42, clubdesk_group: 'x', duty_credit: 3, features_enabled: {},
      dashboard_range_from: '2026-01-01', bb_source_id: 'b', gender: 'm', some_future_column: 's',
      show_guests_on_website: false, open_for_players: true,
    }
    const out = pickPublicTeam(team)
    expect(out).toEqual({ id: 1, name: 'H1', show_guests_on_website: false, open_for_players: true })
    for (const k of ['captain', 'clubdesk_group', 'duty_credit', 'features_enabled', 'bb_source_id', 'some_future_column']) {
      expect(PUBLIC_TEAM_DETAIL_FIELDS).not.toContain(k)
    }
  })
})


describe('GET /public/team/:id end to end (F-06, F-34, F-35, F-36)', () => {
  function route(tables) {
    const routes = {}
    const R = new Proxy({ routes }, {
      get(t, prop) {
        if (prop in t) return t[prop]
        return (path, ...h) => { if (typeof path === 'string') routes[`${String(prop).toUpperCase()} ${path}`] = h.at(-1) }
      },
    })
    const database = makeDb(tables)
    endpoints.handler(R, { services: {}, database, logger: noopLogger, getSchema: async () => ({}), env: {} })
    return { handler: routes['GET /public/team/:id'], database }
  }

  it('answers 400 for a non-integer id without touching the database (F-34)', async () => {
    const { handler, database } = route({})
    const res = makeRes()
    await handler({ params: { id: 'abc' + 'x'.repeat(5000) }, query: {}, headers: {} }, res)
    expect(res.statusCode).toBe(400)
    expect(database.calls).toHaveLength(0)
  })

  it('drops hidden guests, private-names officials, and allow-lists team + training columns', async () => {
    const adult = '1990-01-01'
    const { handler } = route({
      teams: {
        first: {
          id: 1, name: 'H1', active: true, league: null, season: null, team_id: null,
          open_for_players: false, show_guests_on_website: false, captain: 5, clubdesk_group: 'Intern',
        },
        result: [],
      },
      member_teams: {
        result: [
          { id: 10, first_name: 'Pia', last_name: 'Player', birthdate: adult, guest_level: 0, website_visible: true },
          { id: 11, first_name: 'Gus', last_name: 'Guest', birthdate: adult, guest_level: 1, website_visible: true },
        ],
      },
      teams_coaches: { result: [] },
      games: { result: [{ id: 9, scorer_member: 3, status: 'completed', notes: 'x' }] },
      trainings: {
        result: [{
          id: 4, date: '2026-10-01', start_time: '18:00:00', end_time: '20:00:00', hall: null,
          hall_name: 'Halle A', notes: 'Trial with Max Mustermann', cancel_reason: 'r', cancelled: false,
          is_trial: false, respond_by: null, excluded_guest_levels: [],
        }],
      },
      sponsors: { result: [] },
      members: { result: [{ id: 3, first_name: 'Anna', last_name: 'Muster', birthdate: adult, website_name_private: true }] },
    })
    const res = makeRes()
    await handler({ params: { id: '1' }, query: {}, headers: {} }, res)
    expect(res.statusCode).toBe(200)
    const d = res.body.data
    // F-35
    expect(d.roster.map((m) => m.id)).toEqual([10])
    // F-06
    expect(d.results[0].scorer_name).toBe('Anna M.')
    // F-36 — team columns
    expect(d.captain).toBeUndefined()
    expect(d.clubdesk_group).toBeUndefined()
    expect(d.show_guests_on_website).toBe(false)
    // F-36 — training columns: no coach notes on a regular training
    expect(d.upcoming_trainings[0]).toMatchObject({ id: 4, hall_name: 'Halle A', start_time: '18:00:00' })
    expect(d.upcoming_trainings[0].notes).toBeUndefined()
    expect(d.upcoming_trainings[0].cancel_reason).toBeUndefined()
    expect(d.upcoming_trainings[0].excluded_guest_levels).toBeUndefined()
  })
})

// ── F-34: bounded request context in the error log ────────────────────────────

describe('error-log request caps (F-34)', () => {
  it('capLogged passes small objects and truncates padded ones', () => {
    expect(capLogged({ a: 1 }, 100)).toEqual({ a: 1 })
    const out = capLogged({ q: 'x'.repeat(10_000) }, 500)
    expect(out._truncated).toBe(true)
    expect(out.preview.length).toBe(500)
  })
})

// ── F-60: OpnForm count negative cache ────────────────────────────────────────

describe('OpnForm count negative cache (F-60)', () => {
  const realPat = process.env.OPNFORM_PAT
  beforeEach(() => { process.env.OPNFORM_PAT = 'pat'; _resetCountCache() })
  afterEach(() => { if (realPat === undefined) delete process.env.OPNFORM_PAT; else process.env.OPNFORM_PAT = realPat })

  it('an unknown slug reaches OpnForm once, then is answered from cache', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404, text: async () => '' }))
    await expect(getCount('no-such-form')).rejects.toMatchObject({ status: 404 })
    await expect(getCount('no-such-form')).rejects.toMatchObject({ status: 404 })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})

// ── F-59: newsletter subscribe is not an oracle ───────────────────────────────

describe('newsletter subscribe (F-59)', () => {
  async function subscribe(existing) {
    const router = makeRouter()
    const sent = []
    class MailService { async send(m) { sent.push(m) } }
    const database = makeDb({ newsletter_subscribers: { first: existing } })
    registerNewsletter(router, { database, logger: noopLogger, services: { MailService }, getSchema: async () => ({}) })
    const res = makeRes()
    await router.routes['POST /newsletter/subscribe']({
      body: { email: `x${Math.random()}@example.ch`, turnstile_token: 't' },
      headers: { 'cf-connecting-ip': `192.0.2.${Math.floor(Math.random() * 250)}` },
    }, res)
    return { res, sent }
  }

  it('answers a verified subscriber exactly like a new one', async () => {
    const verified = await subscribe({ verified: true, verify_token: 'v' })
    const fresh = await subscribe(undefined)
    expect(verified.res.body).toEqual({ success: true })
    expect(fresh.res.body).toEqual({ success: true })
    expect(verified.sent).toHaveLength(0)
    expect(fresh.sent).toHaveLength(1)
  })
})

// ── F-37: password-request answers before it looks anything up ────────────────

describe('password-request (F-37)', () => {
  it('responds 204 before the account lookup and keeps earlier links alive', async () => {
    const router = makeRouter()
    const order = []
    const res = makeRes()
    const origEnd = res.end.bind(res)
    res.end = () => { order.push('respond'); return origEnd() }
    const database = makeDb({
      directus_users: { first: () => { order.push('lookup'); return { id: 'u1', email: 'a@example.ch' } } },
      members: { first: { language: 'english' } },
      password_reset_tokens: { result: [] },
    })
    class MailService { async send() { order.push('mail') } }
    registerPasswordReset(router, { database, logger: noopLogger, services: { MailService }, getSchema: async () => ({}) })
    await router.routes['POST /password-request']({ body: { email: 'A@example.ch' }, headers: { 'cf-connecting-ip': '192.0.2.77' } }, res)
    expect(res.statusCode).toBe(204)
    expect(order[0]).toBe('respond')
    expect(order).toContain('mail')
    // Only EXPIRED tokens are deleted up front — a third party's request no longer
    // cancels the owner's pending link.
    const deletes = database.calls.filter(([t, m]) => t === 'password_reset_tokens' && m === 'delete')
    const wheres = database.calls.filter(([t, m, a]) => t === 'password_reset_tokens' && m === 'where' && a[0] === 'expires_at')
    expect(deletes.length).toBeGreaterThan(0)
    expect(wheres.length).toBeGreaterThan(0)
  })
})

// ── F-13: bugfix triage shows provenance and ranks by non-anonymous occurrences ─

describe('bugfixes/issues provenance (F-13)', () => {
  it('reports anonymous vs eligible counts and ranks padded anonymous issues last', async () => {
    const dir = process.env.ERROR_LOG_DIR
    mkdirSync(dir, { recursive: true })
    const date = new Date().toISOString().slice(0, 10)
    const lines = []
    for (let i = 0; i < 50; i++) lines.push({ ts: `2026-09-28T10:00:${String(i).padStart(2, '0')}.000Z`, source: 'frontend', event: 'client_error', error: 'anon spam' })
    lines.push({ ts: '2026-09-28T11:00:00.000Z', event: 'api_error', error: 'real backend bug' })
    writeFileSync(`${dir}/errors-${date}.jsonl`, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')

    const router = makeRouter()
    const database = makeDb({
      directus_users: { first: { role_name: 'Superuser' } },
      bugfix_jobs: { result: [] },
      error_annotations: { result: [] },
    })
    registerBugfixes(router, { database, logger: noopLogger })
    const res = makeRes()
    await router.routes['GET /bugfixes/issues']({ accountability: { user: 'u' }, query: {}, headers: {} }, res)
    rmSync(dir, { recursive: true, force: true })
    // Each anonymous line hashes separately (ts is in the hash), so compare by kind.
    const top = res.body.data[0]
    expect(top.error).toBe('real backend bug')
    expect(top).toMatchObject({ source: 'server', ai_fix_eligible: true, eligible_count: 1, anonymous_count: 0 })
    const anon = res.body.data.find((i) => i.error === 'anon spam')
    expect(anon).toMatchObject({ source: 'frontend', ai_fix_eligible: false, eligible_count: 0 })
  })
})

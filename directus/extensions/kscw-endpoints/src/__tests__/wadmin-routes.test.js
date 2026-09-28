/**
 * Route-level tests for wadmin.js (audit 2026-09-28, F-45).
 *
 * The pure-function tests in wadmin.test.js pinned the helpers but never the WIRING:
 * whether a route actually calls assertScalarBody, guardScorer's slug binding, the
 * folder checks on file ids, or the field deny-list. Two of the 2026-09-28 findings
 * (F-04, F-05) were exactly "the helper exists, the route does not use it for this".
 * These tests drive the registered handlers against an in-memory database, so a
 * route that stops enforcing one of these fails here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../opnform.js', async (orig) => ({
  ...(await orig()),
  listSubmissions: vi.fn(),
  deleteSubmission: vi.fn(async () => ({ ok: true })),
  createSubmission: vi.fn(),
  getCloses: vi.fn(),
  setCloses: vi.fn(),
}))
vi.mock('../storage-read.js', () => ({
  streamManagedFile: vi.fn(async (id, _deps, res, { filename, disposition }) => {
    res.setHeader('Content-Disposition', `${disposition === 'attachment' ? 'attachment' : 'inline'}; filename="${filename}"`)
    res.body = `bytes-of-${id}`
  }),
  readManagedFile: vi.fn(async (id) => ({ file: { id }, bytes: Buffer.from(`bytes-of-${id}`) })),
}))

import { registerWadmin, REGISTRATION_FILES_FOLDER } from '../wadmin.js'
import { listSubmissions, deleteSubmission, createSubmission, setCloses } from '../opnform.js'
import { streamManagedFile, readManagedFile } from '../storage-read.js'
import { SCORER_EXAM_FOLDER } from '../scorer-exam.js'
import { REGISTRATION_FILES_FOLDER as REGISTRATION_FOLDER_FROM_REGISTRATION } from '../registration.js'

// ── in-memory knex stand-in ──────────────────────────────────────────────────
// Supports exactly the query shapes wadmin.js uses. `where` groups are ANDed,
// `orWhere` ORs into the preceding group; "table.col" is matched on "col".
function makeDb(tables) {
  const col = (c) => String(c).split('.').pop()
  const project = (row, cols) => {
    if (!cols.length) return { ...row }
    const out = {}
    for (const c of cols.flat()) {
      const [src, alias] = String(c).split(/\s+as\s+/i)
      const key = alias || col(src)
      out[key] = row[key] ?? row[col(src)]
    }
    return out
  }
  const db = (name) => {
    const groups = []
    let cols = []
    let lim = Infinity
    const rows = () => (tables[name] ||= [])
    const match = (r) => groups.every((g) => g.some((pred) => pred(r)))
    const eq = (c, v) => (r) => r[col(c)] !== undefined && r[col(c)] !== null && String(r[col(c)]) === String(v)
    const q = {
      join() { return q }, leftJoin() { return q }, orderBy() { return q }, whereRaw() { return q },
      where(a, b) {
        if (a && typeof a === 'object') for (const [k, v] of Object.entries(a)) groups.push([eq(k, v)])
        else groups.push([eq(a, b)])
        return q
      },
      orWhere(a, b) { groups[groups.length - 1].push(eq(a, b)); return q },
      whereNot(a, b) { groups.push([(r) => String(r[col(a)]) !== String(b)]); return q },
      whereNotNull(a) { groups.push([(r) => r[col(a)] != null]); return q },
      whereIn(a, arr) { const s = new Set(arr.map(String)); groups.push([(r) => s.has(String(r[col(a)]))]); return q },
      select(...c) { cols = c; return q },
      limit(n) { lim = n; return q },
      async first(...c) { const r = rows().find(match); return r ? project(r, c.length ? c : cols) : undefined },
      async update(patch) { let n = 0; for (const r of rows()) if (match(r)) { Object.assign(r, patch); n++ } return n },
      async insert(row) { rows().push({ id: rows().length + 1, ...row }); return [rows().length] },
      async del() { const keep = rows().filter((r) => !match(r)); const n = rows().length - keep.length; tables[name] = keep; return n },
      then(ok, bad) { return Promise.resolve(rows().filter(match).slice(0, lim).map((r) => project(r, cols))).then(ok, bad) },
    }
    return q
  }
  db.fn = { now: () => new Date() }
  return db
}

function makeServices(tables, calls) {
  class ItemsService {
    constructor(collection, opts) { this.c = collection; this.opts = opts }
    async readByQuery(q) { calls.push(['readByQuery', this.c, q]); return tables[this.c] || [] }
    async readOne(id) { return (tables[this.c] || []).find((r) => String(r.id) === String(id)) }
    async createOne(body) { calls.push(['createOne', this.c, body]); (tables[this.c] ||= []).push({ id: 99, ...body }); return 99 }
    async updateOne(id, body) {
      calls.push(['updateOne', this.c, id, body])
      const r = (tables[this.c] || []).find((x) => String(x.id) === String(id)); if (r) Object.assign(r, body); return id
    }
    async deleteOne(id) {
      calls.push(['deleteOne', this.c, id])
      tables[this.c] = (tables[this.c] || []).filter((x) => String(x.id) !== String(id)); return id
    }
  }
  class FilesService {
    async deleteOne(id) {
      calls.push(['deleteFile', id])
      tables.directus_files = tables.directus_files.filter((f) => f.id !== id)
    }
  }
  class MailService { async send(m) { calls.push(['mail', m]) } }
  return { ItemsService, FilesService, MailService, AssetsService: class {} }
}

function makeRouter() {
  const routes = []
  const add = (method) => (paths, handler) => {
    for (const p of [].concat(paths)) routes.push({ method, p, handler })
  }
  const router = { get: add('get'), post: add('post'), patch: add('patch'), delete: add('delete'), put: add('put') }
  const find = (method, path) => {
    for (const r of routes) {
      if (r.method !== method) continue
      const names = []
      const re = new RegExp('^' + r.p.replace(/:([a-z_]+)/gi, (_, n) => { names.push(n); return '([^/]+)' }) + '$')
      const m = path.match(re)
      if (m) return { handler: r.handler, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) }
    }
    return null
  }
  return { router, find }
}

function makeRes() {
  const res = {
    statusCode: 200, body: undefined, headers: {}, headersSent: false,
    status(c) { res.statusCode = c; return res },
    json(b) { res.body = b; res.headersSent = true; return res },
    setHeader(k, v) { res.headers[k.toLowerCase()] = v },
  }
  return res
}

const U_SUPER = 'u-super'
const U_SCORER = 'u-scorer'
const U_REG = 'u-reg'
const U_MIX = 'u-mix'
const U_NEWS = 'u-news'

const FILE_EXAM = '11111111-1111-4111-8111-111111111111'
const FILE_EXAM_OLD = '22222222-2222-4222-8222-222222222222'
const FILE_PASSPORT = '33333333-3333-4333-8333-333333333333'
const FILE_REG = '44444444-4444-4444-8444-444444444444'
const FILE_PUBLIC = '55555555-5555-4555-8555-555555555555'

let tables, calls, app

function seed() {
  tables = {
    directus_users: [
      { id: U_SUPER, role_name: 'Superuser', first_name: 'Sue', last_name: 'Per' },
      { id: U_SCORER, role_name: 'Website Admin', first_name: 'Sco', last_name: 'Rer' },
      { id: U_REG, role_name: 'Website Admin' },
      { id: U_MIX, role_name: 'Website Admin' },
      { id: U_NEWS, role_name: 'Website Admin' },
    ],
    website_admin_access: [
      { user: U_SCORER, sections: ['scorer_courses'] },
      { user: U_REG, sections: ['registrations'] },
      { user: U_MIX, sections: ['mixed_turnier'] },
      { user: U_NEWS, sections: ['news'] },
    ],
    scorer_courses: [{ id: 1, form_slug_de: 'scorer-de', form_slug_en: 'scorer-en', date_iso: '2026-09-01', title_de: 'Kurs' }],
    scorer_course_attendance: [
      { id: 10, sub_key: 'scorer-de:7', form_slug: 'scorer-de', submission_id: '7', exam_file: FILE_EXAM, exam_file_corrected: null, exam_result: 'passed', field_overrides: null },
    ],
    directus_files: [
      { id: FILE_EXAM, folder: SCORER_EXAM_FOLDER, filename_download: 'matchblatt.pdf', type: 'application/pdf' },
      { id: FILE_EXAM_OLD, folder: SCORER_EXAM_FOLDER },
      { id: FILE_PASSPORT, folder: REGISTRATION_FILES_FOLDER },
      { id: FILE_REG, folder: REGISTRATION_FILES_FOLDER, filename_download: 'id-front.jpg', type: 'image/jpeg' },
      { id: FILE_PUBLIC, folder: null },
    ],
    registrations: [
      { id: 500, id_upload_front: FILE_REG, id_upload_back: FILE_PASSPORT, bb_doc_lizenz: null },
      { id: 501, id_upload_front: FILE_PUBLIC },
    ],
    events: [{ id: 5, title: 'Mixed' }],
    participations: [
      { id: 1, activity_type: 'event', activity_id: '5', member: 1, status: 'confirmed', note: 'Zuspiel > Mitte', date_created: '2026-05-01T10:00:00Z' },
      { id: 2, activity_type: 'event', activity_id: '5', member: 2, status: 'declined', note: null },
      { id: 3, activity_type: 'event', activity_id: '5', member: 3, status: 'tentative', position_1: 'Libero' },
      { id: 4, activity_type: 'event', activity_id: '6', member: 4, status: 'confirmed' },
    ],
    members: [
      { id: 1, first_name: 'Anna', last_name: 'A', sex: 'weiblich', email: 'anna@x.ch', ahv_nummer: '756.x' },
      { id: 2, first_name: 'Ben', last_name: 'B', sex: 'männlich' },
      { id: 3, first_name: 'Cara', last_name: 'C', sex: 'weiblich' },
      { id: 4, first_name: 'Dan', last_name: 'D', sex: 'männlich' },
    ],
    event_signups: [
      { id: 70, event: 5, name: 'Cara C', email: 'c@x.ch', sex: 'w', is_member: true, member: 3, form_data: { teams: ['H1'], position_1: 'Libero', notes: 'hi' }, date_created: '2026-05-02T00:00:00Z' },
      { id: 71, event: 9, name: 'Other', email: 'o@x.ch', member: null, form_data: {} },
    ],
  }
  calls = []
  const { router, find } = makeRouter()
  const log = { warn: () => {}, info: () => {}, error: () => {}, child() { return log } }
  registerWadmin(router, {
    logger: log,
    database: makeDb(tables),
    services: makeServices(tables, calls),
    getSchema: async () => ({}),
  })
  app = async (method, path, { user, body, query = {} } = {}) => {
    const [pathname, qs] = path.split('?')
    for (const [k, v] of new URLSearchParams(qs || '')) query[k] = v
    const hit = find(method, pathname)
    if (!hit) throw new Error(`no route ${method} ${pathname}`)
    const res = makeRes()
    await hit.handler({ params: hit.params, query, body, accountability: user ? { user } : null, on() {}, pipe() {} }, res)
    return res
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  seed()
})

describe('generic CRUD wiring', () => {
  it('refuses an unauthenticated caller and an ungranted section', async () => {
    expect((await app('get', '/wadmin/news/items/news')).statusCode).toBe(401)
    const r = await app('get', '/wadmin/registrations/items/registrations', { user: U_NEWS })
    expect(r.statusCode).toBe(403)
    expect(r.body.error).toBe('section_not_granted')
  })

  it('refuses a collection outside the section', async () => {
    const r = await app('get', '/wadmin/news/items/members', { user: U_NEWS })
    expect(r.statusCode).toBe(403)
    expect(r.body.error).toBe('resource_out_of_scope')
  })

  // F-10: the dead mapping is gone, and members/participations never came back.
  it('mixed_turnier reaches no collection through the generic CRUD', async () => {
    for (const c of ['mixed_tournament_signups', 'participations', 'members', 'event_signups']) {
      const r = await app('get', `/wadmin/mixed_turnier/items/${c}`, { user: U_SUPER })
      expect(r.statusCode, c).toBe(403)
    }
  })

  it('a section-scoped admin cannot write relationally (assertScalarBody is wired)', async () => {
    const r = await app('patch', '/wadmin/news/items/news/1', {
      user: U_NEWS, body: { title: 'x', author: { create: { email: 'a' } } },
    })
    expect(r.statusCode).toBe(400)
    expect(calls.find((c) => c[0] === 'updateOne')).toBeUndefined()
  })

  it('a section-scoped admin cannot read relationally (assertScalarQuery is wired)', async () => {
    const r = await app('get', '/wadmin/news/items/news', { user: U_NEWS, query: { fields: 'author.email' } })
    expect(r.statusCode).toBe(400)
  })
})

describe('F-04: exam file columns are not writable through the generic CRUD', () => {
  for (const field of ['exam_file', 'exam_file_corrected', 'exam_file_corrected_by', 'exam_file_corrected_on']) {
    it(`PATCH ${field} is refused — for a superuser too`, async () => {
      for (const user of [U_SCORER, U_SUPER]) {
        const r = await app('patch', '/wadmin/scorer_courses/items/scorer_course_attendance/10', {
          user, body: { [field]: field.endsWith('_by') ? 'Someone Else' : FILE_PASSPORT },
        })
        expect(r.statusCode, `${user} ${field}`).toBe(403)
        expect(r.body).toEqual({ error: 'field_not_writable', field })
      }
      expect(tables.scorer_course_attendance[0].exam_file).toBe(FILE_EXAM)
      expect(calls.find((c) => c[0] === 'updateOne')).toBeUndefined()
    })
  }

  // An array body skipped assertScalarBody (it returns arrays untouched) and every
  // hasOwnProperty check, and ItemsService would merge `[{exam_file}]` into the row.
  it('an array body cannot smuggle a denied field past the checks — superuser included', async () => {
    for (const user of [U_SCORER, U_SUPER]) {
      const p = await app('patch', '/wadmin/scorer_courses/items/scorer_course_attendance/10', {
        user, body: [{ exam_file_corrected: FILE_PASSPORT }],
      })
      expect(p.statusCode, user).toBe(400)
      expect(p.body).toEqual({ error: 'invalid_payload' })
      const c = await app('post', '/wadmin/scorer_courses/items/scorer_courses', {
        user, body: [{ form_slug_de: 'event-signup-form' }],
      })
      expect(c.statusCode, user).toBe(400)
    }
    expect(calls.find((c) => c[0] === 'updateOne' || c[0] === 'createOne')).toBeUndefined()
    expect(tables.scorer_course_attendance[0].exam_file_corrected ?? null).not.toBe(FILE_PASSPORT)
  })

  it('nulling exam_file (to then re-upload over the participant sheet) is refused', async () => {
    const r = await app('patch', '/wadmin/scorer_courses/items/scorer_course_attendance/10', {
      user: U_SCORER, body: { exam_file: null },
    })
    expect(r.statusCode).toBe(403)
  })

  it('POST with an exam file id is refused', async () => {
    const r = await app('post', '/wadmin/scorer_courses/items/scorer_course_attendance', {
      user: U_SCORER,
      body: { sub_key: 'scorer-de:8', form_slug: 'scorer-de', submission_id: '8', exam_file_corrected: FILE_PASSPORT },
    })
    expect(r.statusCode).toBe(403)
    expect(r.body.field).toBe('exam_file_corrected')
  })

  it('ordinary tracking fields still save', async () => {
    const r = await app('patch', '/wadmin/scorer_courses/items/scorer_course_attendance/10', {
      user: U_SCORER, body: { present: true, exam_result: 'failed', field_overrides: '{"a":"b"}' },
    })
    expect(r.statusCode).toBe(200)
    expect(tables.scorer_course_attendance[0].exam_result).toBe('failed')
  })

  it('an attendance row cannot be re-keyed onto another signup by a scorer admin', async () => {
    const r = await app('patch', '/wadmin/scorer_courses/items/scorer_course_attendance/10', {
      user: U_SCORER, body: { sub_key: 'scorer-de:8' },
    })
    expect(r.statusCode).toBe(403)
    expect(r.body.field).toBe('sub_key')
  })

  it('new attendance rows must be consistently keyed and on a scorer form', async () => {
    const bad = await app('post', '/wadmin/scorer_courses/items/scorer_course_attendance', {
      user: U_SCORER, body: { sub_key: 'scorer-de:9', form_slug: 'scorer-de', submission_id: '8' },
    })
    expect(bad.statusCode).toBe(400)
    expect(bad.body.error).toBe('invalid_attendance_key')
    const foreign = await app('post', '/wadmin/scorer_courses/items/scorer_course_attendance', {
      user: U_SCORER, body: { sub_key: 'event-form:8', form_slug: 'event-form', submission_id: '8' },
    })
    expect(foreign.statusCode).toBe(403)
    expect(foreign.body.error).toBe('form_out_of_scope')
    // The two shapes /admin actually creates: a tracked OpnForm signup and a manual one.
    for (const sub of ['8', 'manual-lx3k9a-ab12cd']) {
      const ok = await app('post', '/wadmin/scorer_courses/items/scorer_course_attendance', {
        user: U_SCORER, body: { sub_key: `scorer-de:${sub}`, form_slug: 'scorer-de', submission_id: sub, present: true },
      })
      expect(ok.statusCode, sub).toBe(200)
    }
  })
})

describe('F-05: scorer_courses form slugs are superuser-only', () => {
  it('a scorer-only admin cannot repoint a course at another form', async () => {
    const r = await app('patch', '/wadmin/scorer_courses/items/scorer_courses/1', {
      user: U_SCORER, body: { form_slug_en: 'event-signup-form' },
    })
    expect(r.statusCode).toBe(403)
    expect(r.body).toEqual({ error: 'field_not_writable', field: 'form_slug_en' })
    expect(tables.scorer_courses[0].form_slug_en).toBe('scorer-en')
    // …so guardScorer still refuses the foreign slug.
    const list = await app('get', '/wadmin/scorer_courses/opnform/forms/event-signup-form/submissions', { user: U_SCORER })
    expect(list.statusCode).toBe(403)
    expect(list.body.error).toBe('form_out_of_scope')
    expect(listSubmissions).not.toHaveBeenCalled()
  })

  it('nor create a course carrying a slug', async () => {
    const r = await app('post', '/wadmin/scorer_courses/items/scorer_courses', {
      user: U_SCORER, body: { title_de: 'Neu', form_slug_de: 'event-signup-form', form_slug_en: null },
    })
    expect(r.statusCode).toBe(403)
    expect(r.body.field).toBe('form_slug_de')
  })

  it('the course edit form, which sends the slugs back unchanged, still saves', async () => {
    const r = await app('patch', '/wadmin/scorer_courses/items/scorer_courses/1', {
      user: U_SCORER, body: { title_de: 'Kurs 2', form_slug_de: 'scorer-de', form_slug_en: 'scorer-en' },
    })
    expect(r.statusCode).toBe(200)
    expect(tables.scorer_courses[0].title_de).toBe('Kurs 2')
    // A course without slugs can be created by a scorer admin (a superuser links it).
    const c = await app('post', '/wadmin/scorer_courses/items/scorer_courses', {
      user: U_SCORER, body: { title_de: 'Neu', form_slug_de: null, form_slug_en: '' },
    })
    expect(c.statusCode).toBe(200)
  })

  it('a superuser may set them', async () => {
    const r = await app('patch', '/wadmin/scorer_courses/items/scorer_courses/1', {
      user: U_SUPER, body: { form_slug_en: 'scorer-en-2' },
    })
    expect(r.statusCode).toBe(200)
  })
})

describe('guardScorer', () => {
  it('needs the scorer grant and a valid slug', async () => {
    expect((await app('get', '/wadmin/scorer_courses/opnform/forms/scorer-de/submissions', { user: U_NEWS })).statusCode).toBe(403)
    expect((await app('get', '/wadmin/scorer_courses/opnform/forms/bad%20slug/submissions', { user: U_SCORER })).statusCode).toBe(400)
  })
  it('passes a configured slug, and a superuser for any slug', async () => {
    listSubmissions.mockResolvedValue({ fields: [], data: [], last_page: 1 })
    expect((await app('get', '/wadmin/scorer_courses/opnform/forms/scorer-de/submissions', { user: U_SCORER })).statusCode).toBe(200)
    expect((await app('get', '/wadmin/scorer_courses/opnform/forms/anything/submissions', { user: U_SUPER })).statusCode).toBe(200)
  })
})

describe('scoresheet asset route folder check', () => {
  it('streams a referenced sheet in the exam folder', async () => {
    const r = await app('get', `/wadmin/scorer_courses/assets/${FILE_EXAM}`, { user: U_SCORER })
    expect(streamManagedFile).toHaveBeenCalledOnce()
    expect(r.body).toBe(`bytes-of-${FILE_EXAM}`)
  })
  it('refuses a referenced id that is not in the exam folder', async () => {
    // A row written before the deny-list could still carry any id.
    tables.scorer_course_attendance[0].exam_file_corrected = FILE_PASSPORT
    const r = await app('get', `/wadmin/scorer_courses/assets/${FILE_PASSPORT}`, { user: U_SCORER })
    expect(r.statusCode).toBe(404)
    expect(streamManagedFile).not.toHaveBeenCalled()
  })
  it('refuses an unreferenced id', async () => {
    const r = await app('get', `/wadmin/scorer_courses/assets/${FILE_EXAM_OLD}`, { user: U_SCORER })
    expect(r.statusCode).toBe(404)
  })
})

describe('exam-result-email', () => {
  const fields = [{ id: 'f-mail', name: 'E-Mail', type: 'email' }, { id: 'f-first', name: 'Vorname' }]
  beforeEach(() => {
    listSubmissions.mockImplementation(async (_slug, { page }) => ({
      fields,
      data: page === 2 ? [{ id: 7, data: { 'f-mail': 'typo@x.ch', 'f-first': 'Pia' } }] : [{ id: 1, data: { 'f-mail': 'one@x.ch' } }],
      last_page: 2,
    }))
  })
  const send = (body, id = '7') =>
    app('post', `/wadmin/scorer_courses/opnform/forms/scorer-de/submissions/${id}/exam-result-email`, { user: U_SCORER, body })

  // F-18
  it('refuses when the stored result is not the one being mailed', async () => {
    const r = await send({ result: 'failed' })
    expect(r.statusCode).toBe(409)
    expect(r.body.error).toBe('result_not_saved')
    expect(calls.find((c) => c[0] === 'mail')).toBeUndefined()
  })

  // F-24: the submission sits on page 2.
  it('finds a submission beyond the first page and sends', async () => {
    const r = await send({ result: 'passed' })
    expect(r.statusCode).toBe(200)
    expect(r.body.to).toBe('typo@x.ch')
  })

  // F-17
  it('sends to the staff-corrected address', async () => {
    tables.scorer_course_attendance[0].field_overrides = JSON.stringify({ 'f-mail': 'fixed@x.ch' })
    const r = await send({ result: 'passed' })
    expect(r.body.to).toBe('fixed@x.ch')
    expect(calls.find((c) => c[0] === 'mail')[1].to).toBe('fixed@x.ch')
  })

  it('supports a hand-added (manual-…) signup from its overrides', async () => {
    tables.scorer_course_attendance.push({
      id: 11, sub_key: 'scorer-de:manual-abc-123', form_slug: 'scorer-de', submission_id: 'manual-abc-123',
      exam_result: 'failed', field_overrides: JSON.stringify({ 'f-mail': 'hand@x.ch', 'f-first': 'Hans' }),
    })
    const r = await send({ result: 'failed' }, 'manual-abc-123')
    expect(r.statusCode).toBe(200)
    expect(r.body.to).toBe('hand@x.ch')
  })

  // F-04
  it('never attaches a corrected-sheet id outside the exam folder', async () => {
    tables.scorer_course_attendance[0].exam_file_corrected = FILE_PASSPORT
    const r = await send({ result: 'passed' })
    expect(r.statusCode).toBe(200)
    expect(readManagedFile).not.toHaveBeenCalled()
    expect(calls.find((c) => c[0] === 'mail')[1].attachments).toBeUndefined()
  })

  it('attaches a real corrected sheet', async () => {
    tables.scorer_course_attendance[0].exam_file_corrected = FILE_EXAM_OLD
    await send({ result: 'passed' })
    expect(readManagedFile).toHaveBeenCalledWith(FILE_EXAM_OLD, expect.anything())
    expect(calls.find((c) => c[0] === 'mail')[1].attachments).toHaveLength(1)
  })
})

describe('F-22: deleting a signup purges its attendance row and exam sheets', () => {
  it('OpnForm delete also removes the row and its in-folder files', async () => {
    tables.scorer_course_attendance[0].exam_file_corrected = FILE_EXAM_OLD
    const r = await app('delete', '/wadmin/scorer_courses/opnform/forms/scorer-de/submissions/7', { user: U_SCORER })
    expect(r.statusCode).toBe(200)
    expect(deleteSubmission).toHaveBeenCalledWith('scorer-de', '7')
    expect(r.body).toMatchObject({ ok: true, attendance_deleted: true, files_deleted: 2 })
    expect(tables.scorer_course_attendance).toHaveLength(0)
    expect(tables.directus_files.map((f) => f.id)).not.toContain(FILE_EXAM)
  })

  it('never deletes a file outside the exam folder, even if a legacy row points at it', async () => {
    tables.scorer_course_attendance[0].exam_file_corrected = FILE_PASSPORT
    await app('delete', '/wadmin/scorer_courses/opnform/forms/scorer-de/submissions/7', { user: U_SCORER })
    expect(tables.directus_files.map((f) => f.id)).toContain(FILE_PASSPORT)
  })

  it('a refused upstream delete strands nothing', async () => {
    deleteSubmission.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 502 }))
    const r = await app('delete', '/wadmin/scorer_courses/opnform/forms/scorer-de/submissions/7', { user: U_SCORER })
    expect(r.statusCode).toBe(502)
    expect(tables.scorer_course_attendance).toHaveLength(1)
  })

  it('generic delete of a (manual) attendance row takes its sheets along', async () => {
    const r = await app('delete', '/wadmin/scorer_courses/items/scorer_course_attendance/10', { user: U_SCORER })
    expect(r.body).toMatchObject({ ok: true, files_deleted: 1 })
    expect(tables.directus_files.map((f) => f.id)).not.toContain(FILE_EXAM)
  })
})

describe('C3: /wadmin/mixed_turnier/participants', () => {
  it('needs the mixed_turnier grant', async () => {
    expect((await app('get', '/wadmin/mixed_turnier/participants', { user: U_NEWS })).statusCode).toBe(403)
  })
  it('returns only name/sex/positions for non-declined answers, deduped against website signups', async () => {
    const r = await app('get', '/wadmin/mixed_turnier/participants', { user: U_MIX })
    expect(r.statusCode).toBe(200)
    // member 2 declined; member 3 also filed the website form; member 4 is another event.
    expect(r.body.data).toEqual([
      { name: 'Anna A', sex: 'weiblich', positions: ['Zuspiel', 'Mitte'], status: 'confirmed', date: '2026-05-01', source: 'wiedisync' },
    ])
    expect(JSON.stringify(r.body)).not.toMatch(/anna@x|756/)
  })
  it('signups returns the event_signups rows for the event only', async () => {
    const r = await app('get', '/wadmin/mixed_turnier/signups', { user: U_MIX })
    expect(r.body.data.map((s) => s.id)).toEqual([70])
    expect(r.body.data[0]).toMatchObject({ teams: ['H1'], position_1: 'Libero', notes: 'hi', source: 'website' })
  })
})

describe('C4: /wadmin/registrations/files/:id', () => {
  it('needs the registrations grant', async () => {
    expect((await app('get', `/wadmin/registrations/files/${FILE_REG}`, { user: U_SCORER })).statusCode).toBe(403)
  })
  it('streams a referenced file in the registration folder, inline or as a download', async () => {
    const r = await app('get', `/wadmin/registrations/files/${FILE_REG}`, { user: U_REG })
    expect(r.body).toBe(`bytes-of-${FILE_REG}`)
    expect(r.headers['content-disposition']).toMatch(/^inline/)
    expect(r.headers['cache-control']).toBe('private, no-store')
    const d = await app('get', `/wadmin/registrations/files/${FILE_REG}?download=1`, { user: U_REG })
    expect(d.headers['content-disposition']).toMatch(/^attachment/)
  })
  it('refuses an unreferenced id, an out-of-folder id and a non-uuid', async () => {
    expect((await app('get', `/wadmin/registrations/files/${FILE_EXAM}`, { user: U_REG })).statusCode).toBe(404)
    expect((await app('get', `/wadmin/registrations/files/${FILE_PUBLIC}`, { user: U_REG })).statusCode).toBe(404)
    expect((await app('get', '/wadmin/registrations/files/nope', { user: U_REG })).statusCode).toBe(400)
    expect(streamManagedFile).not.toHaveBeenCalled()
  })
  it('DELETE removes the file and nulls the column', async () => {
    const r = await app('delete', `/wadmin/registrations/files/${FILE_REG}`, { user: U_REG })
    expect(r.statusCode).toBe(200)
    expect(r.body).toMatchObject({ ok: true, registration: 500, cleared: ['id_upload_front'] })
    expect(tables.registrations[0].id_upload_front).toBeNull()
    expect(tables.directus_files.map((f) => f.id)).not.toContain(FILE_REG)
  })
  it('DELETE refuses a file outside the registration folder', async () => {
    const r = await app('delete', `/wadmin/registrations/files/${FILE_PUBLIC}`, { user: U_REG })
    expect(r.statusCode).toBe(404)
    expect(tables.directus_files.map((f) => f.id)).toContain(FILE_PUBLIC)
  })
  it('REGISTRATION_FILES_FOLDER is registration.js\'s own constant', () => {
    expect(REGISTRATION_FILES_FOLDER).toBe(REGISTRATION_FOLDER_FROM_REGISTRATION)
    expect(REGISTRATION_FILES_FOLDER).toBe('a0000167-0000-4000-8000-000000000001')
  })
  it('asks the streaming helper for the disposition instead of patching res.setHeader', async () => {
    streamManagedFile.mockClear()
    await app('get', `/wadmin/registrations/files/${FILE_REG}?download=1`, { user: U_REG })
    expect(streamManagedFile.mock.calls[0][3]).toMatchObject({ disposition: 'attachment' })
    await app('get', `/wadmin/registrations/files/${FILE_REG}`, { user: U_REG })
    expect(streamManagedFile.mock.calls[1][3]).toMatchObject({ disposition: 'inline' })
  })
})

describe('F-66: fixed error codes, never internal text', () => {
  it('closes PATCH does not echo upstream text', async () => {
    setCloses.mockRejectedValueOnce(Object.assign(new Error('OpnForm 502 on /forms/scorer-de at /srv/app'), { status: 502 }))
    const r = await app('patch', '/wadmin/scorer_courses/opnform/forms/scorer-de/closes', { user: U_SCORER, body: { closes_at: null } })
    expect(r.body).toEqual({ error: 'Upstream error' })
    setCloses.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 422, detail: '{"secret":"internals"}' }))
    const r2 = await app('patch', '/wadmin/scorer_courses/opnform/forms/scorer-de/closes', { user: U_SCORER, body: { closes_at: null } })
    expect(JSON.stringify(r2.body)).not.toContain('internals')
  })
  it('admin-filed signup passes codes through, but not messages', async () => {
    createSubmission.mockRejectedValueOnce(Object.assign(new Error('unknown_field:abc-1'), { status: 400 }))
    const r = await app('post', '/wadmin/scorer_courses/opnform/forms/scorer-de/submissions', { user: U_SCORER, body: { data: { a: 1 } } })
    expect(r.body.error).toBe('unknown_field:abc-1')
    createSubmission.mockRejectedValueOnce(Object.assign(new Error('relation "x" does not exist'), { status: 400 }))
    const r2 = await app('post', '/wadmin/scorer_courses/opnform/forms/scorer-de/submissions', { user: U_SCORER, body: { data: { a: 1 } } })
    expect(r2.body.error).toBe('invalid_body')
  })
})

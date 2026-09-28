// 2026-09-28 audit F01/F25: form file answers live in the private Form uploads
// folder. GET /forms/:id/files/:fileId streams one to whoever manages the form,
// but only a file genuinely submitted as an answer to THAT form; the raw-knex
// submit paths (public form, expense receipt) file their uploads themselves.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../storage-read.js', () => ({
  streamManagedFile: vi.fn(async (_id, _deps, res) => { res.statusCode = 200; res.streamed = _id }),
}))

const { authorizeFormFile, canReadFormAnswers, registerForms } = await import('../forms.js')
const { fileUploads, answerFileIds, FORM_UPLOADS_FOLDER, UPLOAD_QUARANTINE_FOLDER, EXPENSE_RECEIPTS_FOLDER } = await import('../upload-folders.js')
const { streamManagedFile } = await import('../storage-read.js')

// ── Tiny in-memory knex: just the calls these modules make ──────────────────
function fakeDb(tables) {
  const db = (name) => {
    const preds = []
    let order = null
    const rows = () => {
      let r = (tables[name] || []).filter((row) => preds.every((p) => p(row)))
      if (order) r = [...r].sort((a, b) => (a[order] > b[order] ? 1 : -1))
      return r
    }
    const pick = (row, cols) => (cols.length ? Object.fromEntries(cols.map((c) => [c, row[c]])) : { ...row })
    const whereFn = (a, b) => {
      if (typeof a === 'function') {
        const ors = []
        const sub = {
          whereNull: (c) => { ors.push((row) => row[c] == null); return sub },
          orWhere: (c, v) => { ors.push((row) => row[c] === v); return sub },
          where: (c, v) => { ors.push((row) => row[c] === v); return sub },
        }
        a(sub)
        return (row) => ors.some((p) => p(row))
      }
      if (typeof a === 'object') return (row) => Object.entries(a).every(([k, v]) => row[k] === v)
      return (row) => String(row[a]) === String(b)
    }
    const chain = {
      where(a, b) { preds.push(whereFn(a, b)); return chain },
      whereIn(c, vals) { const s = vals.map(String); preds.push((row) => s.includes(String(row[c]))); return chain },
      whereNull(c) { preds.push((row) => row[c] == null); return chain },
      whereRaw(_sql, [pattern]) {
        const needle = pattern.replace(/%/g, '').toLowerCase()
        preds.push((row) => JSON.stringify(row.answers).toLowerCase().includes(needle))
        return chain
      },
      orderBy(c) { order = c; return chain },
      async first(...cols) { const r = rows()[0]; return r ? pick(r, cols) : undefined },
      async select(...cols) { return rows().map((r) => pick(r, cols)) },
      async update(patch) { const r = rows(); for (const row of r) Object.assign(row, patch); return r.length },
    }
    return chain
  }
  return db
}

const FILE = '11111111-2222-4333-8444-555555555555'
const OTHER = '99999999-2222-4333-8444-555555555555'
const fileField = [{ id: 'doc', type: 'file' }, { id: 'name', type: 'text' }]

function world(over = {}) {
  return {
    members: [
      { id: 1, user: 'u-coach', role: '["user"]' },
      { id: 2, user: 'u-player', role: '["user"]' },
      { id: 3, user: 'u-vorstand', role: '["user","vorstand"]' },
      { id: 4, user: 'u-bbadmin', role: '["user","bb_admin"]' },
      { id: 5, user: 'u-vbadmin', role: '["user","vb_admin"]' },
      { id: 6, user: 'u-creator', role: '["user"]' },
      { id: 7, user: 'u-oldcoach', role: '["user"]' },
    ],
    forms: [
      { id: 10, fields: fileField, created_by: 6, audience: 'teams' },
      { id: 20, fields: fileField, created_by: 1, audience: 'teams' },
    ],
    forms_teams: [{ forms_id: 10, teams_id: 100 }, { forms_id: 10, teams_id: 101 }, { forms_id: 20, teams_id: 100 }],
    teams: [{ id: 100, sport: 'volleyball', active: true }, { id: 101, sport: 'volleyball', active: false }],
    teams_coaches: [{ id: 1, teams_id: 100, members_id: 1 }, { id: 2, teams_id: 101, members_id: 7 }],
    teams_responsibles: [],
    form_submissions: [
      { id: 500, form: 10, member: 2, answers: { doc: { id: FILE, name: 'a.pdf' }, name: 'x' } },
    ],
    directus_files: [
      { id: FILE, folder: FORM_UPLOADS_FOLDER, uploaded_by: 'u-player', type: 'application/pdf', filename_download: 'a.pdf', filename_disk: 'x.pdf' },
      { id: OTHER, folder: 'reg-folder', uploaded_by: null, type: 'application/pdf', filename_download: 'id.pdf', filename_disk: 'y.pdf' },
    ],
    ...over,
  }
}

const as = (user, extra = {}) => ({ user, ...extra })

describe('canReadFormAnswers — mirrors form_submissions read scope', () => {
  const form = { id: 10, created_by: 6 }
  it.each([
    ['active coach of a linked team', 'u-coach', true],
    ['the creator', 'u-creator', true],
    ['vorstand', 'u-vorstand', true],
    ['vb_admin (team sport)', 'u-vbadmin', true],
    ['bb_admin (other sport)', 'u-bbadmin', false],
    ['coach of a linked INACTIVE team only', 'u-oldcoach', false],
    ['plain player', 'u-player', false],
  ])('%s', async (_label, user, expected) => {
    expect(await canReadFormAnswers(fakeDb(world()), as(user), form)).toBe(expected)
  })
  it('full Directus admin', async () => {
    expect(await canReadFormAnswers(fakeDb(world()), { user: 'nobody', admin: true }, form)).toBe(true)
  })
})

describe('authorizeFormFile', () => {
  it('serves an answer file of the form to its coach', async () => {
    const r = await authorizeFormFile(fakeDb(world()), as('u-coach'), '10', FILE)
    expect(r.ok).toBe(true)
    expect(r.file.id).toBe(FILE)
  })

  it('404s a non-manager', async () => {
    expect(await authorizeFormFile(fakeDb(world()), as('u-player'), '10', FILE)).toEqual({ ok: false, status: 404 })
  })

  it('refuses a file grafted into a later submission of a form the caller manages', async () => {
    // Coach 1 manages form 20 and "answers" it naming form 10's file.
    const w = world()
    w.form_submissions.push({ id: 900, form: 20, member: 1, answers: { doc: { id: FILE } } })
    expect(await authorizeFormFile(fakeDb(w), as('u-coach'), '20', FILE)).toEqual({ ok: false, status: 404 })
  })

  it('refuses a file outside the form-upload folders even if named first', async () => {
    const w = world()
    w.form_submissions = [{ id: 1, form: 20, member: null, answers: { doc: OTHER } }]
    expect(await authorizeFormFile(fakeDb(w), as('u-coach'), '20', OTHER)).toEqual({ ok: false, status: 404 })
  })

  it('refuses an id that sits in a non-file field', async () => {
    const w = world()
    w.form_submissions = [{ id: 1, form: 10, member: 2, answers: { name: FILE } }]
    expect(await authorizeFormFile(fakeDb(w), as('u-coach'), '10', FILE)).toEqual({ ok: false, status: 404 })
  })

  it("refuses a quarantined upload of someone other than the submitter", async () => {
    const w = world()
    w.directus_files[0].folder = UPLOAD_QUARANTINE_FOLDER
    w.directus_files[0].uploaded_by = 'u-vorstand'
    expect(await authorizeFormFile(fakeDb(w), as('u-coach'), '10', FILE)).toEqual({ ok: false, status: 404 })
  })

  it('refuses an anonymous submission naming a member-uploaded, unfiled file', async () => {
    const w = world()
    w.form_submissions = [{ id: 1, form: 10, member: null, answers: { doc: FILE } }]
    w.directus_files[0].folder = UPLOAD_QUARANTINE_FOLDER
    expect(await authorizeFormFile(fakeDb(w), as('u-coach'), '10', FILE)).toEqual({ ok: false, status: 404 })
  })

  it('serves an anonymous upload of an anonymous submission (legacy root file)', async () => {
    const w = world()
    w.form_submissions = [{ id: 1, form: 10, member: null, answers: { doc: [{ id: FILE }] } }]
    Object.assign(w.directus_files[0], { folder: null, uploaded_by: null })
    expect((await authorizeFormFile(fakeDb(w), as('u-coach'), '10', FILE)).ok).toBe(true)
  })

  it('rejects malformed ids without touching the DB', async () => {
    expect(await authorizeFormFile(fakeDb({}), as('u-coach'), '10', '../etc')).toEqual({ ok: false, status: 404 })
    expect(await authorizeFormFile(fakeDb({}), as('u-coach'), 'x', FILE)).toEqual({ ok: false, status: 404 })
  })
})

describe('GET /forms/:id/files/:fileId route', () => {
  function route(db) {
    const routes = {}
    const router = { get: (p, h) => { routes[`GET ${p}`] = h }, post: (p, h) => { routes[`POST ${p}`] = h } }
    const logger = { child: () => ({ info() {}, warn() {}, error() {} }) }
    const requireAuth = (req) => { if (!req.accountability?.user) { const e = new Error('Authentication required'); e.status = 401; throw e } }
    registerForms(router, { database: db, logger, services: {}, getSchema: async () => ({}) }, { logEndpointError() {}, requireAuth })
    return routes['GET /forms/:id/files/:fileId']
  }
  const res = () => ({
    statusCode: 200, body: null, headers: {}, headersSent: false,
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    setHeader(k, v) { this.headers[k] = v },
  })

  it('streams through streamManagedFile for a manager', async () => {
    streamManagedFile.mockClear()
    const r = res()
    await route(fakeDb(world()))({ params: { id: '10', fileId: FILE }, accountability: as('u-coach') }, r)
    expect(streamManagedFile).toHaveBeenCalledTimes(1)
    expect(r.streamed).toBe(FILE)
    expect(r.headers['Cache-Control']).toBe('private, no-store')
  })

  it('404s everyone else and never streams', async () => {
    streamManagedFile.mockClear()
    const r = res()
    await route(fakeDb(world()))({ params: { id: '10', fileId: FILE }, accountability: as('u-player') }, r)
    expect(r.statusCode).toBe(404)
    expect(streamManagedFile).not.toHaveBeenCalled()
  })

  it('401s anonymous callers', async () => {
    const r = res()
    await route(fakeDb(world()))({ params: { id: '10', fileId: FILE }, accountability: null }, r)
    expect(r.statusCode).toBe(401)
  })
})

describe('fileUploads — raw-knex submit paths file their own uploads', () => {
  const tables = () => ({
    directus_files: [
      { id: FILE, folder: UPLOAD_QUARANTINE_FOLDER, uploaded_by: 'u-1' },
      { id: OTHER, folder: null, uploaded_by: null },
      { id: 'aaaaaaaa-2222-4333-8444-555555555555', folder: '0e1a0387-0000-4000-8000-000000000003', uploaded_by: 'u-1' },
      { id: 'bbbbbbbb-2222-4333-8444-555555555555', folder: UPLOAD_QUARANTINE_FOLDER, uploaded_by: 'u-2' },
    ],
  })

  it("moves the caller's own unfiled upload only", async () => {
    const t = tables()
    const n = await fileUploads(fakeDb(t), [FILE, 'aaaaaaaa-2222-4333-8444-555555555555', 'bbbbbbbb-2222-4333-8444-555555555555'], EXPENSE_RECEIPTS_FOLDER, 'u-1')
    expect(n).toBe(1)
    expect(t.directus_files[0].folder).toBe(EXPENSE_RECEIPTS_FOLDER)
    expect(t.directus_files[2].folder).toBe('0e1a0387-0000-4000-8000-000000000003') // public image stays public
    expect(t.directus_files[3].folder).toBe(UPLOAD_QUARANTINE_FOLDER) // someone else's upload untouched
  })

  it('null uploader means anonymous uploads only', async () => {
    const t = tables()
    await fileUploads(fakeDb(t), [FILE, OTHER], FORM_UPLOADS_FOLDER, null)
    expect(t.directus_files[1].folder).toBe(FORM_UPLOADS_FOLDER)
    expect(t.directus_files[0].folder).toBe(UPLOAD_QUARANTINE_FOLDER)
  })

  it('ignores non-uuid ids', async () => {
    expect(await fileUploads(fakeDb(tables()), ['nope', 5, null], FORM_UPLOADS_FOLDER, null)).toBe(0)
  })

  it('answerFileIds reads file fields only, object / string / array shapes', () => {
    const fields = [{ id: 'a', type: 'file' }, { id: 'b', type: 'file' }, { id: 'c', type: 'text' }]
    expect(answerFileIds(fields, { a: { id: FILE }, b: [OTHER, 'junk'], c: FILE }).sort()).toEqual([FILE, OTHER].sort())
  })
})

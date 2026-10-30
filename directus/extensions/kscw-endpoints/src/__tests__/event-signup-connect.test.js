// Connecting an existing forms.kscw.ch form to an event (admins only) + re-sync.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const listSubmissions = vi.fn()
vi.mock('../opnform.js', () => ({
  badSlug: (s) => !/^[a-z0-9][a-z0-9-]{0,80}$/i.test(String(s ?? '')),
  listSubmissions: (...a) => listSubmissions(...a),
  createFormFromTemplate: vi.fn(),
  findFreeSlug: vi.fn(),
  formUrl: (slug) => `https://forms.kscw.ch/forms/${slug}`,
}))
vi.mock('../activity-log.js', () => ({ writeUserLog: vi.fn(async () => {}) }))
const syncFormSignups = vi.fn(async () => ({ submissions: 1, signed_in: 1, not_members: 0, ambiguous: 0, events: [5] }))
vi.mock('../opnform-members.js', () => ({ syncFormSignups: (...a) => syncFormSignups(...a) }))

const { registerEventSignupForm, isOurFormsUrl } = await import('../event-signup-form.js')

function harness({ role, event }) {
  const updates = []
  const db = (table) => {
    const q = {
      where: () => q, whereIn: () => q, join: () => q, leftJoin: () => q, orderBy: () => q,
      select: async () => [],
      first: async () => (table === 'events' ? event : table === 'members' ? { id: 1, role: JSON.stringify(role) } : null),
      update: async (row) => { updates.push(row); return 1 },
    }
    return q
  }
  db.transaction = async (fn) => fn(Object.assign((t) => db(t), { raw: async () => ({}) }))
  const routes = new Map()
  const router = { get: (p, h) => routes.set(`GET ${p}`, h), post: (p, h) => routes.set(`POST ${p}`, h), delete: (p, h) => routes.set(`DELETE ${p}`, h) }
  registerEventSignupForm(router, { database: db, logger: { child: () => ({ info: () => {}, warn: () => {}, error: () => {} }) } })
  const call = async (key, body = {}) => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
    await routes.get(key)({ params: { id: '5' }, body, accountability: { user: 'u1' } }, res)
    return res
  }
  return { call, updates }
}

const EVENT = { id: 5, title: 'Fondue', created_by: 1, signup_url: null, signup_form_slug: null }

describe('connect existing form', () => {
  beforeEach(() => {
    listSubmissions.mockReset()
    listSubmissions.mockResolvedValue({ title: 'F', fields: [{ id: 'e', type: 'email' }], data: [{ e: 'a@b.ch' }], last_page: 1 })
    syncFormSignups.mockClear()
  })

  it('binds the form and signs in who already submitted', async () => {
    const { call, updates } = harness({ role: ['admin'], event: EVENT })
    const res = await call('POST /events/:id/signup-form/connect', { url: 'https://forms.kscw.ch/forms/figugegl-jh4pju' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, slug: 'figugegl-jh4pju', sync: { signed_in: 1 } })
    expect(updates[0]).toMatchObject({ signup_form_slug: 'figugegl-jh4pju', signup_url: 'https://forms.kscw.ch/forms/figugegl-jh4pju' })
    expect(syncFormSignups).toHaveBeenCalledWith(expect.anything(), 'figugegl-jh4pju', expect.objectContaining({ data: [{ e: 'a@b.ch' }] }))
  })

  it('is for club admins only — not the event creator', async () => {
    const { call, updates } = harness({ role: ['user'], event: EVENT }) // creator (created_by 1 = caller)
    const res = await call('POST /events/:id/signup-form/connect', { url: 'https://forms.kscw.ch/forms/x' })
    expect(res.statusCode).toBe(403)
    expect(updates).toEqual([])
  })

  it('refuses other hosts and unknown forms', async () => {
    const { call } = harness({ role: ['admin'], event: EVENT })
    expect((await call('POST /events/:id/signup-form/connect', { url: 'https://evil.example/forms/x' })).statusCode).toBe(400)
    listSubmissions.mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }))
    expect((await call('POST /events/:id/signup-form/connect', { url: 'https://forms.kscw.ch/forms/missing' })).statusCode).toBe(404)
  })

  it('re-sync needs a bound form', async () => {
    expect((await harness({ role: ['admin'], event: EVENT }).call('POST /events/:id/signup-form/sync')).statusCode).toBe(409)
    const bound = { ...EVENT, signup_url: 'https://forms.kscw.ch/forms/kurs', signup_form_slug: 'kurs' }
    const res = await harness({ role: ['user'], event: bound }).call('POST /events/:id/signup-form/sync')
    expect(res.body).toMatchObject({ ok: true, sync: { signed_in: 1 } })
  })

  it('knows our form host', () => {
    expect(isOurFormsUrl('https://forms.kscw.ch/forms/a')).toBe(true)
    expect(isOurFormsUrl('http://forms.kscw.ch/forms/a')).toBe(false)
    expect(isOurFormsUrl('https://forms.kscw.ch.evil.io/forms/a')).toBe(false)
  })
})

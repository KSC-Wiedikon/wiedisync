// 2026-09-28 audit F15: GET /events/:id/signups must read OpnForm submissions only
// for the endpoint-bound `events.signup_form_slug` (migration 385), never for a slug
// parsed out of the client-writable `signup_url`.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../opnform.js', () => ({
  badSlug: () => false,
  listSubmissions: vi.fn(async () => ({ data: [], meta: { total: 0 } })),
  createFormFromTemplate: vi.fn(),
  findFreeSlug: vi.fn(),
  formUrl: vi.fn(),
}))
vi.mock('../activity-log.js', () => ({ writeUserLog: vi.fn(async () => {}) }))

const { listSubmissions } = await import('../opnform.js')
const { registerEventSignupForm } = await import('../event-signup-form.js')

function fakeDb({ event, caller }) {
  const db = (table) => {
    const chain = {
      leftJoin: () => chain,
      where: () => chain,
      whereIn: () => chain,
      orderBy: () => chain,
      select: async () => [],
      first: async () => (table === 'events' ? event : table === 'members' ? caller : null),
    }
    return chain
  }
  return db
}

function route(db) {
  const routes = {}
  const router = {
    get: (p, h) => { routes[`GET ${p}`] = h },
    post: (p, h) => { routes[`POST ${p}`] = h },
    delete: (p, h) => { routes[`DELETE ${p}`] = h },
  }
  const logger = { child: () => ({ info() {}, warn() {}, error() {} }) }
  registerEventSignupForm(router, { database: db, logger })
  return routes['GET /events/:id/signups']
}

async function call(handler) {
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
  }
  await handler({ params: { id: '7' }, accountability: { user: 'u-1' } }, res)
  return res
}

describe('GET /events/:id/signups slug binding (F15)', () => {
  beforeEach(() => listSubmissions.mockClear())
  const creator = { id: 42, role: '["user","coach"]' }

  it('never reads a form named only by the client-writable signup_url', async () => {
    const event = {
      id: 7, title: 'x', created_by: 42,
      signup_url: 'https://forms.kscw.ch/forms/board-secret-form', signup_form_slug: null,
    }
    const res = await call(route(fakeDb({ event, caller: creator })))
    expect(res.statusCode).toBe(200)
    expect(listSubmissions).not.toHaveBeenCalled()
    expect(res.body.external).toBeNull()
    expect(res.body.external_error).toBe('form_not_linked')
  })

  it('ignores the bound slug once signup_url points elsewhere', async () => {
    const event = {
      id: 7, title: 'x', created_by: 42,
      signup_url: 'https://forms.kscw.ch/forms/board-secret-form', signup_form_slug: 'my-event-2026',
    }
    const res = await call(route(fakeDb({ event, caller: creator })))
    expect(listSubmissions).not.toHaveBeenCalled()
    expect(res.body.external_error).toBe('form_not_linked')
  })

  it('no signup link at all is not an error', async () => {
    const event = { id: 7, title: 'x', created_by: 42, signup_url: null, signup_form_slug: null }
    const res = await call(route(fakeDb({ event, caller: creator })))
    expect(res.body.external_error).toBeNull()
  })

  it('reads the endpoint-bound form when the link still points at it', async () => {
    const event = {
      id: 7, title: 'x', created_by: 42,
      signup_url: 'https://forms.kscw.ch/forms/my-event-2026', signup_form_slug: 'my-event-2026',
    }
    const res = await call(route(fakeDb({ event, caller: creator })))
    expect(listSubmissions).toHaveBeenCalledWith('my-event-2026', { page: 1, perPage: 100 })
    expect(res.body.external).toEqual({ data: [], meta: { total: 0 } })
    expect(res.body.external_error).toBeNull()
  })
})

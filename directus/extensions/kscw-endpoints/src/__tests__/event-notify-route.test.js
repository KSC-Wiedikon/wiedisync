// 2026-09-28 audit F17/F79 remainder, at the route: a coach who CREATED an event
// reaches their own teams freely, but a club-wide audience beyond them is capped
// before anything is inserted or pushed; `invite_guests: false` narrows the team
// arm to the core roster.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const pushed = []
vi.mock('../web-push.js', () => ({ sendPushToMembers: vi.fn(async () => {}) }))
vi.mock('../push-i18n.js', () => ({ sendLocalizedPush: vi.fn(async (_db, ids) => { pushed.push(...ids) }) }))
vi.mock('../activity-log.js', () => ({ writeUserLog: vi.fn(async () => {}) }))

const { registerEventNotify } = await import('../event-notify.js')

function fakeDb(tables, inserted) {
  return (name) => {
    let rows = [...(tables[name] || [])]
    const chain = {
      where(a, b) {
        if (typeof a === 'string' && b !== undefined) rows = rows.filter((r) => !(a in r) || String(r[a]) === String(b))
        return chain
      },
      whereIn(c, vals) { const s = vals.map(String); rows = rows.filter((r) => !(c in r) || s.includes(String(r[c]))); return chain },
      whereNotNull(c) { rows = rows.filter((r) => r[c] != null); return chain },
      whereRaw(sql) {
        if (/guest_level/.test(sql)) rows = rows.filter((r) => !r.guest_level)
        if (/role::jsonb/.test(sql)) rows = rows.filter(() => true)
        return chain
      },
      modify(fn) { fn(chain); return chain },
      select() { return chain },
      then(ok, fail) { return Promise.resolve(rows).then(ok, fail) },
      async first() { return rows[0] },
      async insert(r) { inserted.push(...r); return [] },
    }
    return chain
  }
}

function handler(db, event) {
  const routes = {}
  const router = { post: (p, h) => { routes[p] = h } }
  class ItemsService { async readOne() { return event } }
  const logger = { info() {}, warn() {}, error(m) { if (process.env.DBG) console.log(m) } }
  registerEventNotify(router, { services: { ItemsService, MailService: class {} }, database: db, getSchema: async () => ({}), logger })
  return routes['/events/:id/notify']
}
const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } })

let seq = 0
describe('POST /events/:id/notify — coach creator', () => {
  beforeEach(() => { pushed.length = 0 })

  it('invite_guests=false leaves guest-level roster rows out of the fan-out', async () => {
    const tables = {
      members: [{ id: 1, user: 'u-coach', role: '["user"]' }],
      teams_coaches: [{ teams_id: 100, members_id: 1 }],
      teams_responsibles: [],
      member_teams: [{ member: 2, team: 100, guest_level: 0 }, { member: 3, team: 100, guest_level: 2 }],
    }
    const inserted = []
    const event = { id: ++seq, title: 'Camp', created_by: 1, invite_guests: false, teams: [{ teams_id: 100 }], invited_members: [], invited_roles: [] }
    const r = res()
    await handler(fakeDb(tables, inserted), event)({ params: { id: String(event.id) }, body: {}, accountability: { user: 'u-coach' } }, r)
    expect(r.body).toEqual({ notified: 1, emailed: false })
    expect(inserted.map((n) => String(n.member))).toEqual(['2'])
  })

  it('a club-wide invited_roles audience beyond the cap is refused before any insert or push', async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: 1000 + i, role: '["board"]' }))
    const tables = {
      members: [{ id: 1, user: 'u-coach', role: '["user"]' }, ...many],
      teams_coaches: [{ teams_id: 100, members_id: 1 }],
      teams_responsibles: [],
      member_teams: [{ member: 2, team: 100, guest_level: 0 }],
    }
    const inserted = []
    const event = { id: ++seq, title: 'Party', created_by: 1, teams: [{ teams_id: 100 }], invited_members: [], invited_roles: ['board'] }
    const r = res()
    await handler(fakeDb(tables, inserted), event)({ params: { id: String(event.id) }, body: {}, accountability: { user: 'u-coach' } }, r)
    expect(r.statusCode).toBe(403)
    expect(r.body.code).toBe('audience_too_large')
    expect(inserted).toEqual([])
    expect(pushed).toEqual([])
  })
})

// M7 (2026-10-12): the board's uncapped fan-out stops at its own section. A
// vorstand below full admin is sport-confined by their admin tier, so on another
// sport's event they are held to the creator cap like anybody else.
describe('POST /events/:id/notify — board member sport scope (M7)', () => {
  beforeEach(() => { pushed.length = 0 })

  const many = Array.from({ length: 80 }, (_, i) => ({ id: 2000 + i, role: '["user"]' }))
  const tablesFor = (role, extra = {}) => ({
    members: [{ id: 1, user: 'u-board', role: JSON.stringify(role) }, ...many],
    teams: [{ id: 100, sport: 'volleyball' }, { id: 200, sport: 'basketball' }],
    teams_coaches: [],
    teams_responsibles: [],
    member_teams: [{ member: 2, team: 100, guest_level: 0 }, { member: 3, team: 200, guest_level: 0 }],
    ...extra,
  })
  const run = async (tables, event) => {
    const inserted = []
    const r = res()
    await handler(fakeDb(tables, inserted), event)({ params: { id: String(event.id) }, body: {}, accountability: { user: 'u-board' } }, r)
    return { r, inserted }
  }
  const bigEvent = (teamIds) => ({
    id: ++seq, title: 'Club day', created_by: 1,
    teams: teamIds.map((teams_id) => ({ teams_id })), invited_members: [], invited_roles: ['board'],
  })

  it('a VB board member may fan out uncapped on a volleyball event', async () => {
    const { r, inserted } = await run(tablesFor(['board', 'vb_admin']), bigEvent([100]))
    expect(r.statusCode).toBe(200)
    expect(inserted.length).toBeGreaterThan(60)
  })

  it('a VB board member is capped on a basketball event they created', async () => {
    const { r, inserted } = await run(tablesFor(['board', 'vb_admin']), bigEvent([200]))
    expect(r.statusCode).toBe(403)
    expect(r.body.code).toBe('audience_too_large')
    expect(inserted).toEqual([])
  })

  it('a team-less (club-wide) event counts for either section', async () => {
    const { r } = await run(tablesFor(['board', 'bb_admin']), bigEvent([]))
    expect(r.statusCode).toBe(200)
  })

  it('a board member who is also a full admin is never confined', async () => {
    const { r } = await run(tablesFor(['board', 'admin']), bigEvent([200]))
    expect(r.statusCode).toBe(200)
  })

  it('a VB board member who coaches the basketball team still notifies that team', async () => {
    const tables = tablesFor(['board', 'vb_admin'], { teams_coaches: [{ teams_id: 200, members_id: 1 }] })
    const event = { id: ++seq, title: 'BB camp', created_by: 99, teams: [{ teams_id: 200 }], invited_members: [], invited_roles: ['board'] }
    const { r, inserted } = await run(tables, event)
    expect(r.statusCode).toBe(200)
    // Leader path: their own team only, never the club-wide invited_roles.
    expect(inserted.map((n) => String(n.member)).sort()).toEqual(['1', '3'])
  })
})

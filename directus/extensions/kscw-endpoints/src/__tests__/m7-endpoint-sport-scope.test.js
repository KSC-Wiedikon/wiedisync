// M7 (2026-10-12 owner decision, "sport data only"): every custom endpoint that let
// vorstand / vb_admin / bb_admin act on SPORT data club-wide now stops at the
// caller's section. One block per gate: in scope allowed, out of scope refused,
// 'both' allowed, full admin allowed, and — where the endpoint has one — the
// coach/TR tier still open to a confined caller who leads the target team.
//
// resolveMemberSports is mocked: these pin the GATES, not how a member's section
// is derived (member-sport.test.js does that), so they keep meaning the same
// thing when it starts reading the stored members.sport_section column.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const memberSports = new Map()
vi.mock('../member-sport.js', async (orig) => ({
  ...(await orig()),
  resolveMemberSports: vi.fn(async (_db, ids) => new Map(ids.map((id) => [String(id), memberSports.get(String(id)) ?? 'both']))),
}))
vi.mock('../activity-log.js', () => ({ writeUserLog: vi.fn(async () => {}) }))
vi.mock('../registration-duplicates.js', async (orig) => ({
  ...(await orig()),
  findDuplicateCandidates: vi.fn(async () => ({ level: 'none', candidates: [] })),
  buildMergeDiff: vi.fn(async () => []),
}))
vi.mock('../email-templates.js', async (orig) => ({
  ...(await orig()),
  loadTemplate: vi.fn(async () => null),
  recordEmailSend: vi.fn(async () => {}),
}))

const { authorizePollViewer } = await import('../poll-results.js')
const { isJsExportAdmin } = await import('../js-export.js')
const { registerSignupInvites } = await import('../signup-invites.js')
const { syncStatusAccess } = await import('../clubdesk-update.js')
const { promotedInScope } = await import('../licence-status.js')
const { registerStats, scopeStatsQuery } = await import('../stats.js')
const { authorizeEventAdmin } = await import('../public-event-signup.js')
const { mailboxAccountAllowed } = await import('../scheduling-mailbox.js')
const { registerRegistration, registrationSportsFor, registrationAllowed } = await import('../registration.js')
const { findDuplicateCandidates, buildMergeDiff } = await import('../registration-duplicates.js')

// ── in-memory knex stand-in ──────────────────────────────────────────────────
function fakeDb(tables) {
  const db = (name) => {
    const table = String(name).split(/\s+as\s+/i)[0]
    const preds = []
    const col = (c) => String(c).split('.').pop()
    const rows = () => (tables[table] ||= [])
    const match = (r) => preds.every((p) => p(r))
    const chain = {
      where(a, b) {
        if (typeof a === 'function') return chain
        if (a && typeof a === 'object') for (const [k, v] of Object.entries(a)) preds.push((r) => String(r[col(k)]) === String(v))
        else preds.push((r) => String(r[col(a)]) === String(b))
        return chain
      },
      whereIn(c, vals) { const s = new Set(vals.map(String)); preds.push((r) => s.has(String(r[col(c)]))); return chain },
      whereRaw() { return chain },
      join() { return chain },
      select() { return chain },
      orderBy() { return chain },
      async first() { return rows().find(match) },
      async delete() { tables[table] = rows().filter((r) => !match(r)); return 1 },
      async insert(r) { rows().push(r); return [] },
      async update(patch) { for (const r of rows()) if (match(r)) Object.assign(r, patch); return 1 },
      then(ok, fail) { return Promise.resolve(rows().filter(match)).then(ok, fail) },
    }
    return chain
  }
  return db
}

const res = () => ({
  statusCode: 200, body: null,
  status(c) { this.statusCode = c; return this },
  json(b) { this.body = b; return this },
})
const logger = { child() { return logger }, info() {}, warn() {}, error() {} }

function routerOf(register) {
  const routes = {}
  const add = (method) => (path, ...handlers) => { routes[`${method} ${path}`] = handlers }
  register({ get: add('GET'), post: add('POST'), patch: add('PATCH'), delete: add('DELETE') })
  return async (key, req) => {
    const r = res()
    const handlers = routes[key]
    if (!handlers) throw new Error(`no route ${key}`)
    let i = 0
    const next = async () => { const h = handlers[i++]; if (h) await h(req, r, next) }
    await next()
    return r
  }
}

const TEAMS = [{ id: 100, sport: 'volleyball' }, { id: 200, sport: 'basketball' }, { id: 300, sport: null }]

beforeEach(() => {
  memberSports.clear()
  memberSports.set('10', 'volleyball')
  memberSports.set('11', 'basketball')
  memberSports.set('12', 'both')
})

// ── poll-results.js ──────────────────────────────────────────────────────────
describe('poll-results authorizePollViewer', () => {
  const run = (role, poll, extra = {}) => {
    const db = fakeDb({
      members: [{ id: 1, user: 'u', role: JSON.stringify(role) }],
      teams: TEAMS, teams_coaches: [], teams_responsibles: [], member_teams: [], ...extra,
    })
    return authorizePollViewer(db, { accountability: { user: 'u' } }, { id: 7, created_by: 99, results_visible: false, ...poll })
  }

  it('a sport admin reads results of their own sport', async () => {
    expect(await run(['vb_admin'], { team: 100 })).toBe(true)
  })
  it('… but not of the other sport', async () => {
    expect(await run(['vb_admin'], { team: 200 })).toBe(false)
    expect(await run(['vorstand', 'bb_admin'], { team: 100 })).toBe(false)
  })
  it('a team-less poll is club-wide', async () => {
    expect(await run(['bb_admin'], { team: null })).toBe(true)
  })
  it('a full admin is unconfined', async () => {
    expect(await run(['vorstand', 'admin'], { team: 200 })).toBe(true)
  })
  it('a confined admin who coaches the other-sport team keeps the coach tier', async () => {
    expect(await run(['vb_admin'], { team: 200 }, { teams_coaches: [{ teams_id: 200, members_id: 1 }] })).toBe(true)
  })
})

// ── js-export.js ─────────────────────────────────────────────────────────────
describe('js-export isJsExportAdmin', () => {
  it('a sport admin / board member is admin for their own sport only', () => {
    expect(isJsExportAdmin('["vb_admin"]', 'volleyball')).toBe(true)
    expect(isJsExportAdmin('["vb_admin"]', 'basketball')).toBe(false)
    expect(isJsExportAdmin(['vorstand', 'bb_admin'], 'volleyball')).toBe(false)
    expect(isJsExportAdmin(['vorstand', 'bb_admin'], 'basketball')).toBe(true)
  })
  it('a team with no sport is "both"', () => {
    expect(isJsExportAdmin(['bb_admin'], null)).toBe(true)
  })
  it('full and Directus admins are unconfined; a plain member never passes on role', () => {
    expect(isJsExportAdmin(['admin'], 'basketball')).toBe(true)
    expect(isJsExportAdmin([], 'basketball', { directusAdmin: true })).toBe(true)
    expect(isJsExportAdmin(['vb_admin', 'bb_admin'], 'basketball')).toBe(true)
    expect(isJsExportAdmin(['user'], 'volleyball')).toBe(false)
  })
  // The coach/TR fall-through is the route's own unchanged branch: a refused role
  // check lands there, it does not answer 403 by itself.
})

// ── signup-invites.js ────────────────────────────────────────────────────────
describe('POST /signup-invites/create — board sport scope', () => {
  const run = async (role, memberId) => {
    const tables = {
      members: [
        { id: 1, user: 'u-board', role: JSON.stringify(role), first_name: 'B', last_name: 'Oard' },
        { id: 10, user: null, email: 'vb@x.ch', first_name: 'V' },
        { id: 11, user: null, email: 'bb@x.ch', first_name: 'B' },
        { id: 12, user: null, email: 'club@x.ch', first_name: 'C' },
      ],
      signup_tokens: [],
    }
    const sent = []
    class MailService { async send(m) { sent.push(m) } }
    const call = routerOf((router) => registerSignupInvites(router,
      { database: fakeDb(tables), logger, services: { MailService }, getSchema: async () => ({}) },
      { validatePassword: () => null }))
    const r = await call('POST /signup-invites/create', { body: { member_id: memberId }, accountability: { user: 'u-board' }, headers: {} })
    return { r, sent, tables }
  }

  it('a VB board member invites a volleyball member', async () => {
    const { r, sent } = await run(['vorstand', 'vb_admin'], 10)
    expect(r.statusCode).toBe(200)
    expect(sent).toHaveLength(1)
  })
  it('… but not a basketball member, and mints nothing', async () => {
    const { r, sent, tables } = await run(['vorstand', 'vb_admin'], 11)
    expect(r.statusCode).toBe(403)
    expect(sent).toHaveLength(0)
    expect(tables.signup_tokens).toHaveLength(0)
  })
  it('a club-level ("both") member is open to either section', async () => {
    expect((await run(['vorstand', 'bb_admin'], 12)).r.statusCode).toBe(200)
  })
  it('a full admin is unconfined', async () => {
    expect((await run(['vorstand', 'admin'], 11)).r.statusCode).toBe(200)
  })
  it('a sport admin who is not on the board still has no access at all', async () => {
    expect((await run(['vb_admin'], 10)).r.statusCode).toBe(403)
  })
})

// ── clubdesk-update.js /clubdesk-sync-status ─────────────────────────────────
describe('clubdesk syncStatusAccess', () => {
  it('confines a single-sport admin, board or not', () => {
    expect(syncStatusAccess('["vb_admin"]')).toEqual({ sportScope: 'volleyball' })
    expect(syncStatusAccess(['vorstand', 'bb_admin'])).toEqual({ sportScope: 'basketball' })
  })
  it('full, dual and Directus admins see every verdict', () => {
    expect(syncStatusAccess(['vorstand', 'admin'])).toEqual({ sportScope: null })
    expect(syncStatusAccess(['vb_admin', 'bb_admin'])).toEqual({ sportScope: null })
    expect(syncStatusAccess([], { directusAdmin: true })).toEqual({ sportScope: null })
  })
  it('refuses everybody else', () => {
    expect(syncStatusAccess(['user'])).toBeNull()
  })
})

// ── licence-status.js ────────────────────────────────────────────────────────
describe('licence-status promotedInScope', () => {
  const promoted = [{ id: 10, name: 'V' }, { id: 11, name: 'B' }, { id: 12, name: 'C' }]
  it('a confined caller sees own-section and club-level names only', async () => {
    expect((await promotedInScope(fakeDb({}), 'volleyball', promoted)).map((p) => p.id)).toEqual([10, 12])
  })
  it('an unconfined caller sees all', async () => {
    expect(await promotedInScope(fakeDb({}), null, promoted)).toBe(promoted)
  })
})

// ── stats.js ─────────────────────────────────────────────────────────────────
describe('stats per-team views', () => {
  const VIEW = [
    { team_id: 100, sport: 'volleyball' }, { team_id: 200, sport: 'basketball' }, { team_id: 300, sport: null },
  ]
  function statsDb(role) {
    const db = (name) => {
      if (name === 'members') {
        return { where() { return this }, async first() { return { id: 1, user: 'u', role: JSON.stringify(role) } } }
      }
      let rows = name === 'stats_team_roster' ? [...VIEW] : []
      const q = {
        where(a, b) {
          if (typeof a === 'function') {
            const ors = []
            const sub = {
              where(c, v) { ors.push((r) => r[c] === v); return sub },
              orWhereNull(c) { ors.push((r) => r[c] == null); return sub },
            }
            a(sub)
            rows = rows.filter((r) => ors.some((p) => p(r)))
          } else {
            rows = rows.filter((r) => String(r[a]) === String(b))
          }
          return q
        },
        select() { return Promise.resolve(rows) },
      }
      return q
    }
    return db
  }
  const run = async (role, query = {}) => {
    const call = routerOf((router) => registerStats(router, { database: statsDb(role), logger }))
    return call('GET /stats/team-roster', { query, accountability: { user: 'u' } })
  }

  it('a confined sport admin sees their own section plus sport-less rows', async () => {
    const r = await run(['vb_admin'])
    expect(r.body.data.map((x) => x.team_id)).toEqual([100, 300])
  })
  it('asking for the other sport returns nothing', async () => {
    const r = await run(['vorstand', 'vb_admin'], { sport: 'basketball' })
    expect(r.body.data).toEqual([])
  })
  it('a full admin sees every team', async () => {
    const r = await run(['admin'])
    expect(r.body.data.map((x) => x.team_id)).toEqual([100, 200, 300])
  })
  it('scopeStatsQuery leaves the query chainable', () => {
    const q = { where(fn) { this.fn = fn; return this } }
    expect(scopeStatsQuery(q, 'basketball')).toBe(q)
  })
})

// ── public-event-signup.js share tokens ──────────────────────────────────────
describe('public-event-signup authorizeEventAdmin', () => {
  const run = (role, event, sports) => {
    const db = (name) => {
      if (String(name).startsWith('members')) {
        return { where() { return this }, async first() { return { id: 1, role: JSON.stringify(role) } } }
      }
      const q = { join() { return q }, where() { return q }, select() { return Promise.resolve(sports.map((sport) => ({ sport }))) } }
      return q
    }
    return authorizeEventAdmin(db, { user: 'u' }, { id: 5, created_by: 99, ...event })
  }

  it('a sport admin manages events of their own sport', async () => {
    expect((await run(['vb_admin'], {}, ['volleyball'])).ok).toBe(true)
  })
  it('… not of the other sport', async () => {
    expect((await run(['vb_admin'], {}, ['basketball'])).ok).toBe(false)
  })
  it('a team-less event is only the creator\'s (same rule as event-signup-form.js)', async () => {
    expect((await run(['vb_admin'], {}, [])).ok).toBe(false)
    expect((await run(['vb_admin'], { created_by: 1 }, [])).ok).toBe(true)
  })
  it('a full admin is unconfined', async () => {
    expect((await run(['admin'], {}, ['basketball'])).ok).toBe(true)
  })
})

// ── scheduling-mailbox.js ────────────────────────────────────────────────────
describe('mailboxAccountAllowed — the VIS transfers box is volleyball casework', () => {
  it('a vb_admin reads it, a bb_admin (board or not) no longer does', () => {
    expect(mailboxAccountAllowed('vis_transfers', ['vb_admin'])).toBe(true)
    expect(mailboxAccountAllowed('vis_transfers', ['bb_admin'])).toBe(false)
    expect(mailboxAccountAllowed('vis_transfers', ['vorstand', 'bb_admin'])).toBe(false)
  })
  it('full admins keep every box; the sport boxes are unchanged', () => {
    expect(mailboxAccountAllowed('vis_transfers', ['admin'])).toBe(true)
    expect(mailboxAccountAllowed('basketball', ['bb_admin'])).toBe(true)
    expect(mailboxAccountAllowed('basketball', ['vb_admin'])).toBe(false)
    expect(mailboxAccountAllowed('volleyball', [], { isSpielplaner: true })).toBe(true)
    expect(mailboxAccountAllowed('admin', ['vorstand', 'vb_admin'])).toBe(false)
  })
})

// ── registration.js ──────────────────────────────────────────────────────────
describe('registrationSportsFor / registrationAllowed', () => {
  it('a confined board member keeps their sport and the passive rows', () => {
    expect(registrationSportsFor(['vorstand', 'vb_admin'])).toEqual(['volleyball', 'passive'])
    expect(registrationAllowed(['vorstand', 'vb_admin'], 'basketball')).toBe(false)
    expect(registrationAllowed(['vorstand', 'vb_admin'], 'volleyball')).toBe(true)
    expect(registrationAllowed(['vorstand', 'vb_admin'], 'passive')).toBe(true)
    expect(registrationAllowed(['vorstand', 'vb_admin'], null)).toBe(true)
  })
  it('a board member who is a full or dual admin is unconfined', () => {
    expect(registrationAllowed(['vorstand', 'admin'], 'basketball')).toBe(true)
    expect(registrationAllowed(['vorstand', 'vb_admin', 'bb_admin'], 'basketball')).toBe(true)
  })
  it('a sport admin is unchanged: own sport only, no passive', () => {
    expect(registrationSportsFor(['bb_admin'])).toEqual(['basketball'])
    expect(registrationAllowed(['bb_admin'], 'passive')).toBe(false)
    expect(registrationSportsFor(['user'])).toBeNull()
    expect(registrationAllowed([], 'basketball', { directusAdmin: true })).toBe(true)
  })
})

describe('registration staff routes', () => {
  const regs = [
    { id: 1, membership_type: 'volleyball', status: 'approved', email: 'v@x.ch', reference_number: 'REG-1', member: null, vorname: 'V', nachname: 'X' },
    { id: 2, membership_type: 'basketball', status: 'approved', email: 'b@x.ch', reference_number: 'REG-2', member: null, vorname: 'B', nachname: 'X' },
  ]
  const run = async (role, key, req) => {
    const tables = {
      members: [
        { id: 1, user: 'u', role: JSON.stringify(role) },
        { id: 10, first_name: 'V', last_name: 'X', email: 'v@x.ch' },
        { id: 11, first_name: 'B', last_name: 'X', email: 'b@x.ch' },
      ],
      registrations: regs.map((r) => ({ ...r })),
    }
    const call = routerOf((router) => registerRegistration(router,
      { database: fakeDb(tables), logger, services: { MailService: class { async send() {} } }, getSchema: async () => ({}) }))
    return { r: await call(key, { accountability: { user: 'u' }, headers: {}, query: {}, body: {}, ...req }), tables }
  }

  beforeEach(() => {
    findDuplicateCandidates.mockResolvedValue({ level: 'none', candidates: [] })
    buildMergeDiff.mockResolvedValue([])
  })

  describe('POST /registration/:id/request-docs', () => {
    it('a VB board member is refused a basketball registration', async () => {
      const { r } = await run(['vorstand', 'vb_admin'], 'POST /registration/:id/request-docs', { params: { id: '2' } })
      expect(r.statusCode).toBe(403)
    })
    it('… and gets past the gate for a volleyball one', async () => {
      // A VB registration owes no documents — the 400 proves the gate let it through.
      const { r } = await run(['vorstand', 'vb_admin'], 'POST /registration/:id/request-docs', { params: { id: '1' } })
      expect(r.statusCode).toBe(400)
      expect(r.body.code).toBe('nothing_missing')
    })
    it('a board member who is also a full admin is unconfined', async () => {
      const { r } = await run(['vorstand', 'admin'], 'POST /registration/:id/request-docs', { params: { id: '2' } })
      expect(r.statusCode).not.toBe(403)
    })
  })

  describe('POST /registration/docs-request-preview', () => {
    it('renders the sample for a confined board member', async () => {
      const { r } = await run(['vorstand', 'vb_admin'], 'POST /registration/docs-request-preview', { body: {} })
      expect(r.statusCode).toBe(200)
      expect(r.body.sample).toBe(true)
    })
    it('refuses to render another section\'s applicant', async () => {
      const { r } = await run(['vorstand', 'vb_admin'], 'POST /registration/docs-request-preview', { body: { registration_id: 2 } })
      expect(r.statusCode).toBe(403)
    })
  })

  describe('GET /registration/:id/duplicates', () => {
    const candidates = [
      { id: 10, first_name: 'V', last_name: 'X', email: 'v@x.ch', match: 'name', reasons: [] },
      { id: 11, first_name: 'B', last_name: 'X', email: 'b@x.ch', match: 'name', reasons: [] },
    ]
    beforeEach(() => {
      findDuplicateCandidates.mockResolvedValue({ level: 'possible', candidates })
      buildMergeDiff.mockImplementation(async (_db, _reg, c) => [{ key: 'iban', member_value: `IBAN-${c.id}`, registration_value: 'CH1', differs: true, member_empty: false }])
    })

    it('a confined caller sees an other-section candidate by name only', async () => {
      const { r } = await run(['vb_admin'], 'GET /registration/:id/duplicates', { params: { id: '1' } })
      const [own, foreign] = r.body.candidates
      expect(own).toMatchObject({ member_id: 10, email: 'v@x.ch', out_of_scope: false })
      expect(own.diff[0].member_value).toBe('IBAN-10')
      expect(foreign).toMatchObject({ member_id: 11, name: 'B X', email: null, out_of_scope: true })
      expect(foreign.diff[0].member_value).toBeNull()
      expect(foreign.diff[0].registration_value).toBe('CH1')
    })
    it('an unconfined caller sees every value', async () => {
      const { r } = await run(['vorstand', 'admin'], 'GET /registration/:id/duplicates', { params: { id: '1' } })
      expect(r.body.candidates[1].diff[0].member_value).toBe('IBAN-11')
    })
    it('the registration itself is still sport-gated', async () => {
      const { r } = await run(['vorstand', 'vb_admin'], 'GET /registration/:id/duplicates', { params: { id: '2' } })
      expect(r.statusCode).toBe(403)
    })
  })

  describe('POST /registration/:id/merge', () => {
    const merge = (role, regId, memberId) =>
      run(role, 'POST /registration/:id/merge', { params: { id: String(regId) }, body: { member_id: memberId, fields: [] } })

    it('merges into an own-section member', async () => {
      const { r, tables } = await merge(['vb_admin'], 1, 10)
      expect(r.statusCode).toBe(200)
      expect(tables.registrations.find((x) => x.id === 1).member).toBe(10)
    })
    it('refuses an other-section member who is not a candidate, and writes nothing', async () => {
      const { r, tables } = await merge(['vorstand', 'vb_admin'], 1, 11)
      expect(r.statusCode).toBe(403)
      expect(r.body.code).toBe('out_of_scope')
      expect(tables.registrations.find((x) => x.id === 1).member).toBeNull()
    })
    it('allows an other-section member who IS an identity candidate (same person, new sport)', async () => {
      findDuplicateCandidates.mockResolvedValue({ level: 'possible', candidates: [{ id: 11 }] })
      const { r } = await merge(['vb_admin'], 1, 11)
      expect(r.statusCode).toBe(200)
    })
    it('a full admin merges anywhere', async () => {
      const { r } = await merge(['vorstand', 'admin'], 1, 11)
      expect(r.statusCode).toBe(200)
    })
  })
})

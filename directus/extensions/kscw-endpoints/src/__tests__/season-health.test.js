/**
 * GET /kscw/admin/season-health — the runner, not the SQL.
 *
 * The registry is mocked so these tests pin the runner's behaviour (gate,
 * capping, sport bucketing, failure isolation, caching) independently of what
 * the domain modules ship. SQL text is only provable against a database:
 * `npm run health:sql:dev` runs every registry statement on dev.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../error-log.js', () => ({ logErrorToFile: vi.fn(), logAuthDenial: vi.fn() }))
vi.mock('../member-sport.js', () => ({ resolveMemberSportsDetailed: vi.fn() }))
vi.mock('../season-health-checks.js', () => {
  const check = (key, over = {}) => ({
    key, section: 'players', sport: 'both', severity: 'warn', grain: 'player',
    title: `Title ${key}`, description: `Desc ${key}`, sql: `SELECT '${key}' AS k, {{season}} AS season`, ...over,
  })
  return {
    assertRegistry: vi.fn(),
    TABLES: {
      players: 'SELECT 1 AS member_id, {{rollover}} AS r',
      teams: 'SELECT 1 AS team_id, {{today}} AS d',
    },
    CHECKS: [
      check('members_by_resolver', { memberIdColumn: 'member_id' }),
      check('vb_only', { sport: 'vb', section: 'games', grain: 'game' }),
      check('rows_with_sport', { grain: 'team', section: 'teams' }),
      check('club_thing', { grain: 'club', section: 'events' }),
    ],
  }
})

import { logErrorToFile, logAuthDenial } from '../error-log.js'
import { resolveMemberSportsDetailed } from '../member-sport.js'
import { assertRegistry, CHECKS } from '../season-health-checks.js'
import { registerSeasonHealth, ROW_LIMIT, bySport, runPool, CONCURRENCY } from '../season-health.js'

const noopLogger = { child: () => noopLogger, error() {}, warn() {}, info() {}, debug() {} }

function makeRouter() {
  const routes = {}
  const add = (m) => (path, ...h) => { routes[`${m} ${path}`] = h[h.length - 1] }
  return { routes, get: add('GET'), post: add('POST'), patch: add('PATCH'), delete: add('DELETE') }
}

/**
 * knex-shaped fake: members lookup for the gate, `transaction(fn)` handing out a
 * trx whose `raw(sql)` is answered by `respond(sql)`, `schema.hasTable`, and
 * `max({v}).first()` for the register stamps. Every executed statement is
 * recorded in `db.executed` so tests can see the SET LOCALs and the cache.
 */
function makeDb({ members = [], respond = () => [], tables = {}, registers = {} } = {}) {
  const executed = []
  const db = (table) => {
    const w = {}
    return {
      where(k, v) { w[k] = v; return this },
      first() {
        if (table === 'members') {
          return Promise.resolve(members.find((r) => Object.entries(w).every(([k, v]) => r[k] === v)))
        }
        return Promise.resolve(this._max ? { v: registers[table] ?? null } : undefined)
      },
      max() { this._max = true; return this },
    }
  }
  db.executed = executed
  db.transaction = async (fn) => {
    const trx = {
      raw: async (sql) => {
        executed.push(sql)
        if (/^SET LOCAL/.test(sql)) return { rows: [] }
        return { rows: await respond(sql) }
      },
    }
    return fn(trx)
  }
  db.schema = { hasTable: async (name) => tables[name] !== false }
  return db
}

function setup(dbOpts) {
  const router = makeRouter()
  const db = makeDb(dbOpts)
  registerSeasonHealth(router, { database: db, logger: noopLogger })
  const handler = router.routes['GET /admin/season-health']
  expect(handler, 'route registered').toBeTypeOf('function')
  const call = async (accountability, query = {}) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
    await handler({ accountability, query, path: '/admin/season-health', method: 'GET', headers: {} }, res)
    return res
  }
  return { call, db }
}

const MEMBERS = [
  { id: 1, user: 'u-super', role: ['user', 'superuser'] },
  { id: 2, user: 'u-super-str', role: '["user","superuser"]' },     // jsonb has arrived as a string before
  { id: 3, user: 'u-admin', role: ['user', 'admin'] },
  { id: 4, user: 'u-vb', role: '["user","vb_admin"]' },
  { id: 5, user: 'u-plain', role: ['user'] },
  { id: 6, user: 'u-broken', role: '{not json' },
]
const SUPER = { user: 'u-super' }

/** Statement responder: answers by the `'key'` literal each mocked check selects. */
const byKey = (map) => (sql) => {
  const m = sql.match(/SELECT '([a-z_]+)' AS k/)
  const v = m ? map[m[1]] : map.__table
  return typeof v === 'function' ? v() : (v ?? [])
}

beforeEach(() => {
  vi.mocked(logErrorToFile).mockReset()
  vi.mocked(logAuthDenial).mockReset()
  vi.mocked(resolveMemberSportsDetailed).mockReset().mockResolvedValue(new Map())
})

describe('season-health boot', () => {
  it('validates the registry at import time', () => {
    expect(assertRegistry).toHaveBeenCalled()
  })
})

describe('season-health gate', () => {
  it('401s an unauthenticated caller', async () => {
    const { call } = setup({ members: MEMBERS })
    expect((await call({})).code).toBe(401)
    expect((await call(undefined)).code).toBe(401)
  })

  it('403s a plain member, a sport admin, an app admin without the Directus flag, and an unparseable role', async () => {
    const { call } = setup({ members: MEMBERS })
    for (const user of ['u-plain', 'u-vb', 'u-admin', 'u-broken', 'u-nobody']) {
      const res = await call({ user })
      expect(res.code, user).toBe(403)
      expect(res.body.code).toBe('not_superadmin')
    }
    expect(logAuthDenial).toHaveBeenCalledWith('/admin/season-health', expect.anything(), 'superuser_required')
    expect(logAuthDenial).toHaveBeenCalledTimes(5)
  })

  it('admits a superuser (array and string role), and a Directus admin without a member row', async () => {
    const { call } = setup({ members: MEMBERS })
    expect((await call({ user: 'u-super' })).code).toBe(200)
    expect((await call({ user: 'u-super-str' })).code).toBe(200)
    expect((await call({ user: 'u-service', admin: true })).code).toBe(200)
    expect((await call({ user: 'u-admin', admin: true })).code).toBe(200)
    expect(logAuthDenial).not.toHaveBeenCalled()
  })
})

describe('season-health ?check=KEY', () => {
  it('400s an unknown or malformed key', async () => {
    const { call, db } = setup({ members: MEMBERS })
    expect((await call(SUPER, { check: 'nope' })).code).toBe(400)
    expect((await call(SUPER, { check: ['vb_only', 'nope'] })).code).toBe(400)
    // Express's qs parser turns `?check[foo]=bar` into an object, not a string —
    // never mistaken for a legit key, never reaches CHECKS.find with a non-string.
    expect((await call(SUPER, { check: { foo: 'vb_only' } })).code).toBe(400)
    expect(db.executed).toHaveLength(0)
  })

  it('returns that one check with every row, uncapped, and runs nothing else', async () => {
    const rows = Array.from({ length: ROW_LIMIT + 150 }, (_, i) => ({ k: 'vb_only', game_id: i }))
    const { call, db } = setup({ members: MEMBERS, respond: byKey({ vb_only: rows }) })
    const res = await call(SUPER, { check: 'vb_only' })
    expect(res.code).toBe(200)
    expect(res.body.season).toMatch(/^\d{4}\/\d{2}$/)
    expect(res.body.checks).toBeUndefined()
    expect(res.body.check.key).toBe('vb_only')
    expect(res.body.check.count).toBe(ROW_LIMIT + 150)
    expect(res.body.check.rows).toHaveLength(ROW_LIMIT + 150)
    expect(res.body.check.truncated).toBe(false)
    expect(res.body.check.by_sport).toEqual({ volleyball: ROW_LIMIT + 150, basketball: 0, club: 0 })
    // One statement, wrapped in its own read-only, time-boxed transaction.
    const stmts = db.executed.filter((s) => !/^SET LOCAL/.test(s))
    expect(stmts).toHaveLength(1)
    expect(db.executed[0]).toBe('SET LOCAL statement_timeout = 15000')
    expect(db.executed[1]).toBe('SET LOCAL TRANSACTION READ ONLY')
    expect(stmts[0]).toMatch(/'\d{4}\/\d{2}' AS season/)   // {{season}} rendered as a literal
  })
})

describe('season-health full report', () => {
  it('has the documented shape and caps rows at ROW_LIMIT with a truncated flag', async () => {
    const many = Array.from({ length: ROW_LIMIT + 1 }, (_, i) => ({ k: 'vb_only', game_id: i }))
    const { call } = setup({
      members: MEMBERS,
      respond: byKey({ vb_only: many, __table: [{ member_id: 1 }] }),
      registers: {
        sv_vm_check: new Date('2026-09-14T22:00:00Z'),
        basketplan_people: '2026-09-13T10:00:00.000Z',
        clubdesk_export: null,
        finance_imports: new Date('2026-09-01T02:00:00Z'),
      },
    })
    const res = await call(SUPER)
    expect(res.code).toBe(200)
    const b = res.body
    expect(Object.keys(b).sort()).toEqual(['anchors', 'checks', 'generated_at', 'ms', 'players', 'registers', 'season', 'teams'])
    expect(b.anchors).toEqual({
      rollover: expect.stringMatching(/^\d{4}-06-01$/),
      season_start: expect.stringMatching(/^\d{4}-09-01$/),
      season_end: expect.stringMatching(/^\d{4}-05-31$/),
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
    expect(b.registers).toEqual({
      vm_synced_at: '2026-09-14T22:00:00.000Z',
      basketplan_scraped_at: '2026-09-13T10:00:00.000Z',
      clubdesk_imported_at: null,
      finance_synced_at: '2026-09-01T02:00:00.000Z',
    })
    expect(b.players).toEqual([{ member_id: 1 }])
    expect(b.teams).toEqual([{ member_id: 1 }])
    expect(b.checks.map((c) => c.key)).toEqual(CHECKS.map((c) => c.key))
    expect(typeof b.ms).toBe('number')

    const vb = b.checks.find((c) => c.key === 'vb_only')
    expect(Object.keys(vb).sort()).toEqual(['by_sport', 'count', 'description', 'grain', 'key', 'ms', 'rows', 'section', 'severity', 'sport', 'title', 'truncated'])
    expect(vb.count).toBe(ROW_LIMIT + 1)
    expect(vb.rows).toHaveLength(ROW_LIMIT)
    expect(vb.truncated).toBe(true)
    expect(vb.by_sport.volleyball).toBe(ROW_LIMIT + 1)   // counted over the FULL result
    const club = b.checks.find((c) => c.key === 'club_thing')
    expect(club).toMatchObject({ count: 0, rows: [], truncated: false, by_sport: { volleyball: 0, basketball: 0, club: 0 } })
  })

  it('reports null for a register whose table does not exist', async () => {
    const { call } = setup({ members: MEMBERS, tables: { basketplan_people: false }, registers: { sv_vm_check: new Date('2026-09-14T22:00:00Z') } })
    const res = await call(SUPER)
    expect(res.body.registers.basketplan_scraped_at).toBeNull()
    expect(res.body.registers.vm_synced_at).toBe('2026-09-14T22:00:00.000Z')
  })

  it('derives sport per member-grain row through the resolver, once per check, and buckets both/null', async () => {
    vi.mocked(resolveMemberSportsDetailed).mockResolvedValue(new Map([
      ['10', { sport: 'volleyball', source: 'teams' }],
      ['11', { sport: 'basketball', source: 'sektion' }],
      ['12', { sport: 'both', source: 'teams' }],
      ['13', { sport: 'both', source: 'unknown' }],
      // 14 is missing from the map on purpose
    ]))
    const rows = [10, 11, 12, 13, 14].map((id) => ({ k: 'members_by_resolver', member_id: id }))
    rows.push({ k: 'members_by_resolver', member_id: 15, sport: 'basketball' })   // SQL already said
    const withSport = [
      { k: 'rows_with_sport', team_id: 1, sport: 'volleyball' },
      { k: 'rows_with_sport', team_id: 2, sport: 'basketball' },
      { k: 'rows_with_sport', team_id: 3, sport: null },
    ]
    const { call } = setup({ members: MEMBERS, respond: byKey({ members_by_resolver: rows, rows_with_sport: withSport }) })
    const res = await call(SUPER, { refresh: '1' })
    expect(res.code).toBe(200)

    expect(resolveMemberSportsDetailed).toHaveBeenCalledTimes(1)
    expect(resolveMemberSportsDetailed.mock.calls[0][1]).toEqual([10, 11, 12, 13, 14])

    const m = res.body.checks.find((c) => c.key === 'members_by_resolver')
    expect(m.rows.map((r) => [r.member_id, r.sport, r.sport_source])).toEqual([
      [10, 'volleyball', 'teams'],
      [11, 'basketball', 'sektion'],
      [12, 'both', 'teams'],
      [13, null, 'unknown'],
      [14, null, 'unknown'],
      [15, 'basketball', undefined],      // left alone: the SQL carried sport
    ])
    // 'both' lands in both sports; null/unknown lands in club.
    expect(m.by_sport).toEqual({ volleyball: 2, basketball: 3, club: 2 })

    const t = res.body.checks.find((c) => c.key === 'rows_with_sport')
    expect(t.by_sport).toEqual({ volleyball: 1, basketball: 1, club: 1 })
    expect(t.rows[2].sport_source).toBeUndefined()
  })

  it('isolates a throwing statement: that entry is check_failed, the rest and the 200 survive', async () => {
    const { call } = setup({
      members: MEMBERS,
      respond: byKey({
        vb_only: () => { throw new Error('relation "nope" does not exist') },
        __table: () => { throw new Error('boom') },
        club_thing: [{ k: 'club_thing' }],
      }),
    })
    const res = await call(SUPER, { refresh: '1' })
    expect(res.code).toBe(200)
    const failed = res.body.checks.find((c) => c.key === 'vb_only')
    expect(failed).toMatchObject({ error: 'check_failed', count: null, rows: [], truncated: false, by_sport: { volleyball: 0, basketball: 0, club: 0 } })
    expect(typeof failed.ms).toBe('number')
    const ok = res.body.checks.find((c) => c.key === 'club_thing')
    expect(ok.error).toBeUndefined()
    expect(ok.count).toBe(1)
    // Both tables threw too: arrays stay arrays, the failure is named on the side.
    expect(res.body.players).toEqual([])
    expect(res.body.teams).toEqual([])
    expect(res.body.errors).toEqual({ players: 'check_failed', teams: 'check_failed' })
    // Every failure reaches the JSONL log under the endpoint name.
    expect(logErrorToFile).toHaveBeenCalledTimes(3)
    for (const c of logErrorToFile.mock.calls) expect(c[0]).toBe('admin/season-health')
    // The 500 path was not taken: nothing leaked into the body.
    expect(JSON.stringify(res.body)).not.toContain('does not exist')
  })

  it('caches the full report for 120 s, ?refresh=1 bypasses, ?check= is never cached', async () => {
    const { call, db } = setup({ members: MEMBERS, respond: byKey({}) })
    const first = await call(SUPER)
    const perRun = db.executed.length
    expect(perRun).toBe(3 * (CHECKS.length + 2))   // two SET LOCALs + the statement, per table and per check

    const second = await call(SUPER)
    expect(db.executed).toHaveLength(perRun)            // nothing ran
    expect(second.body).toBe(first.body)                // the same payload object
    expect(second.body.generated_at).toBe(first.body.generated_at)

    await call(SUPER, { check: 'vb_only' })
    expect(db.executed).toHaveLength(perRun + 3)        // a drill-down always runs

    const third = await call(SUPER, { refresh: '1' })
    expect(db.executed).toHaveLength(2 * perRun + 3)
    expect(third.body).not.toBe(first.body)

    const fourth = await call(SUPER)
    expect(db.executed).toHaveLength(2 * perRun + 3)    // the refreshed payload is the cached one now
    expect(fourth.body).toBe(third.body)
  })

  it('never lets more than CONCURRENCY statements run at once', async () => {
    let inFlight = 0
    let peak = 0
    const { call } = setup({
      members: MEMBERS,
      respond: async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return []
      },
    })
    await call(SUPER, { refresh: '1' })
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(CONCURRENCY)
  })

  it('coalesces two concurrent full-report requests for the same season into one build', async () => {
    let starts = 0
    const { call, db } = setup({
      members: MEMBERS,
      respond: async () => {
        starts++
        await new Promise((r) => setTimeout(r, 5))
        return []
      },
    })
    // Cache is cold; both requests land before either build finishes.
    const [a, b] = await Promise.all([call(SUPER), call(SUPER)])
    expect(a.code).toBe(200)
    expect(b.code).toBe(200)
    expect(a.body).toBe(b.body)                         // one build served both callers
    expect(db.executed).toHaveLength(3 * (CHECKS.length + 2))   // NOT doubled
    // starts counts every statement (tables + checks), same invariant from the other side.
    expect(starts).toBe(CHECKS.length + 2)

    // A third request, once the build has landed, is served from cache — still no new work.
    const c = await call(SUPER)
    expect(c.body).toBe(a.body)
    expect(db.executed).toHaveLength(3 * (CHECKS.length + 2))
  })

  it('a request while a build is in flight does not see another caller\'s gate failure leak the cache', async () => {
    // Warm the cache as a superuser, then confirm a non-superuser hitting the
    // SAME route afterwards is still gated — the check runs before any cache
    // read, so a 403 never carries the (potentially PII-bearing) cached payload.
    const { call } = setup({ members: MEMBERS, respond: byKey({}) })
    const warm = await call(SUPER)
    expect(warm.code).toBe(200)
    const denied = await call({ user: 'u-plain' })
    expect(denied.code).toBe(403)
    expect(denied.body).toEqual({ error: 'Superuser access required', code: 'not_superadmin' })
    expect(denied.body).not.toHaveProperty('checks')
    expect(denied.body).not.toHaveProperty('players')
  })

  it('answers 500 without echoing the error when something outside a statement blows up', async () => {
    const router = makeRouter()
    const db = makeDb({ members: MEMBERS })
    db.schema.hasTable = async () => { throw new Error('schema introspection exploded') }
    db.transaction = async () => { throw new Error('pool gone') }
    // Registers are guarded individually and tables/checks are isolated, so the
    // report still builds. Force the outer catch via a gate lookup that throws.
    const throwing = (table) => (table === 'members' ? { where() { return this }, first: async () => { throw new Error('members table locked') } } : db(table))
    throwing.transaction = db.transaction
    throwing.schema = db.schema
    registerSeasonHealth(router, { database: throwing, logger: noopLogger })
    const res = { code: 200, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
    await router.routes['GET /admin/season-health']({ accountability: SUPER, query: {}, path: '/admin/season-health', method: 'GET', headers: {} }, res)
    expect(res.code).toBe(500)
    expect(res.body).toEqual({ error: 'Internal error' })
    expect(logErrorToFile).toHaveBeenCalledTimes(1)
  })

  it('never echoes err.message or err.status into the 500 body, even if the thrown error carries them', async () => {
    // Some helpers elsewhere in this codebase throw `Object.assign(new Error(msg), { status: 400 })`
    // for legitimate typed 4xx errors. season-health.js never does that itself, and the outer
    // catch here is a catch-ALL for unexpected failures (gate lookup, pool, schema
    // introspection) — it must stay generic regardless of what shape the error happens to have.
    const router = makeRouter()
    const throwing = (table) => {
      if (table === 'members') {
        return { where() { return this }, first: async () => { throw Object.assign(new Error('leaked secret: connection string postgres://…'), { status: 418 }) } }
      }
      return makeDb({ members: MEMBERS })(table)
    }
    throwing.transaction = makeDb({ members: MEMBERS }).transaction
    throwing.schema = makeDb({ members: MEMBERS }).schema
    registerSeasonHealth(router, { database: throwing, logger: noopLogger })
    const res = { code: 200, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
    await router.routes['GET /admin/season-health']({ accountability: SUPER, query: {}, path: '/admin/season-health', method: 'GET', headers: {} }, res)
    expect(res.code).toBe(500)
    expect(res.body).toEqual({ error: 'Internal error' })
    expect(JSON.stringify(res.body)).not.toContain('leaked secret')
  })
})

describe('season-health helpers', () => {
  it('bySport: both counts twice, null and unknown count as club, rows without a sport key follow the check', () => {
    const rows = [{ sport: 'volleyball' }, { sport: 'basketball' }, { sport: 'both' }, { sport: null }, { sport: 'weird' }, {}]
    expect(bySport(rows, 'both')).toEqual({ volleyball: 2, basketball: 2, club: 3 })
    expect(bySport(rows, 'vb')).toEqual({ volleyball: 3, basketball: 2, club: 2 })
    expect(bySport(rows, 'bb')).toEqual({ volleyball: 2, basketball: 3, club: 2 })
    expect(bySport([], 'both')).toEqual({ volleyball: 0, basketball: 0, club: 0 })
  })

  it('runPool keeps result order and honours the limit', async () => {
    let inFlight = 0
    let peak = 0
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, (10 - i) % 3))
      inFlight--
      return i
    })
    expect(await runPool(tasks, 3)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(peak).toBeLessThanOrEqual(3)
    expect(await runPool([], 3)).toEqual([])
  })
})

/**
 * Unit tests for the public events feed (public-events.js), added with the
 * 2026-07-27 DB review (EVT-01 / EVT-09).
 *
 * The load-bearing invariant is the NULL-proof club-wide detection: the
 * junction events_id columns are nullable, and prod really held rows with
 * events_id=NULL — under the old `whereNotIn('id', subquery)` form a single
 * such row empties the entire feed (`x NOT IN (set containing NULL)` is never
 * true). The fake knex below evaluates NOT IN / NOT EXISTS with SQL's actual
 * three-valued logic, so these tests discriminate between the two forms — a
 * chain-everything mock would pass with either.
 *
 * Hermetic — no real DB or network.
 */
import { describe, it, expect } from 'vitest'
import { registerPublicEvents } from '../public-events.js'

// ─── Fake knex with real SQL semantics for the operators under test ──────────

function makeDb(tables) {
  function builder(table) {
    const state = { table, filters: [], correlation: null, order: null, limit: null, columns: null }

    const exec = () => {
      let rows = (tables[state.table] || []).filter((r) => state.filters.every((f) => f(r)))
      if (state.order) rows = [...rows].sort((a, b) => (String(a[state.order]) < String(b[state.order]) ? -1 : 1))
      if (state.limit != null) rows = rows.slice(0, state.limit)
      if (state.columns) rows = rows.map((r) => Object.fromEntries(state.columns.map((c) => [c, r[c]])))
      return rows
    }

    const chain = {
      _state: state,
      _exec: exec,
      select(...cols) { state.columns = cols.flat(); return chain },
      whereRaw(sql) {
        // Two different jobs share this name. `a.b = c.d` is the correlation for
        // a NOT EXISTS subquery; anything else is a predicate on THIS query — and
        // the only such predicate is the fail-closed invited_roles rule, which is
        // evaluated here with the same semantics Postgres gives it.
        if (/^\s*\w+\.\w+\s*=\s*\w+\.\w+\s*$/.test(sql)) { state.correlation = sql; return chain }
        if (sql.includes('invited_roles')) {
          state.filters.push((r) => {
            const v = r.invited_roles
            if (v == null) return true
            const parsed = typeof v === 'string' ? JSON.parse(v) : v
            return Array.isArray(parsed) && parsed.length === 0
          })
          return chain
        }
        throw new Error(`unsupported whereRaw: ${sql}`)
      },
      orderBy(col) { state.order = col; return chain },
      // `event_type IN (…)` — the axis the Public policy enforces and these feeds
      // did not (finding 6).
      whereIn(col, vals) { state.filters.push((r) => vals.includes(r[col])); return chain },
      limit(n) { state.limit = n; return chain },
      where(col, op, val) {
        if (val === undefined) { const v = op; state.filters.push((r) => r[col] === v) }
        else if (op === '>=') state.filters.push((r) => String(r[col]) >= String(val))
        else throw new Error(`unsupported operator: ${op}`)
        return chain
      },
      // `x NOT IN (subquery)` is never TRUE when the subquery yields a NULL —
      // three-valued logic, the exact trap EVT-01 hit on prod.
      whereNotIn(col, sub) {
        state.filters.push((row) => {
          const vals = sub._exec().map((r) => Object.values(r)[0])
          if (vals.some((v) => v == null)) return false
          return !vals.includes(row[col])
        })
        return chain
      },
      // NOT EXISTS over a correlated subquery: NULL = anything is not TRUE, so
      // NULL junction rows can neither match nor hide an event.
      whereNotExists(sub) {
        state.filters.push((row) => {
          const m = /^(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)$/.exec(sub._state.correlation || '')
          if (!m) throw new Error(`unparsable correlation: ${sub._state.correlation}`)
          const [, , subCol, , outerCol] = m
          return !(tables[sub._state.table] || [])
            .filter((r) => sub._state.filters.every((f) => f(r)))
            .some((r) => r[subCol] != null && r[subCol] === row[outerCol])
        })
        return chain
      },
      then(resolve, reject) { return Promise.resolve(exec()).then(resolve, reject) },
    }
    return chain
  }
  return builder
}

// ─── Endpoint harness ────────────────────────────────────────────────────────

function makeHandler(tables) {
  const routes = {}
  const router = { get: (path, h) => { routes[path] = h }, post: () => {} }
  registerPublicEvents(router, { database: makeDb(tables), logger: { child: () => ({ error: () => {} }) } })
  return routes['/public/events']
}

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    set(k, v) { this.headers[k] = v; return this },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
  }
}

/** Prod-shaped fixture: club-wide events 10+14, team-scoped 11, member-scoped 13, cancelled 12. */
const fixtures = () => ({
  events: [
    { id: 10, title: 'Sommerfest', event_type: 'verein', start_date: '2026-08-01T16:00:00Z', end_date: null, all_day: false, location: 'KWI', description: 'Alle willkommen', signup_url: null, cancelled: false, cancel_reason: null, invited_roles: null },
    { id: 11, title: 'H3 Turnier', event_type: 'tournament', start_date: '2026-08-08T10:00:00Z', end_date: null, all_day: false, location: null, description: null, signup_url: null, cancelled: false, cancel_reason: null, invited_roles: null },
    { id: 12, title: 'Herbstfest', event_type: 'verein', start_date: '2026-09-05T14:00:00Z', end_date: null, all_day: false, location: null, description: null, signup_url: null, cancelled: true, cancel_reason: 'Halle gesperrt', invited_roles: null },
    { id: 13, title: 'Einzeltermin', event_type: 'tournament', start_date: '2026-09-12T09:00:00Z', end_date: null, all_day: false, location: null, description: null, signup_url: null, cancelled: false, cancel_reason: null, invited_roles: null },
    { id: 14, title: 'Generalversammlung', event_type: 'verein', start_date: '2026-10-01T18:00:00Z', end_date: null, all_day: false, location: null, description: null, signup_url: null, cancelled: false, cancel_reason: null, invited_roles: null },
    // Unscoped in both junctions, so the OLD query published all three. Each is
    // excluded by exactly one of the rules finding 6 added.
    { id: 15, title: 'Vorstandssitzung', event_type: 'meeting', start_date: '2026-10-05T19:00:00Z', end_date: null, all_day: false, location: 'Klublokal', description: 'Intern', signup_url: null, cancelled: false, cancel_reason: null, invited_roles: null },
    { id: 16, title: 'Trainerhöck', event_type: 'verein', start_date: '2026-10-09T19:00:00Z', end_date: null, all_day: false, location: null, description: null, signup_url: null, cancelled: false, cancel_reason: null, invited_roles: ['coach'] },
    { id: 17, title: 'Leeres Rollen-Array', event_type: 'verein', start_date: '2026-10-11T19:00:00Z', end_date: null, all_day: false, location: null, description: null, signup_url: null, cancelled: false, cancel_reason: null, invited_roles: [] },
  ],
  // Junction rows as they really looked on prod (EVT-01): NULL-events_id
  // leftovers from before the 021 cascade, next to genuine scoping rows.
  events_teams: [
    { id: 1, events_id: null, teams_id: 92 },
    { id: 2, events_id: null, teams_id: 80 },
    { id: 5, events_id: 11, teams_id: 3 },
  ],
  events_members: [
    { id: 3, events_id: null, members_id: 7 },
    { id: 4, events_id: 13, members_id: 8 },
  ],
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GET /public/events', () => {
  it('junction rows with NULL events_id do not hide club-wide events (EVT-01)', async () => {
    const res = makeRes()
    await makeHandler(fixtures())({ query: {} }, res)
    expect(res.statusCode).toBe(200)
    // 17 joins 10 and 14: an EMPTY invited_roles array is not targeting, so it
    // stays public. Only a populated one withholds.
    expect(res.body.data.map((e) => e.id)).toEqual([10, 14, 17])
  })

  it('excludes event types the Public policy does not grant (finding 6)', async () => {
    // 15 is unscoped in both junctions, so the old two-axis query published this
    // board meeting — title, location and description — to anonymous callers.
    const res = makeRes()
    await makeHandler(fixtures())({ query: {} }, res)
    expect(res.body.data.map((e) => e.id)).not.toContain(15)
  })

  it('excludes ROLE-targeted events, the third audience axis (finding 6)', async () => {
    // invited_roles is a json column, not a junction, so 16 has no rows in
    // either junction and passed both NOT EXISTS checks. Worse, MEMBER_POLICY has
    // no invited_roles branch — so this was unreadable by a logged-in member and
    // public to everyone else.
    const res = makeRes()
    await makeHandler(fixtures())({ query: {} }, res)
    expect(res.body.data.map((e) => e.id)).not.toContain(16)
  })

  it('withholds an invited_roles shape it does not understand (fail-closed)', async () => {
    const f = fixtures()
    f.events.push({ id: 18, title: 'Objekt statt Array', event_type: 'verein', start_date: '2026-10-20T19:00:00Z', end_date: null, all_day: false, location: null, description: null, signup_url: null, cancelled: false, cancel_reason: null, invited_roles: { coach: true } })
    const res = makeRes()
    await makeHandler(f)({ query: {} }, res)
    expect(res.body.data.map((e) => e.id)).not.toContain(18)
  })

  it('the old NOT IN form returns nothing against the same rows (mock sanity)', async () => {
    // Proves the fake knex reproduces the SQL trap, i.e. the endpoint test
    // above would fail if the query ever reverts to bare whereNotIn.
    const db = makeDb(fixtures())
    const rows = await db('events').whereNotIn('id', db('events_teams').select('events_id'))
    expect(rows).toEqual([])
  })

  it('team- and member-scoped events stay excluded', async () => {
    const res = makeRes()
    await makeHandler(fixtures())({ query: {} }, res)
    const ids = res.body.data.map((e) => e.id)
    expect(ids).not.toContain(11)
    expect(ids).not.toContain(13)
  })

  it('cancelled events are excluded (EVT-09)', async () => {
    const res = makeRes()
    await makeHandler(fixtures())({ query: {} }, res)
    expect(res.body.data.map((e) => e.id)).not.toContain(12)
  })

  it('serves only the public field set (no cancelled / cancel_reason leak)', async () => {
    const res = makeRes()
    await makeHandler(fixtures())({ query: {} }, res)
    expect(Object.keys(res.body.data[0]).sort()).toEqual([
      'all_day', 'description', 'end_date', 'event_type', 'id',
      'location', 'signup_url', 'start_date', 'title',
    ])
  })

  it('from/limit still narrow the result', async () => {
    const res = makeRes()
    await makeHandler(fixtures())({ query: { from: '2026-08-05', limit: '1' } }, res)
    expect(res.body.data.map((e) => e.id)).toEqual([14])
  })
})

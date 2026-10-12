/**
 * Unit tests for the iCal feed's events section (ical-feed.js), added with the
 * 2026-07-27 DB review (EVT-01 / EVT-09).
 *
 * Two invariants:
 *   • NULL-proof club-wide detection — the junction events_id columns are
 *     nullable, and prod really held NULL rows; under the old
 *     `whereNotIn('id', subquery)` form one such row emptied the whole events
 *     section (`x NOT IN (set containing NULL)` is never true). The fake knex
 *     evaluates NOT EXISTS with SQL's actual three-valued semantics.
 *   • Cancelled events are EMITTED with RFC 5545 STATUS:CANCELLED (not dropped)
 *     so subscribed calendars retract the entry instead of keeping a stale copy.
 *
 * The events tests request only the events source; the games tests below cover
 * the team filter, including games a team was called up for (2026-10-12).
 * Hermetic — no real DB or network.
 */
import { describe, it, expect } from 'vitest'
import { registerICalFeed, feedFloor } from '../ical-feed.js'

// ─── Fake knex (subset used by the events and games sections) ────────────────

// Postgres coerces '3' = 3 — the team ids arrive from the query string as text.
const same = (a, b) => a != null && b != null && String(a) === String(b)

function makeDb(tables) {
  // A `whereIn` value list, or a subquery builder resolved to its selected column.
  const valuesOf = (vals) => (vals?._state ? vals._exec().map((r) => r[vals._state.cols[0]]) : vals)

  function builder(table) {
    // Each clause carries its connector. AND binds tighter than OR, as in SQL, so
    // `a OR b AND c` is two runs — which is what makes an ungrouped orWhere leak
    // past the date floor, the mistake the games tests guard against.
    const state = { table, clauses: [], correlation: null, order: null, cols: [] }
    const add = (pred, or = false) => { state.clauses.push({ pred, or }) }
    const matches = (row) => {
      const runs = [[]]
      for (const c of state.clauses) {
        if (c.or && runs.at(-1).length) runs.push([])
        runs.at(-1).push(c.pred)
      }
      return runs.some((run) => run.every((p) => p(row)))
    }

    const exec = () => {
      let rows = (tables[state.table] || []).filter(matches)
      if (state.order) rows = [...rows].sort((a, b) => (String(a[state.order]) < String(b[state.order]) ? -1 : 1))
      return rows
    }

    const compare = (col, op, val) => {
      if (op === '=') return (r) => same(r[col], val)
      if (op === '>=') return (r) => r[col] != null && String(r[col]) >= String(val)
      throw new Error(`unsupported operator: ${op}`)
    }
    const whereArgs = (args) => {
      if (typeof args[0] === 'function') {
        // A parenthesised group: its own clause list, evaluated as one predicate.
        const group = builder(state.table)
        args[0](group)
        return (r) => group._matches(r)
      }
      return args.length === 3 ? compare(args[0], args[1], args[2]) : compare(args[0], '=', args[1])
    }
    const inList = (col, vals) => (r) => valuesOf(vals).some((v) => same(r[col], v))

    const chain = {
      _state: state,
      _exec: exec,
      _matches: matches,
      select(...cols) { state.cols = cols.flat(); return chain },
      where(...args) { add(whereArgs(args)); return chain },
      orWhere(...args) { add(whereArgs(args), true); return chain },
      first() { return Promise.resolve(exec()[0]) },
      whereRaw(sql, bindings) {
        // Three different jobs share this name. `a.b = c.d` is the correlation
        // for a NOT EXISTS subquery; the rest are predicates on THIS query.
        // NB: the old mock set `correlation` for every call and applied no
        // filter, so the season floor below was silently untested — it is now
        // evaluated, which is why this throws on anything it does not model
        // rather than quietly passing.
        if (/^\s*\w+\.\w+\s*=\s*\w+\.\w+\s*$/.test(sql)) { state.correlation = sql; return chain }
        if (sql.includes('coalesce(end_date, start_date)')) {
          const floor = String((bindings || [])[0] ?? '')
          // A multi-day event that began before the floor but is still running
          // stays in the feed — that is what the coalesce is for.
          add((r) => String(r.end_date || r.start_date).slice(0, 10) >= floor.slice(0, 10))
          return chain
        }
        if (sql.includes('invited_roles')) {
          add((r) => {
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
      whereIn(col, vals) { add(inList(col, vals)); return chain },
      orWhereIn(col, vals) { add(inList(col, vals), true); return chain },
      // NOT EXISTS over a correlated subquery: NULL = anything is not TRUE, so
      // NULL junction rows can neither match nor hide an event (the EVT-01 trap
      // that the old NOT IN form fell into).
      whereNotExists(sub) {
        add((row) => {
          const m = /^(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)$/.exec(sub._state.correlation || '')
          if (!m) throw new Error(`unparsable correlation: ${sub._state.correlation}`)
          const [, , subCol, , outerCol] = m
          return !(tables[sub._state.table] || []).some((r) => r[subCol] != null && r[subCol] === row[outerCol])
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
  registerICalFeed(router, { database: makeDb(tables), logger: { child: () => ({ error: () => {} }) } })
  return routes['/ical']
}

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    set(k, v) { this.headers[k] = v; return this },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    send(b) { this.body = b; return this },
  }
}

async function feed(tables, query = { source: 'events' }) {
  const res = makeRes()
  await makeHandler(tables)({ query }, res)
  expect(res.statusCode).toBe(200)
  return res.body
}

/** The VEVENT block carrying the given UID. */
function blockOf(body, uid) {
  const block = body.split('BEGIN:VEVENT').find((b) => b.includes(`UID:${uid}`))
  expect(block).toBeDefined()
  return block
}

/**
 * Fixture dates are relative, not literal. They used to be hardcoded 2026-08/09
 * strings, which only passed because the old mock silently ignored the season
 * floor — once the mock started applying it (2026-08-10) every one of them was
 * in the past and dropped out of the feed. Anchoring to "now" keeps these tests
 * about audience scoping, which is what they are for; the floor itself has its
 * own describe block below with its own explicit dates.
 */
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString()

/** Prod-shaped fixture: club-wide events 10+12, team-scoped 11, member-scoped 13; 12 is cancelled. */
const fixtures = () => ({
  events: [
    { id: 10, title: 'Sommerfest', event_type: 'verein', invited_roles: null, start_date: inDays(20), end_date: null, all_day: false, location: 'KWI', description: 'Alle willkommen', cancelled: false, cancel_reason: null },
    { id: 11, title: 'H3 Turnier', event_type: 'tournament', invited_roles: null, start_date: inDays(27), end_date: null, all_day: false, location: null, description: null, cancelled: false, cancel_reason: null },
    { id: 12, title: 'Herbstfest', event_type: 'verein', invited_roles: null, start_date: inDays(55), end_date: null, all_day: false, location: null, description: null, cancelled: true, cancel_reason: 'Halle gesperrt' },
    { id: 13, title: 'Einzeltermin', event_type: 'tournament', invited_roles: null, start_date: inDays(62), end_date: null, all_day: false, location: null, description: null, cancelled: false, cancel_reason: null },
    // Unscoped in both junctions — the old query syndicated both into every
    // subscribed calendar (finding 6).
    { id: 15, title: 'Vorstandssitzung', event_type: 'meeting', invited_roles: null, start_date: inDays(85), end_date: null, all_day: false, location: 'Klublokal', description: 'Intern', cancelled: false, cancel_reason: null },
    { id: 16, title: 'Trainerhöck', event_type: 'verein', invited_roles: ['coach'], start_date: inDays(89), end_date: null, all_day: false, location: null, description: null, cancelled: false, cancel_reason: null },
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

describe('GET /kscw/ical?source=events', () => {
  it('junction rows with NULL events_id do not hide club-wide events (EVT-01)', async () => {
    const body = await feed(fixtures())
    expect(body).toContain('UID:event-10@kscw.ch')
    expect(body).toContain('UID:event-12@kscw.ch')
  })

  it('team- and member-scoped events stay excluded', async () => {
    const body = await feed(fixtures())
    expect(body).not.toContain('UID:event-11@kscw.ch')
    expect(body).not.toContain('UID:event-13@kscw.ch')
  })

  it('cancelled events are emitted with STATUS:CANCELLED, not dropped (EVT-09)', async () => {
    const block = blockOf(await feed(fixtures()), 'event-12@kscw.ch')
    expect(block).toContain('STATUS:CANCELLED')
    expect(block).toContain('SUMMARY:[ABGESAGT] Herbstfest')
    expect(block).toContain('DESCRIPTION:Halle gesperrt')
  })

  it('non-cancelled events carry no STATUS property and an unprefixed title', async () => {
    const block = blockOf(await feed(fixtures()), 'event-10@kscw.ch')
    expect(block).not.toContain('STATUS:')
    expect(block).toContain('SUMMARY:Sommerfest')
    expect(block).toContain('DESCRIPTION:Alle willkommen')
  })

  it('does not syndicate non-public event types (finding 6)', async () => {
    // /kscw/ical needs no token, so this board meeting — with its location and
    // "Intern" description — went into every subscribed calendar.
    const body = await feed(fixtures())
    expect(body).not.toContain('UID:event-15@kscw.ch')
  })

  it('does not syndicate ROLE-targeted events (finding 6)', async () => {
    const body = await feed(fixtures())
    expect(body).not.toContain('UID:event-16@kscw.ch')
  })

  it('still emits cancellations — the scope helper must NOT filter `cancelled`', async () => {
    // Guard on the mistake this refactor actually made: folding `cancelled` into
    // the shared scope silently stops cancellations propagating, leaving the
    // event sitting in every subscriber's calendar forever. The public JSON feed
    // excludes them; this one must not.
    const body = await feed(fixtures())
    expect(body).toContain('UID:event-12@kscw.ch')
    expect(body).toContain('STATUS:CANCELLED')
  })
})

// ─── Called-up games (2026-10-12) ────────────────────────────────────────────

/**
 * A called-up game stays filed under the team that owns the fixture: game 774 is
 * H1's cup tie, played by H3. The feed picked games by `kscw_team` only, so an H3
 * link never matched it — unless it carried a personal token AND that member was
 * on the per-member call-up list. Token-less team links (all of them before
 * 11.07.2026, and every one passed around in a team chat) and coaches, who are
 * never on that list, could not see the game at all.
 */
const day = (n) => inDays(n).slice(0, 10)
const game = (id, kscw_team, n, type = 'home') => ({
  id, kscw_team, date: day(n), time: '20:00:00', type, status: 'scheduled',
  home_team: `Home ${id}`, away_team: `Away ${id}`, league: 'Mobiliar Cup', hall: null,
})

/** H1 = 1, H3 = 3 (successor of archived 2), D1 = 9. Member 50 plays in H3. */
const gameFixtures = () => ({
  teams: [
    { id: 1, name: 'H1', sport: 'volleyball', active: true, team_id: 'vb_1' },
    { id: 2, name: 'H3', sport: 'volleyball', active: false, team_id: 'vb_3' },
    { id: 3, name: 'H3', sport: 'volleyball', active: true, team_id: 'vb_3' },
    { id: 9, name: 'D1', sport: 'volleyball', active: true, team_id: 'vb_9' },
  ],
  games: [
    game(774, 1, 8),          // H1's fixture, H3 called up
    game(775, 3, 10),         // H3's own fixture
    game(776, 9, 12),         // D1's fixture, D1 called up — not H3's business
    game(777, 1, 14),         // H1's fixture, nobody called up
    game(778, 9, 16),         // D1's fixture, member 50 picked by name
    game(770, 1, -400),       // H1's fixture last season, H3 called up
    game(779, 1, 18, 'away'), // H1's away fixture, H3 called up
  ],
  game_guest_teams: [
    { id: 1, game: 774, team: 3 },
    { id: 2, game: 776, team: 9 },
    { id: 3, game: 770, team: 3 },
    { id: 4, game: 779, team: 3 },
  ],
  game_guests: [
    { id: 1, game: 774, member: 50, via_team: 3 },
    { id: 2, game: 778, member: 50, via_team: null },
  ],
  members: [{ id: 50, ical_token: 'tok-50' }],
  halls: [],
})

const uids = (body) => [...body.matchAll(/UID:(\d+)@kscw\.ch/g)].map((m) => Number(m[1])).sort()

describe('GET /kscw/ical?team=… — called-up games', () => {
  it('a token-less team link includes the games that team was called up for', async () => {
    const body = await feed(gameFixtures(), { team: '3' })
    expect(uids(body)).toEqual([774, 775, 779])
  })

  it("does not pick up another team's call-ups or the owner's other fixtures", async () => {
    const body = await feed(gameFixtures(), { team: '3' })
    expect(body).not.toContain('UID:776@kscw.ch')
    expect(body).not.toContain('UID:777@kscw.ch')
  })

  it('call-ups stay under the season floor and the home/away filter', async () => {
    // The OR branch must be parenthesised with the team filter; ungrouped, it
    // would bring back last season's tie (770) and the away game on a home feed.
    const body = await feed(gameFixtures(), { team: '3', source: 'games-home' })
    expect(uids(body)).toEqual([774, 775])
  })

  it("the owning team's feed is unchanged", async () => {
    const body = await feed(gameFixtures(), { team: '1' })
    expect(uids(body)).toEqual([774, 777, 779])
  })

  it('a personal token still adds games the member was picked for by name', async () => {
    const body = await feed(gameFixtures(), { team: '3', token: 'tok-50' })
    expect(uids(body)).toEqual([774, 775, 778, 779])
  })

  it("a pre-rollover link follows the team to this season's call-ups", async () => {
    // Team id 2 is last season's H3; the feed hops it to 3 before matching.
    const body = await feed(gameFixtures(), { team: '2' })
    expect(uids(body)).toEqual([774, 775, 779])
    expect(body).toContain('X-WR-CALNAME:KSC Wiedikon – H3')
  })
})

// ─── Season floor (2026-07-29) ───────────────────────────────────────────────

/**
 * The feed used to be unbounded across every source, so a subscribed calendar
 * accumulated every game, training and — the reason the floor exists — every
 * duty assignment the member had ever been given. Last season's duties kept
 * showing up in members' calendar apps.
 *
 * The cutover itself is no longer implemented here — it comes from season.js,
 * and `src/utils/__tests__/season-parity.test.ts` pins the boundaries across all
 * three JS copies. What is ical-specific, and tested below, is the FLOOR: the
 * earlier of (season start, today), which is what stops the Jun–Aug gap from
 * blanking the feed while still excluding last season.
 */
describe('ical-feed season floor', () => {
  it('inside the season the floor IS the season start, so its history is kept', () => {
    expect(feedFloor('2027-01-15')).toBe('2026-09-01')
    expect(feedFloor('2026-11-02')).toBe('2026-09-01')
  })

  it('in the Jun–Aug gap the floor falls back to today, so August fixtures survive', () => {
    // The season has rolled over but its Sep 1 start is still in the future —
    // flooring at Sep 1 would blank the feed for three months.
    expect(feedFloor('2026-07-29')).toBe('2026-07-29')
    expect(feedFloor('2026-06-01')).toBe('2026-06-01')
    expect(feedFloor('2026-08-31')).toBe('2026-08-31')
  })

  it("excludes last season's final game across the whole summer gap", () => {
    // 2025/26's last game was 2026-05-23. From the Jun 1 cutover onward the
    // floor must sit strictly after it, or last season's duties reappear.
    for (const today of ['2026-06-01', '2026-07-29', '2026-08-31', '2026-09-01']) {
      expect(feedFloor(today) > '2026-05-23').toBe(true)
    }
  })
})

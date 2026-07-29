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
 * Only the events source is requested, so the harness never touches the games/
 * trainings/closures/hall/duties queries. Hermetic — no real DB or network.
 */
import { describe, it, expect } from 'vitest'
import { registerICalFeed, feedFloor } from '../ical-feed.js'

// ─── Fake knex (subset used by the events section) ───────────────────────────

function makeDb(tables) {
  function builder(table) {
    const state = { table, filters: [], correlation: null, order: null }

    const exec = () => {
      let rows = (tables[state.table] || []).filter((r) => state.filters.every((f) => f(r)))
      if (state.order) rows = [...rows].sort((a, b) => (String(a[state.order]) < String(b[state.order]) ? -1 : 1))
      return rows
    }

    const chain = {
      _state: state,
      select() { return chain },
      whereRaw(sql) { state.correlation = sql; return chain },
      orderBy(col) { state.order = col; return chain },
      // NOT EXISTS over a correlated subquery: NULL = anything is not TRUE, so
      // NULL junction rows can neither match nor hide an event (the EVT-01 trap
      // that the old NOT IN form fell into).
      whereNotExists(sub) {
        state.filters.push((row) => {
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

async function feed(tables) {
  const res = makeRes()
  await makeHandler(tables)({ query: { source: 'events' } }, res)
  expect(res.statusCode).toBe(200)
  return res.body
}

/** The VEVENT block carrying the given UID. */
function blockOf(body, uid) {
  const block = body.split('BEGIN:VEVENT').find((b) => b.includes(`UID:${uid}`))
  expect(block).toBeDefined()
  return block
}

/** Prod-shaped fixture: club-wide events 10+12, team-scoped 11, member-scoped 13; 12 is cancelled. */
const fixtures = () => ({
  events: [
    { id: 10, title: 'Sommerfest', start_date: '2026-08-01T16:00:00Z', end_date: null, all_day: false, location: 'KWI', description: 'Alle willkommen', cancelled: false, cancel_reason: null },
    { id: 11, title: 'H3 Turnier', start_date: '2026-08-08T10:00:00Z', end_date: null, all_day: false, location: null, description: null, cancelled: false, cancel_reason: null },
    { id: 12, title: 'Herbstfest', start_date: '2026-09-05T14:00:00Z', end_date: null, all_day: false, location: null, description: null, cancelled: true, cancel_reason: 'Halle gesperrt' },
    { id: 13, title: 'Einzeltermin', start_date: '2026-09-12T09:00:00Z', end_date: null, all_day: false, location: null, description: null, cancelled: false, cancel_reason: null },
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

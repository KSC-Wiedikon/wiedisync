/**
 * POST /kscw/admin/terminplanung/bb/mark-agreed — the refusals, not the happy path.
 *
 * This route writes 'accepted' onto a row that a THIRD PARTY may already have
 * answered, and 'accepted' is the state that says "this game needs nobody at the
 * Spielplansitzung". Every guard here is therefore load-bearing, and every one of
 * them fails silently if it regresses: the row still flips to accepted, the panel
 * still turns green, and the only evidence that a club's decline was overwritten is
 * a `user_logs` line nobody reads until ProBasket asks.
 *
 * So the guards are tested as behaviour rather than trusted as code:
 *   • a guest game is never ours to agree
 *   • a row with no opponent club is refused (migration 280's CHECK would 500 otherwise)
 *   • 'club_proposed' is refused — it has its own Accept button with other semantics
 *   • 'declined' / 'countered' are refused WITHOUT override and honoured WITH it
 *   • an already-accepted row is a no-op, not an error
 *   • a club answering while the modal was open loses nothing (optimistic guard)
 *   • the two name columns carry the two different people
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { registerBasketballPortal } from '../basketball-portal.js'

// ── A knex-shaped fake, only as wide as this module actually uses ────────────
function makeDb(tables, hooks = {}) {
  class QB {
    constructor(name) { this.name = name; this.conds = []; this.inCond = null }
    where(a, b) {
      if (a && typeof a === 'object') for (const [k, v] of Object.entries(a)) this.conds.push([k, v])
      else this.conds.push([a, b])
      return this
    }
    whereIn(k, arr) { this.inCond = [k, arr.map(String)]; return this }
    whereNull(k) { this.conds.push([k, null]); return this }
    orderBy() { return this }
    /** Evaluated lazily, so an update re-reads the CURRENT table state — which is
     *  exactly what makes the optimistic-guard test meaningful. */
    rows() {
      return (tables[this.name] || []).filter((r) =>
        this.conds.every(([k, v]) => (v === null ? r[k] == null : r[k] === v))
        && (!this.inCond || this.inCond[1].includes(String(r[this.inCond[0]]))))
    }
    select() { return Promise.resolve(this.rows().map((r) => ({ ...r }))) }
    first() { const r = this.rows()[0]; return Promise.resolve(r ? { ...r } : undefined) }
    update(patch) { const rs = this.rows(); rs.forEach((r) => Object.assign(r, patch)); return Promise.resolve(rs.length) }
    insert(row) { (tables[this.name] ||= []).push({ ...row }); return Promise.resolve([1]) }
    del() {
      const rs = this.rows()
      tables[this.name] = tables[this.name].filter((r) => !rs.includes(r))
      return Promise.resolve(rs.length)
    }
    then(res, rej) { return this.select().then(res, rej) }
  }
  const db = (name) => new QB(name)
  db.transaction = async (fn) => { await hooks.beforeTransaction?.(); return fn(db) }
  return db
}

function makeRouter() {
  const routes = {}
  const add = (m) => (path, handler) => { routes[`${m} ${path}`] = handler }
  return { routes, get: add('GET'), post: add('POST'), patch: add('PATCH'), delete: add('DELETE') }
}

const noopLogger = {
  child: () => noopLogger,
  error: () => {}, warn: () => {}, info: () => {}, debug: () => {},
}

/** The acting planner: a member with is_spielplaner, which is what canManageBb accepts. */
const PLANNER_USER = 'user-planner'
const baseMembers = () => ([
  { id: 430, user: PLANNER_USER, role: '["user"]', is_spielplaner: true, first_name: 'Philip', last_name: 'Urech', email: 'p@example.invalid' },
  { id: 9, user: 'user-nobody', role: '["user"]', is_spielplaner: false, first_name: 'No', last_name: 'Body', email: 'n@example.invalid' },
])

/** One placed home game, addressed to a club, in whatever state the test needs. */
const game = (id, over = {}) => ({
  id, season: 1, date: '2026-11-06', time: '20:00', hall: 'KWI B',
  kscw_team: 76, opponent: 'Unicorn 02 Basket H2', game_type: 'home',
  opponent_club: 59, proposal_status: 'draft', offered_at: null,
  responded_at: null, responded_by_name: null, responded_by_email: null,
  opponent_note: null, counter_proposals: null, note: null,
  agreed_offline: false, agreed_offline_by_name: null,
  ...over,
})

let tables
let handler
let hooks

function setup(plan) {
  hooks = {}
  tables = { basketball_slot_plan: plan, members: baseMembers(), user_logs: [] }
  const router = makeRouter()
  registerBasketballPortal(router, { database: makeDb(tables, hooks), logger: noopLogger })
  handler = router.routes['POST /admin/terminplanung/bb/mark-agreed']
  expect(handler, 'the route is registered').toBeTypeOf('function')
}

async function call(body, user = PLANNER_USER) {
  const res = {
    code: 200, body: null,
    status(c) { this.code = c; return this },
    json(b) { this.body = b; return this },
  }
  await handler({ body, accountability: { user }, headers: {}, method: 'POST' }, res)
  return res
}

const OK = { season: 1, agreed_with: 'Robert Devcic' }

beforeEach(() => { tables = null; handler = null })

describe('mark-agreed — authorisation and input', () => {
  it('refuses a caller who is neither admin, bb_admin nor Spielplaner', async () => {
    setup([game(5)])
    const res = await call({ ...OK, ids: [5] }, 'user-nobody')
    expect(res.code).toBe(403)
    expect(tables.basketball_slot_plan[0].proposal_status).toBe('draft')
  })

  it('requires a name for who agreed — an agreement with nobody is not evidence', async () => {
    setup([game(5)])
    const res = await call({ season: 1, ids: [5], agreed_with: '   ' })
    expect(res.code).toBe(400)
    expect(res.body.error).toBe('agreed_with required')
    expect(tables.basketball_slot_plan[0].proposal_status).toBe('draft')
  })

  it('refuses ids that are not in the season', async () => {
    setup([game(5)])
    const res = await call({ ...OK, ids: [5, 999] })
    expect(res.code).toBe(400)
    expect(res.body.error).toBe('invalid ids')
  })
})

describe('mark-agreed — what may be agreed', () => {
  it('records a draft and an offered game', async () => {
    setup([game(5), game(6, { proposal_status: 'offered', offered_at: '2026-08-20T10:00:00.000Z' })])
    const res = await call({ ...OK, ids: [5, 6] })
    expect(res.code).toBe(200)
    expect(res.body.updated).toBe(2)
    for (const r of tables.basketball_slot_plan) {
      expect(r.proposal_status).toBe('accepted')
      expect(r.agreed_offline).toBe(true)
      // The two names are two different people, and both are recorded.
      expect(r.responded_by_name).toBe('Robert Devcic')       // at the club
      expect(r.agreed_offline_by_name).toBe('Philip Urech')   // at KSCW
      expect(r.responded_by_email).toBeNull()
      expect(r.responded_at).toBeTruthy()
    }
    // `offered_at` is left alone: it means "published to the portal", which a draft
    // agreed on the phone never was.
    expect(tables.basketball_slot_plan[0].offered_at).toBeNull()
    expect(tables.basketball_slot_plan[1].offered_at).toBe('2026-08-20T10:00:00.000Z')
  })

  it('never touches a guest game — that is another club borrowing our hall', async () => {
    setup([game(5, { game_type: 'guest' })])
    const res = await call({ ...OK, ids: [5] })
    expect(res.code).toBe(400)
    expect(res.body.error).toBe('guest_game_not_offerable')
    expect(tables.basketball_slot_plan[0].proposal_status).toBe('draft')
  })

  it('refuses a game with no opponent club (migration 280 CHECK would reject it)', async () => {
    setup([game(5, { opponent_club: null })])
    const res = await call({ ...OK, ids: [5] })
    expect(res.code).toBe(400)
    expect(res.body.error).toBe('opponent_club required')
    expect(res.body.ids).toEqual([5])
  })

  it('refuses a date the club picked itself — that has its own Accept button', async () => {
    setup([game(5, { proposal_status: 'club_proposed' })])
    const res = await call({ ...OK, ids: [5] })
    expect(res.code).toBe(400)
    expect(res.body.error).toBe('use_club_picks')
    expect(tables.basketball_slot_plan[0].proposal_status).toBe('club_proposed')
  })

  it('treats an already-accepted row as a no-op, not a failure', async () => {
    setup([game(5, { proposal_status: 'accepted', responded_by_name: 'Someone at the club' })])
    const res = await call({ ...OK, ids: [5] })
    expect(res.code).toBe(200)
    expect(res.body.updated).toBe(0)
    expect(res.body.already_agreed).toEqual([5])
    // Untouched: re-submitting a selection must not rewrite an existing agreement.
    expect(tables.basketball_slot_plan[0].responded_by_name).toBe('Someone at the club')
  })
})

describe("mark-agreed — overwriting a club's own answer", () => {
  for (const status of ['declined', 'countered']) {
    it(`refuses a '${status}' row without an explicit override`, async () => {
      setup([game(5, { proposal_status: status, opponent_note: 'Hall taken' })])
      const res = await call({ ...OK, ids: [5] })
      expect(res.code).toBe(400)
      expect(res.body.error).toBe('would_overwrite_club_answer')
      expect(res.body.statuses).toEqual([{ id: 5, status }])
      expect(tables.basketball_slot_plan[0].proposal_status).toBe(status)
    })

    it(`honours a '${status}' row when override is passed`, async () => {
      setup([game(5, { proposal_status: status, opponent_note: 'Hall taken' })])
      const res = await call({ ...OK, ids: [5], override: true })
      expect(res.code).toBe(200)
      expect(res.body.updated).toBe(1)
      expect(tables.basketball_slot_plan[0].proposal_status).toBe('accepted')
      // What the club said in its own words survives — the agreement is added to the
      // record, it does not edit the club's note.
      expect(tables.basketball_slot_plan[0].opponent_note).toBe('Hall taken')
    })
  }

  it('refuses the whole batch when one row needs an override — no partial write', async () => {
    setup([game(5), game(6, { proposal_status: 'declined' })])
    const res = await call({ ...OK, ids: [5, 6] })
    expect(res.code).toBe(400)
    expect(tables.basketball_slot_plan.map((r) => r.proposal_status)).toEqual(['draft', 'declined'])
  })
})

describe('mark-agreed — concurrency and the audit trail', () => {
  it('loses no answer when the club replies while the modal is open', async () => {
    setup([game(5), game(6)])
    // The club answers row 6 between the read and the write. The status guard on the
    // UPDATE must miss it, and the response must SAY so rather than report success.
    hooks.beforeTransaction = () => {
      tables.basketball_slot_plan[1].proposal_status = 'declined'
      tables.basketball_slot_plan[1].responded_by_name = 'The club'
    }
    const res = await call({ ...OK, ids: [5, 6] })
    expect(res.code).toBe(200)
    expect(res.body.updated).toBe(1)
    expect(res.body.skipped).toEqual([{ id: 6, reason: 'changed_meanwhile' }])
    expect(tables.basketball_slot_plan[1].proposal_status).toBe('declined')
    expect(tables.basketball_slot_plan[1].responded_by_name).toBe('The club')
  })

  it('appends the agreement to the row note without destroying what is there', async () => {
    setup([game(5, { note: 'Placed after the DU18 slot moved.' })])
    await call({ ...OK, ids: [5], note: 'They confirm at the Sitzung' })
    const note = tables.basketball_slot_plan[0].note
    expect(note.startsWith('Placed after the DU18 slot moved.\n')).toBe(true)
    expect(note).toContain('agreed offline with Robert Devcic')
    expect(note).toContain('recorded by Philip Urech')
    expect(note).toContain('They confirm at the Sitzung')
    // dd.mm.yyyy, the app-wide Swiss format.
    expect(note).toMatch(/\d{2}\.\d{2}\.\d{4}: agreed offline/)
  })

  it('writes the audit line raw-knex writes would otherwise skip', async () => {
    setup([game(5)])
    await call({ ...OK, ids: [5] })
    expect(tables.user_logs).toHaveLength(1)
    const entry = tables.user_logs[0]
    expect(entry.collection_name).toBe('basketball_slot_plan')
    expect(entry.user).toBe(430)
    expect(JSON.parse(entry.data)).toMatchObject({
      action: 'mark_agreed_offline', season: 1, ids: [5],
      agreed_with: 'Robert Devcic', recorded_by: 'Philip Urech', updated: 1,
    })
  })
})

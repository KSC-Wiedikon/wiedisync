/**
 * POST /kscw/games/:id/hall-source — who may switch a synced game's hall between
 * "Sync" and "Overwrite", and what a switch does (migration 455).
 *
 *   • admins: any game; vb_admin / bb_admin: their own sport only; nobody else;
 *     never while acting for a household member — enforced HERE, not in the UI;
 *   • only VolleyManager / Basketplan games, only rows that carry our hall;
 *   • the write runs with the trigger's GUC, in one transaction;
 *   • the actor lands in user_logs and (while on) on the row;
 *   • a changed court set runs the game→training sweeps and the shared hall calendar
 *     push at once; nothing is ever sent to VolleyManager / Basketplan.
 *
 * The DB is a small fake that answers exactly the queries the route makes and
 * emulates trg_games_0_hall_override's "back to Sync restores synced_*".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const push = vi.hoisted(() => ({ result: null, calls: 0 }))
const sweeps = vi.hoisted(() => ({ calls: [] }))

vi.mock('../gcal-push.js', () => ({
  pushHomeGames: vi.fn(async () => { push.calls++; return push.result }),
}))
vi.mock('../hall-bookings.js', () => ({
  sweepHallBookings: vi.fn(async () => { sweeps.calls.push('hall-bookings') }),
}))
vi.mock('../../../kscw-hooks/src/game-training-shorten.js', () => ({
  sweepGameTrainingShorten: vi.fn(async () => { sweeps.calls.push('game-training-shorten') }),
  sweepGameClashDeclines: vi.fn(async () => { sweeps.calls.push('game-clash-decline') }),
}))

const {
  registerGameHallOverride, canSwitchGameHall, parseHallSourceBody, rowsCarryingOurHall, calendarOutcome,
} = await import('../game-hall-override.js')

const KWI_A = 1, KWI_B = 2, KWI_C = 3, DOELTSCHI = 4

function makeDb({ members = {}, games = [], teams = {} }) {
  const state = { games: games.map((g) => ({ ...g })), updates: [], logs: [], gucs: [], inTrx: false }
  const run = (table) => {
    const q = { table, wheres: [] }
    const matches = (row) => q.wheres.every(([k, v]) => {
      if (k === 'in') return v[1].includes(row[v[0]])
      if (k && typeof k === 'object') return Object.entries(k).every(([kk, vv]) => row[kk] === vv)
      return row[String(k).replace(/^g\./, '')] === v
    })
    const chain = {
      leftJoin: () => chain,
      where: (k, v) => { q.wheres.push([k, v]); return chain },
      whereIn: (k, v) => { q.wheres.push(['in', [k, v]]); return chain },
      first: async () => {
        if (table === 'members') {
          const user = q.wheres[0][0]?.user ?? q.wheres[0][1]
          return members[user] ?? undefined
        }
        if (table === 'directus_users') return undefined
        if (table === 'games as g') {
          const g = state.games.find(matches)
          return g ? { ...g, team_sport: teams[g.kscw_team] ?? null } : undefined
        }
        return undefined
      },
      select: async () => {
        if (table === 'halls') return [KWI_A, KWI_B, KWI_C, DOELTSCHI].map((id) => ({ id }))
        if (table === 'games') return state.games.filter(matches).map((g) => ({ ...g }))
        return []
      },
      update: async (patch) => {
        if (!state.inTrx || !state.gucs.includes('kscw.hall_override_write')) throw new Error('update outside the GUC transaction')
        state.updates.push({ ids: q.wheres[0][1][1], patch })
        for (const g of state.games.filter(matches)) {
          // knex raw column references (`hall = synced_hall`) read the row.
          const resolved = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v && v.__raw ? g[v.__raw] : v]))
          if (resolved.hall_override === true && !g.hall_override) {
            g.synced_hall = g.hall; g.synced_additional_halls = g.additional_halls
          }
          // trg_games_0_hall_override: back to Sync restores the official set.
          if (resolved.hall_override === false && g.hall_override) {
            Object.assign(resolved, { hall: g.synced_hall, additional_halls: g.synced_additional_halls, hall_override_by_name: null, hall_override_at: null })
          }
          Object.assign(g, resolved)
        }
        return 1
      },
      insert: async (row) => { if (table === 'user_logs') state.logs.push(row) },
    }
    return chain
  }
  const db = (table) => run(table)
  db.transaction = async (fn) => {
    state.inTrx = true
    const trx = (table) => run(table)
    trx.raw = (sql, bindings) => {
      if (!bindings) return { __raw: sql } // a column reference inside update()
      state.gucs.push(bindings[0])
      return Promise.resolve({})
    }
    try { return await fn(trx) } finally { state.inTrx = false }
  }
  db.state = state
  return db
}

function makeRouter() {
  const routes = {}
  return { routes, post: (path, fn) => { routes[`POST ${path}`] = fn } }
}
function makeRes() {
  const o = { statusCode: 200 }
  o.status = (c) => { o.statusCode = c; return o }
  o.json = (b) => { o.body = b; return o }
  return o
}
const noop = () => {}
const logger = { child: () => logger, info: noop, warn: noop, error: noop, debug: noop }

const MEMBERS = {
  'u-admin': { id: 1, first_name: 'Ada', last_name: 'Admin', role: '["admin"]' },
  'u-vb': { id: 2, first_name: 'Vera', last_name: 'Volley', role: '["vb_admin","board"]' },
  'u-bb': { id: 3, first_name: 'Bea', last_name: 'Basket', role: ['bb_admin'] },
  'u-coach': { id: 4, first_name: 'Carl', last_name: 'Coach', role: '["user"]' },
}
const TEAMS = { 10: 'volleyball', 20: 'basketball' }
const vbHome = { id: 100, game_id: 'vb_406697', source: 'swiss_volley', type: 'home', kscw_team: 10, hall: KWI_A, additional_halls: null, hall_override: false, synced_hall: KWI_A, synced_additional_halls: null, hall_override_by_name: null, hall_override_at: null }
const bbHome = { id: 200, game_id: 'bb_25-05293', source: 'basketplan', type: 'home', kscw_team: 20, hall: KWI_A, additional_halls: '[]', hall_override: false, synced_hall: KWI_A, synced_additional_halls: '[]', hall_override_by_name: null, hall_override_at: null }

async function call(db, { user = 'u-admin', admin = false, id = 100, body = {}, guardian = null } = {}) {
  const router = makeRouter()
  registerGameHallOverride(router, { database: db, logger })
  const res = makeRes()
  const accountability = user ? { user, admin, ...(guardian ? { kscwGuardian: guardian } : {}) } : null
  await router.routes['POST /games/:id/hall-source']({ params: { id: String(id) }, body, accountability, method: 'POST' }, res)
  return res
}

beforeEach(() => {
  push.calls = 0
  push.result = { created: 0, updated: 1, deleted: 0, dryRun: true, changes: { created: [], updated: ['vb_406697'], deleted: [] } }
  sweeps.calls = []
})

describe('who may switch', () => {
  it('needs a login', async () => {
    const res = await call(makeDb({ members: MEMBERS, games: [vbHome], teams: TEAMS }), { user: null, body: { override: false } })
    expect(res.statusCode).toBe(401)
  })

  it('refuses while acting for a household member, before touching anything', async () => {
    const db = makeDb({ members: MEMBERS, games: [vbHome], teams: TEAMS })
    const res = await call(db, { guardian: { user: 'u-main', memberId: 50 }, body: { override: true, hall: KWI_C } })
    expect(res.statusCode).toBe(403)
    expect(db.state.updates).toHaveLength(0)
  })

  it('refuses a member who is not an admin (a coach of the team included)', async () => {
    const db = makeDb({ members: MEMBERS, games: [vbHome], teams: TEAMS })
    const res = await call(db, { user: 'u-coach', body: { override: true, hall: KWI_C } })
    expect(res.statusCode).toBe(403)
    expect(db.state.updates).toHaveLength(0)
  })

  it('refuses a volleyball admin on a basketball game', async () => {
    const db = makeDb({ members: MEMBERS, games: [bbHome], teams: TEAMS })
    const res = await call(db, { user: 'u-vb', id: 200, body: { override: true, hall: KWI_C } })
    expect(res.statusCode).toBe(403)
    expect(db.state.updates).toHaveLength(0)
  })

  it('lets the basketball admin switch a basketball game', async () => {
    const db = makeDb({ members: MEMBERS, games: [bbHome], teams: TEAMS })
    push.result = { ...push.result, changes: { created: [], updated: ['bb_25-05293'], deleted: [] } }
    const res = await call(db, { user: 'u-bb', id: 200, body: { override: true, hall: KWI_C } })
    expect(res.statusCode).toBe(200)
    expect(res.body.calendar.outcome).toBe('updated')
  })

  it('canSwitchGameHall: the whole matrix', () => {
    expect(canSwitchGameHall('["admin"]', 'basketball')).toBe(true)
    expect(canSwitchGameHall(['superuser'], 'volleyball')).toBe(true)
    expect(canSwitchGameHall(['vb_admin'], 'volleyball')).toBe(true)
    expect(canSwitchGameHall(['vb_admin'], 'basketball')).toBe(false)
    expect(canSwitchGameHall(['bb_admin'], 'volleyball')).toBe(false)
    expect(canSwitchGameHall(['vb_admin', 'bb_admin'], 'basketball')).toBe(true)
    expect(canSwitchGameHall(['board'], 'volleyball')).toBe(false)
    expect(canSwitchGameHall(['user'], 'volleyball')).toBe(false)
    expect(canSwitchGameHall(null, 'volleyball')).toBe(false)
    expect(canSwitchGameHall(null, 'volleyball', { directusAdmin: true })).toBe(true)
    // A game with no club team is club-level ('both'): either sport admin.
    expect(canSwitchGameHall(['bb_admin'], null)).toBe(true)
  })
})

describe('which games', () => {
  it('refuses a game entered in the app (it has no synced hall)', async () => {
    const db = makeDb({ members: MEMBERS, games: [{ ...vbHome, source: 'manual' }], teams: TEAMS })
    const res = await call(db, { body: { override: true, hall: KWI_C } })
    expect(res.statusCode).toBe(400)
    expect(res.body.code).toBe('not_synced')
  })

  it('refuses an away game (the opponent\'s venue is not ours to move)', async () => {
    const db = makeDb({ members: MEMBERS, games: [{ ...vbHome, type: 'away', hall: null, synced_hall: null }], teams: TEAMS })
    const res = await call(db, { body: { override: true, hall: KWI_C } })
    expect(res.statusCode).toBe(400)
    expect(res.body.code).toBe('not_home_game')
  })

  it('switches both rows of an intra-club derby', async () => {
    const away = { ...vbHome, id: 101, type: 'away', kscw_team: 10 }
    const db = makeDb({ members: MEMBERS, games: [vbHome, away], teams: TEAMS })
    const res = await call(db, { body: { override: true, hall: KWI_C } })
    expect(res.statusCode).toBe(200)
    expect(db.state.updates[0].ids).toEqual([100, 101])
    expect(res.body.games.map((g) => g.hall)).toEqual([KWI_C, KWI_C])
  })

  it('rowsCarryingOurHall keeps home rows and a derby\'s away row, not a normal away row', () => {
    expect(rowsCarryingOurHall([
      { id: 1, type: 'home', hall: null },
      { id: 2, type: 'away', hall: KWI_A },
      { id: 3, type: 'away', hall: null, synced_hall: null },
    ]).map((r) => r.id)).toEqual([1, 2])
  })
})

describe('Overwrite', () => {
  it('writes the court set with the GUC, records the actor, then sweeps and pushes the calendar', async () => {
    const db = makeDb({ members: MEMBERS, games: [vbHome], teams: TEAMS })
    const res = await call(db, { body: { override: true, hall: KWI_C } })
    expect(res.statusCode).toBe(200)
    expect(db.state.gucs).toEqual(['kscw.hall_override_write'])
    const { patch } = db.state.updates[0]
    expect(patch).toMatchObject({ hall_override: true, hall: KWI_C, additional_halls: null, hall_override_by_name: 'Ada Admin' })
    expect(patch.hall_override_at).toBeInstanceOf(Date)
    expect(res.body.games[0]).toMatchObject({ hall: KWI_C, synced_hall: KWI_A, hall_override: true })
    const log = JSON.parse(db.state.logs[0].data)
    expect(db.state.logs[0].action).toBe('game_hall_override')
    expect(log).toMatchObject({ game_id: 'vb_406697', from: ['1'], to: ['3'], synced: ['1'], actor_user: 'u-admin' })
    expect(sweeps.calls).toEqual(['game-training-shorten', 'hall-bookings', 'game-clash-decline'])
    expect(push.calls).toBe(1)
    expect(res.body.calendar).toMatchObject({ outcome: 'updated', dryRun: true })
  })

  it('writes the KWI A + B combo as additional halls', async () => {
    const db = makeDb({ members: MEMBERS, games: [vbHome], teams: TEAMS })
    await call(db, { body: { override: true, hall: KWI_A, additional_halls: [KWI_B] } })
    expect(db.state.updates[0].patch).toMatchObject({ hall: KWI_A, additional_halls: '["2"]' })
  })

  it('pinning the hall the game already has switches without moving anything', async () => {
    const db = makeDb({ members: MEMBERS, games: [vbHome], teams: TEAMS })
    const res = await call(db, { body: { override: true, hall: KWI_A } })
    expect(res.statusCode).toBe(200)
    expect(res.body.effectiveChanged).toBe(false)
    expect(db.state.updates).toHaveLength(1)
    expect(sweeps.calls).toEqual([])
    expect(push.calls).toBe(0)
  })

  it('asking for the override it already has changes nothing and keeps the original actor', async () => {
    const db = makeDb({ members: MEMBERS, games: [{ ...vbHome, hall: KWI_C, hall_override: true, hall_override_by_name: 'Vera Volley' }], teams: TEAMS })
    const res = await call(db, { body: { override: true, hall: KWI_C } })
    expect(res.body.unchanged).toBe(true)
    expect(db.state.updates).toHaveLength(0)
    expect(push.calls).toBe(0)
  })

  it('refuses an unknown hall', async () => {
    const db = makeDb({ members: MEMBERS, games: [vbHome], teams: TEAMS })
    const res = await call(db, { body: { override: true, hall: 999 } })
    expect(res.statusCode).toBe(400)
    expect(res.body.code).toBe('invalid_hall')
    expect(db.state.updates).toHaveLength(0)
  })

  it('a busy calendar push is reported as queued (it retries in the background)', async () => {
    vi.useFakeTimers()
    try {
      push.result = { alreadyRunning: true, disabled: false, dryRun: true }
      const db = makeDb({ members: MEMBERS, games: [vbHome], teams: TEAMS })
      const res = await call(db, { body: { override: true, hall: DOELTSCHI } })
      expect(res.body.calendar.outcome).toBe('queued')
      push.result = { created: 0, updated: 0, deleted: 1, dryRun: true, changes: { created: [], updated: [], deleted: ['vb_406697'] } }
      await vi.advanceTimersByTimeAsync(20_000)
      expect(push.calls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('back to Sync', () => {
  it('restores the official hall at once and pushes the calendar', async () => {
    const db = makeDb({
      members: MEMBERS,
      games: [{ ...vbHome, hall: DOELTSCHI, hall_override: true, synced_hall: KWI_A, hall_override_by_name: 'Ada Admin', hall_override_at: new Date() }],
      teams: TEAMS,
    })
    push.result = { created: 1, updated: 0, deleted: 0, dryRun: true, changes: { created: ['vb_406697'], updated: [], deleted: [] } }
    const res = await call(db, { user: 'u-vb', body: { override: false } })
    expect(res.statusCode).toBe(200)
    // hall / additional_halls are NAMED (as the synced columns) so the `UPDATE OF hall`
    // triggers — floor claims, duty recheck — fire on the restore too.
    expect(db.state.updates[0].patch).toEqual({
      hall_override: false, date_updated: expect.any(Date),
      hall: { __raw: 'synced_hall' }, additional_halls: { __raw: 'synced_additional_halls' },
    })
    expect(res.body.games[0]).toMatchObject({ hall: KWI_A, hall_override: false, hall_override_by_name: null })
    expect(db.state.logs[0].action).toBe('game_hall_sync')
    expect(res.body.calendar.outcome).toBe('created')
  })

  it('a game already on Sync is left alone', async () => {
    const db = makeDb({ members: MEMBERS, games: [vbHome], teams: TEAMS })
    const res = await call(db, { body: { override: false } })
    expect(res.body.unchanged).toBe(true)
    expect(db.state.updates).toHaveLength(0)
  })
})

describe('pure helpers', () => {
  const halls = [KWI_A, KWI_B, KWI_C]
  it('parseHallSourceBody', () => {
    expect(parseHallSourceBody({ override: false }, halls)).toEqual({ ok: true, override: false })
    expect(parseHallSourceBody({ override: true, hall: '3' }, halls)).toEqual({ ok: true, override: true, hall: 3, extra: [] })
    expect(parseHallSourceBody({ override: true, hall: 1, additional_halls: ['2', 1, 2] }, halls)).toEqual({ ok: true, override: true, hall: 1, extra: [2] })
    expect(parseHallSourceBody({ override: 'yes' }, halls).code).toBe('invalid_override')
    expect(parseHallSourceBody({}, halls).code).toBe('invalid_override')
    expect(parseHallSourceBody({ override: true }, halls).code).toBe('invalid_hall')
    expect(parseHallSourceBody({ override: true, hall: 1, additional_halls: [9] }, halls).code).toBe('invalid_hall')
    expect(parseHallSourceBody({ override: true, hall: 1, additional_halls: 'x' }, halls).code).toBe('invalid_hall')
  })

  it('calendarOutcome', () => {
    const p = { changes: { created: ['a'], updated: ['b'], deleted: ['c'] } }
    expect(calendarOutcome(p, 'a')).toBe('created')
    expect(calendarOutcome(p, 'b')).toBe('updated')
    expect(calendarOutcome(p, 'c')).toBe('deleted')
    expect(calendarOutcome(p, 'd')).toBe('unchanged')
    expect(calendarOutcome({ disabled: true }, 'a')).toBe('disabled')
    expect(calendarOutcome({ alreadyRunning: true }, 'a')).toBe('queued')
    expect(calendarOutcome(null, 'a')).toBe('disabled')
  })
})

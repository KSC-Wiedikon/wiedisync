/**
 * Game result entry (migration 395) — game-result.js's pure decisions, the shared
 * participant window with a NEGATIVE "before" (opens after kickoff), and the POST
 * refusals that must come before anything is written or spawned. Fakes only: no
 * Volleymanager, no child process.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  validateSets, setsEqual, decideSubmit, vmRefreshPatch, pickReports, liveOf, resultWindow,
  registerGameResult, applyVmRefresh, spawnResultPush, dispatchQueuedResultPushes,
  OPENS_AFTER_MS, CLOSES_AFTER_MS,
} from '../game-result.js'
import { authorizeGameParticipant } from '../game-participant.js'
import { claimVmAccount, vmAccountHeldBy } from '../vm-account-lock.js'
import { isSvrzRcBlackout } from '../vm-windows.js'

const S = (...pairs) => pairs.map(([home, away]) => ({ home, away }))

describe('validateSets', () => {
  it('accepts a 3:2 in best of five with a 15-point fifth set', () => {
    const r = validateSets(S([25, 27], [25, 21], [25, 18], [20, 25], [15, 12]), 3)
    expect(r).toMatchObject({ ok: true, home: 3, away: 2, needed: 3 })
  })
  it('accepts deuce sets', () => {
    expect(validateSets(S([31, 29], [25, 23], [26, 24]), 3).ok).toBe(true)
  })
  it('accepts a 2:1 in best of three with a 15-point third set', () => {
    expect(validateSets(S([25, 20], [18, 25], [15, 13]), 2)).toMatchObject({ ok: true, home: 2, away: 1 })
  })
  it('infers the format when needed sets are unknown', () => {
    expect(validateSets(S([25, 20], [25, 20], [25, 20]), null)).toMatchObject({ ok: true, needed: 3 })
    expect(validateSets(S([25, 20], [25, 20]), null)).toMatchObject({ ok: true, needed: 2 })
    expect(validateSets(S([25, 20], [18, 25], [15, 13]), null)).toMatchObject({ ok: true, needed: 2 })
  })
  it('refuses a set not won by two', () => {
    expect(validateSets(S([25, 24], [25, 20], [25, 20]), 3)).toMatchObject({ ok: false })
  })
  it('refuses a winner below 25, or below 15 in the deciding set', () => {
    expect(validateSets(S([24, 20], [25, 20], [25, 20]), 3).ok).toBe(false)
    expect(validateSets(S([25, 20], [20, 25], [25, 20], [20, 25], [14, 12]), 3).ok).toBe(false)
  })
  it('only lets the deciding set end at 15', () => {
    expect(validateSets(S([15, 10], [25, 20], [25, 20]), 3).ok).toBe(false)
  })
  it('refuses a set after the match was decided', () => {
    expect(validateSets(S([25, 20], [25, 20], [25, 20], [25, 20]), 3).ok).toBe(false)
    expect(validateSets(S([25, 20], [25, 20], [25, 20]), 2).ok).toBe(false)
  })
  it('refuses an undecided match', () => {
    expect(validateSets(S([25, 20], [25, 20]), 3).ok).toBe(false)
  })
  it('refuses junk', () => {
    expect(validateSets([], 3).ok).toBe(false)
    expect(validateSets('3:0', 3).ok).toBe(false)
    expect(validateSets(Array(6).fill({ home: 25, away: 0 }), null).ok).toBe(false)
    expect(validateSets(S([25.5, 20], [25, 20], [25, 20]), 3).ok).toBe(false)
    expect(validateSets(S([100, 98], [25, 20], [25, 20]), 3).ok).toBe(false)
    expect(validateSets(S(['25', 20], [25, 20], [25, 20]), 3).ok).toBe(false)
  })
  it('explains the refusal', () => {
    expect(validateSets(S([25, 24], [25, 20], [25, 20]), 3).detail).toMatch(/Set 1/)
  })
})

describe('setsEqual', () => {
  it('compares balls in order', () => {
    expect(setsEqual(S([25, 20], [25, 18]), S([25, 20], [25, 18]))).toBe(true)
    expect(setsEqual(S([25, 20], [25, 18]), S([25, 18], [25, 20]))).toBe(false)
    expect(setsEqual(S([25, 20]), S([25, 20], [25, 18]))).toBe(false)
    expect(setsEqual(null, S([25, 20]))).toBe(false)
  })
})

describe('decideSubmit', () => {
  const ours = S([25, 20], [25, 20], [25, 20])
  const base = { game: { status: 'scheduled' }, sets: ours, opponent: null, force: false, isDerby: false, vmUuid: 'u', vmConfigured: true }

  it('refuses once official', () => {
    expect(decideSubmit({ ...base, game: { status: 'completed' } })).toEqual({ action: 'already_official' })
  })
  it('reports when nobody has', () => {
    expect(decideSubmit(base)).toEqual({ action: 'push', source: 'own' })
  })
  it('confirms when the form equals the opponent report', () => {
    expect(decideSubmit({ ...base, opponent: { sets: ours } })).toEqual({ action: 'push', source: 'confirmed' })
  })
  it('refuses a differing report unless forced — never pushed silently', () => {
    const opponent = { sets: S([25, 20], [25, 20], [25, 22]) }
    expect(decideSubmit({ ...base, opponent })).toEqual({ action: 'conflict' })
    expect(decideSubmit({ ...base, opponent, force: true })).toEqual({ action: 'push', source: 'own' })
  })
  it('skips derby, no VM game, VM not configured — in that order', () => {
    expect(decideSubmit({ ...base, isDerby: true, vmUuid: null })).toMatchObject({ action: 'skip', reason: 'derby' })
    expect(decideSubmit({ ...base, vmUuid: null, vmConfigured: false })).toMatchObject({ action: 'skip', reason: 'no_vm_game' })
    expect(decideSubmit({ ...base, vmConfigured: false })).toMatchObject({ action: 'skip', reason: 'vm_not_configured', source: 'own' })
  })
})

describe('reading VM back', () => {
  const rep = (party, sets) => ({ id: party, party, sets, home: 3, away: 0, updated_at: '2026-09-28T21:57:24Z' })
  const ours = S([25, 20], [25, 20], [25, 20])
  const read = (over = {}) => ({
    reports: [rep('hometeam', ours)], own_party: 'awayteam', official: null, checked_at: '2026-09-28T23:00:00Z', ...over,
  })

  it('takes VM\'s word on our side, else games.type', () => {
    expect(pickReports(read(), { type: 'home' }).opponent?.party).toBe('hometeam')
    expect(pickReports(read({ own_party: null }), { type: 'home' })).toMatchObject({ opponent: null, own: { party: 'hometeam' } })
  })
  it('stores the opponent report and shows it as provisional when we have none', () => {
    const p = vmRefreshPatch({ type: 'away', provisional_home_score: null }, read())
    expect(JSON.parse(p.vm_opponent_report)).toMatchObject({ party: 'hometeam', home: 3, away: 0 })
    expect(p).toMatchObject({ provisional_source: 'opponent', provisional_home_score: 3, provisional_away_score: 0 })
  })
  it('never overwrites our own entry with the opponent\'s', () => {
    const p = vmRefreshPatch({ type: 'away', provisional_home_score: 2, provisional_source: 'own' }, read())
    expect(p.provisional_source).toBeUndefined()
    expect(p.vm_opponent_report).not.toBeNull()
  })
  it('lets VM\'s official result win', () => {
    const official = { sets: ours, home: 3, away: 0 }
    const p = vmRefreshPatch({ type: 'away', provisional_home_score: 2, provisional_source: 'own' }, read({ official }))
    expect(p).toMatchObject({ provisional_source: 'vm_official', provisional_by_name: null })
  })
  it('does not rewrite an unchanged provisional', () => {
    const game = { type: 'away', provisional_home_score: 3, provisional_source: 'opponent', provisional_sets_json: ours }
    expect(vmRefreshPatch(game, read()).provisional_at).toBeUndefined()
  })
  it('clears the opponent report when VM has none', () => {
    expect(vmRefreshPatch({ type: 'home' }, read({ reports: [] })).vm_opponent_report).toBeNull()
  })
})

it('maps the live row (team a = home) and flags a finished match', () => {
  expect(liveOf({ set_results: [{ a: 25, b: 20 }], sets_won_a: 1, sets_won_b: 0, status: 'live', over: false }))
    .toEqual({ sets: [{ home: 25, away: 20 }], home: 1, away: 0, final: false })
  expect(liveOf({ set_results: '[{"a":25,"b":20}]', sets_won_a: 1, sets_won_b: 0, status: 'final' }).final).toBe(true)
  expect(liveOf(null)).toBeNull()
  expect(liveOf({ set_results: [] })).toBeNull()
})

it('opens three hours after kickoff and closes after two weeks', () => {
  const start = Date.UTC(2026, 8, 28, 18, 45)
  expect(resultWindow(start)).toEqual({ opens_at: '2026-09-28T21:45:00.000Z', closes_at: '2026-10-12T18:45:00.000Z' })
  expect(resultWindow(null)).toEqual({ opens_at: null, closes_at: null })
})

// ── Fakes ─────────────────────────────────────────────────────────────────

/**
 * A knex-shaped fake: `database(table)` → a builder whose terminal calls (`first`,
 * `update`, `insert`, `select`, `pluck`) ask `handler(op, table, wheres, arg)`.
 * `wheres` collects the where/whereNot/whereRaw/whereNull/join args.
 */
function fakeDb(handler) {
  const db = (table) => {
    const wheres = []
    const b = {}
    for (const m of ['where', 'whereNot', 'whereRaw', 'whereNull', 'join', 'orderBy', 'limit']) {
      b[m] = (...a) => { wheres.push([m, ...a]); return b }
    }
    for (const op of ['first', 'update', 'insert', 'select', 'pluck']) {
      b[op] = async (...a) => handler(op, table, wheres, op === 'update' || op === 'insert' ? a[0] : a)
    }
    return b
  }
  db.fn = { now: () => 'NOW()' }
  return db
}

const noop = () => {}
const logger = { child: () => logger, info: noop, warn: noop, error: noop, debug: noop }

// Kickoff Mon 28.09.2026 20:45 Zurich = 18:45Z.
const KICKOFF = Date.UTC(2026, 8, 28, 18, 45)
const GAME = {
  id: 541, game_id: 'vb_406208', kscw_team: 7, type: 'home', status: 'scheduled',
  date: '2026-09-28', time: '20:45:00', scorer_member: 12,
}

describe('authorizeGameParticipant with a negative "before"', () => {
  afterEach(() => vi.useRealTimers())

  const db = fakeDb((op, table) => {
    if (table === 'games') return GAME
    if (table === 'teams') return { sport: 'volleyball' }
    if (table === 'members') return { id: 12, first_name: 'Anna', last_name: 'Muster' }
    throw new Error(`unexpected ${op} ${table}`)
  })
  const req = { accountability: { user: 'u-12' }, params: { gameId: '541' } }
  const opts = { beforeMs: -OPENS_AFTER_MS, afterMs: CLOSES_AFTER_MS }
  const at = async (ms) => {
    vi.useFakeTimers()
    vi.setSystemTime(ms)
    return authorizeGameParticipant(db, logger, req, opts)
  }

  it('is closed during and just after the match', async () => {
    expect((await at(KICKOFF + 30 * 60 * 1000)).code).toBe('outside_window')
    expect((await at(KICKOFF + OPENS_AFTER_MS - 1)).code).toBe('outside_window')
  })
  it('opens at +3 h (a home duty member is a participant)', async () => {
    const r = await at(KICKOFF + OPENS_AFTER_MS)
    expect(r.status).toBeUndefined()
    expect(r.game.id).toBe(541)
  })
  it('closes after 14 days', async () => {
    expect((await at(KICKOFF + CLOSES_AFTER_MS)).status).toBeUndefined()
    expect((await at(KICKOFF + CLOSES_AFTER_MS + 1)).code).toBe('outside_window')
  })
  it('lets a full admin through at any time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(KICKOFF - 24 * 60 * 60 * 1000)
    const r = await authorizeGameParticipant(db, logger, { ...req, accountability: { user: 'u-12', admin: true } }, opts)
    expect(r.isAdmin).toBe(true)
  })
  it('caches a positive answer', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(KICKOFF + OPENS_AFTER_MS)
    const cache = new Map()
    await authorizeGameParticipant(db, logger, req, { ...opts, cache })
    expect(cache.get('541:12')).toBeGreaterThan(Date.now())
  })
})

// ── POST refusals ─────────────────────────────────────────────────────────

function makeRouter() {
  const routes = {}
  return new Proxy({ routes }, {
    get(target, prop) {
      if (prop in target) return target[prop]
      return (path, ...handlers) => { routes[`${String(prop).toUpperCase()} ${path}`] = handlers.at(-1) }
    },
  })
}
function makeRes() {
  const o = { statusCode: 200 }
  o.status = (c) => { o.statusCode = c; return o }
  o.json = (b) => { o.body = b; return o }
  return o
}

describe('POST /game-result/:gameId', () => {
  const env = { ...process.env }
  let updates
  let game
  let claimRows

  const db = fakeDb((op, table, wheres, arg) => {
    if (op === 'update') {
      updates.push({ table, wheres, data: arg })
      return wheres.some((w) => w[0] === 'whereRaw') ? claimRows : 1
    }
    if (op === 'insert') return [1]
    if (table === 'games') {
      // the derby probe: another row with our game_id
      if (wheres.some((w) => w[0] === 'whereNot')) return game.__derby ? { id: 999 } : undefined
      return game
    }
    if (table === 'teams') return { sport: 'volleyball' }
    if (table === 'members') return { id: 12, first_name: 'Anna', last_name: 'Muster' }
    if (table === 'svrz_games') return game.__noVm ? undefined : { svrz_persistence_id: 'uuid-1' }
    throw new Error(`unexpected ${op} ${table}`)
  })

  const R = makeRouter()
  registerGameResult(R, { database: db, logger })
  const post = async (body) => {
    const res = makeRes()
    await R.routes['POST /game-result/:gameId']({ accountability: { user: 'u-12', admin: true }, params: { gameId: '541' }, body }, res)
    return res
  }
  const three = S([25, 20], [25, 20], [25, 20])

  beforeEach(() => {
    updates = []
    claimRows = 1
    game = { ...GAME }
    process.env.VM_USERNAME = 'test'
    process.env.VM_PASSWORD = 'test'
    // Outside every svrz_rc window unless a test says otherwise. Date only — the
    // handlers' promises must keep running.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 8, 29, 12, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
    process.env = { ...env }
    globalThis.__kscw_vm_account_holder = null
  })

  it('is registered as GET + POST only', () => {
    expect(Object.keys(R.routes).sort()).toEqual(['GET /game-result/:gameId', 'POST /game-result/:gameId'])
  })
  it('refuses a game that has not been played yet, even for an admin', async () => {
    // Kickoff 28.09 20:45 Zurich; 23:00 Zurich is only 2 h 15 min later.
    vi.setSystemTime(Date.UTC(2026, 8, 28, 21, 0))
    const res = await post({ sets: three })
    expect([res.statusCode, res.body.code]).toEqual([403, 'outside_window'])
    expect(updates).toEqual([])
  })
  it('refuses once the official result is in', async () => {
    game.status = 'completed'
    const res = await post({ sets: three })
    expect([res.statusCode, res.body.code]).toEqual([409, 'already_official'])
    expect(updates).toEqual([])
  })
  it('refuses invalid sets with a detail', async () => {
    const res = await post({ sets: S([25, 24]) })
    expect([res.statusCode, res.body.code]).toEqual([400, 'invalid_sets'])
    expect(res.body.detail).toBeTruthy()
  })
  it('refuses a conflicting report without force and writes nothing', async () => {
    game.vm_opponent_report = { sets: S([25, 20], [25, 20], [25, 23]), home: 3, away: 0, party: 'awayteam' }
    const res = await post({ sets: three })
    expect([res.statusCode, res.body.code]).toEqual([409, 'conflict'])
    expect(res.body.opponent.party).toBe('awayteam')
    expect(updates).toEqual([])
  })
  it('stores a derby as provisional and skips VM without taking the account', async () => {
    game.__derby = true
    globalThis.__kscw_vm_account_holder = { who: 'someone', at: Date.now(), token: 't' }
    const res = await post({ sets: three })
    expect(res.statusCode).toBe(200)
    expect(res.body.vm).toEqual({ status: 'skipped', error: 'derby' })
    expect(updates[0].data).toMatchObject({ provisional_source: 'own', provisional_home_score: 3, vm_result_status: 'skipped' })
  })
  it('skips a game with no VM fixture', async () => {
    game.__noVm = true
    const res = await post({ sets: three })
    expect(res.body.vm).toEqual({ status: 'skipped', error: 'no_vm_game' })
  })
  it('stores and answers 200 skipped when VM is not configured — like every other skip', async () => {
    delete process.env.VM_USERNAME
    const res = await post({ sets: three })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, vm: { status: 'skipped', error: 'vm_not_configured' } })
    expect(res.body.provisional).toMatchObject({ home: 3, away: 0 })
    expect(updates[0].data.vm_result_status).toBe('skipped')
  })
  it('inside an svrz_rc window: stores, queues, takes no account and spawns nothing', async () => {
    vi.setSystemTime(Date.UTC(2026, 8, 29, 22, 30))
    // Somebody else holds the account — a queued submit must not even look at it.
    globalThis.__kscw_vm_account_holder = { who: 'vm_sync', at: Date.now(), token: 't' }
    const res = await post({ sets: three })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, vm: { status: 'pending', error: 'queued_window' } })
    expect(updates).toHaveLength(1)
    expect(updates[0].data).toMatchObject({
      provisional_home_score: 3, vm_result_status: 'pending', vm_result_error: 'queued_window', vm_result_claimed_at: null,
    })
    // …but it still refuses to clobber a push in flight
    expect(updates[0].wheres.some((w) => w[0] === 'whereRaw')).toBe(true)
    expect(vmAccountHeldBy()).toBe('vm_sync')
  })
  it('inside a window, a push already in flight still wins', async () => {
    vi.setSystemTime(Date.UTC(2026, 8, 29, 10, 10))
    claimRows = 0
    const res = await post({ sets: three })
    expect([res.statusCode, res.body.code]).toEqual([409, 'push_running'])
  })
  it('refuses while the shared VM account is busy — before the row is touched', async () => {
    const release = claimVmAccount('vm_sync')
    const res = await post({ sets: three })
    expect([res.statusCode, res.body.code]).toEqual([409, 'vm_account_busy'])
    expect(updates).toEqual([])
    release()
  })
  it('refuses while a push is running and gives the account back', async () => {
    claimRows = 0
    const res = await post({ sets: three })
    expect([res.statusCode, res.body.code]).toEqual([409, 'push_running'])
    expect(updates[0].data.vm_result_status).toBe('pending')
    // released: somebody else can take it at once
    const again = claimVmAccount('next')
    expect(again).toBeTypeOf('function')
    again()
  })
})

// ── GET: svrz_rc window ─────────────────────────────────────────────────────

describe('GET /game-result/:gameId', () => {
  let tables
  const db = fakeDb((op, table, wheres) => {
    tables.push(table)
    if (table === 'games') return wheres.some((w) => w[0] === 'whereNot') ? undefined : { ...GAME }
    if (table === 'teams') return { sport: 'volleyball' }
    if (table === 'members') return { id: 12, first_name: 'Anna', last_name: 'Muster' }
    if (table === 'live_scores') return undefined
    if (table === 'svrz_games') return undefined
    throw new Error(`unexpected ${op} ${table}`)
  })
  const R = makeRouter()
  registerGameResult(R, { database: db, logger })
  const env = { ...process.env }
  beforeEach(() => {
    tables = []
    process.env.VM_USERNAME = 'test'
    process.env.VM_PASSWORD = 'test'
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => { vi.useRealTimers(); process.env = { ...env } })
  const get = async () => {
    const res = makeRes()
    await R.routes['GET /game-result/:gameId']({ accountability: { user: 'u-12' }, params: { gameId: '541' } }, res)
    return res
  }

  it('serves the stored state without a VM read inside an svrz_rc window', async () => {
    vi.setSystemTime(KICKOFF + OPENS_AFTER_MS + 15 * 60 * 1000)   // 22:00Z
    expect(isSvrzRcBlackout(new Date())).toBe(true)
    const res = await get()
    expect(res.body.can_report).toBe(true)
    expect(tables).not.toContain('svrz_games')
  })
  it('looks the VM game up outside a window', async () => {
    vi.setSystemTime(Date.UTC(2026, 8, 29, 12, 0))
    await get()
    expect(tables).toContain('svrz_games')
  })
})

// ── applyVmRefresh: journal always, provisional under a guard ──────────────

describe('applyVmRefresh', () => {
  const ours = S([25, 20], [25, 20], [25, 20])
  const read = (over = {}) => ({
    reports: [{ id: 'h', party: 'hometeam', sets: ours, home: 3, away: 0, updated_at: 'x' }],
    own_party: 'awayteam', official: null, checked_at: '2026-09-28T23:00:00Z', ...over,
  })
  const run = async (game, r, matched = 1) => {
    const calls = []
    const db = fakeDb((op, table, wheres, data) => { calls.push({ wheres, data }); return matched })
    const next = await applyVmRefresh(db, game, r)
    return { calls, next }
  }

  it('writes the journal unconditionally and the opponent score only onto a none/opponent row', async () => {
    const { calls, next } = await run({ id: 541, type: 'away', provisional_home_score: null }, read())
    expect(Object.keys(calls[0].data).sort()).toEqual(['vm_opponent_report', 'vm_result_checked_at'])
    expect(calls[0].wheres).toEqual([['where', 'id', 541]])
    expect(calls[1].data.provisional_source).toBe('opponent')
    expect(calls[1].wheres).toContainEqual(['where', 'status', 'scheduled'])
    expect(calls[1].wheres.find((w) => w[0] === 'whereRaw')[1]).toMatch(/provisional_source IS NULL OR provisional_source = 'opponent'/)
    expect(next.provisional_source).toBe('opponent')
  })
  it('lets VM\'s official result replace anything — but only while scheduled', async () => {
    const { calls } = await run({ id: 541, type: 'away', provisional_home_score: 2, provisional_source: 'own' },
      read({ official: { sets: ours, home: 3, away: 0 } }))
    expect(calls[1].data.provisional_source).toBe('vm_official')
    expect(calls[1].wheres).toContainEqual(['where', 'status', 'scheduled'])
    expect(calls[1].wheres.some((w) => w[0] === 'whereRaw')).toBe(false)
  })
  it('keeps the in-memory game honest when the guard matched nothing (a member submitted meanwhile)', async () => {
    const { next } = await run({ id: 541, type: 'away', provisional_home_score: null }, read(), 0)
    expect(next.provisional_source).toBeUndefined()
    expect(next.vm_opponent_report).toBeTruthy()
  })
})

// ── spawnResultPush / dispatchQueuedResultPushes ───────────────────────────

function fakeSpawn() {
  const calls = []
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter()
    child.unref = () => {}
    calls.push({ cmd, args, opts, child })
    return child
  }
  return { spawn, calls }
}

describe('spawnResultPush', () => {
  let updates
  let claimRows
  const db = fakeDb((op, table, wheres, data) => {
    updates.push({ wheres, data })
    return wheres.some((w) => w[0] === 'whereRaw') ? claimRows : 1
  })
  beforeEach(() => { updates = []; claimRows = 1 })
  afterEach(() => { globalThis.__kscw_vm_account_holder = null })
  const sets = S([25, 20], [25, 20], [25, 20])

  it('hands the worker its sets in SETS_JSON and holds the account until exit', async () => {
    const { spawn, calls } = fakeSpawn()
    const r = await spawnResultPush({ database: db, log: logger, gameId: 541, sets, force: true, spawn })
    expect(r.ok).toBe(true)
    expect(JSON.parse(calls[0].opts.env.SETS_JSON)).toEqual(sets)
    expect(calls[0].opts.env).toMatchObject({ GAME_ID: '541', FORCE: '1' })
    expect(vmAccountHeldBy()).toBe('game-result:push')
    calls[0].child.emit('exit', 0, null)
    expect(await r.exited).toBe(0)
    expect(vmAccountHeldBy()).toBeNull()
    expect(updates).toHaveLength(1)   // the lease only — a clean exit is the worker's to journal
  })
  it('marks a worker that died without finishing failed — only while still pending', async () => {
    const { spawn, calls } = fakeSpawn()
    const r = await spawnResultPush({ database: db, log: logger, gameId: 541, sets, spawn })
    calls[0].child.emit('exit', 137, null)
    await r.exited
    await Promise.resolve()
    const last = updates.at(-1)
    expect(last.data).toEqual({ vm_result_status: 'failed', vm_result_error: 'worker_exit_137', vm_result_claimed_at: null })
    expect(last.wheres).toContainEqual(['where', 'vm_result_status', 'pending'])
    expect(vmAccountHeldBy()).toBeNull()
  })
  it('refuses on a busy account before touching the row', async () => {
    const release = claimVmAccount('vm_sync')
    const { spawn, calls } = fakeSpawn()
    expect(await spawnResultPush({ database: db, log: logger, gameId: 541, sets, spawn })).toMatchObject({ ok: false, code: 'vm_account_busy' })
    expect(updates).toEqual([])
    expect(calls).toEqual([])
    release()
  })
  it('gives the account back when the row is taken', async () => {
    claimRows = 0
    const { spawn } = fakeSpawn()
    expect(await spawnResultPush({ database: db, log: logger, gameId: 541, sets, spawn })).toMatchObject({ ok: false, code: 'push_running' })
    expect(vmAccountHeldBy()).toBeNull()
  })
  it('a spawn that throws: account released, row failed', async () => {
    const spawn = () => { throw new Error('ENOMEM') }
    expect(await spawnResultPush({ database: db, log: logger, gameId: 541, sets, spawn })).toMatchObject({ ok: false, code: 'spawn_failed' })
    expect(updates.at(-1).data.vm_result_error).toBe('spawn_failed')
    expect(vmAccountHeldBy()).toBeNull()
  })
})

describe('dispatchQueuedResultPushes', () => {
  let queue
  let updates
  let selectWheres
  const db = fakeDb((op, table, wheres, data) => {
    if (op === 'select') { selectWheres = wheres; return queue }
    updates.push({ wheres, data })
    return 1
  })
  beforeEach(() => { updates = []; queue = [] })
  afterEach(() => { globalThis.__kscw_vm_account_holder = null })
  const noon = () => new Date(Date.UTC(2026, 8, 29, 12, 0))

  it('does nothing inside a window', async () => {
    queue = [{ id: 1, provisional_sets_json: '[{"home":25,"away":20}]' }]
    const { spawn, calls } = fakeSpawn()
    const r = await dispatchQueuedResultPushes({ database: db, log: logger, spawn, now: () => new Date(Date.UTC(2026, 8, 29, 23, 0)) })
    expect(r).toEqual({ queued: 0, dispatched: 0 })
    expect(calls).toEqual([])
  })
  it('picks only queued, lease-less pending rows, at most `max`', async () => {
    const { spawn } = fakeSpawn()
    await dispatchQueuedResultPushes({ database: db, log: logger, spawn, now: noon, max: 5 })
    expect(selectWheres).toEqual(expect.arrayContaining([
      ['where', 'vm_result_status', 'pending'], ['where', 'vm_result_error', 'queued_window'],
      ['whereNull', 'vm_result_claimed_at'], ['limit', 5],
    ]))
  })
  it('sends them one worker at a time, without FORCE, with the stored sets', async () => {
    queue = [
      { id: 1, provisional_sets_json: '[{"home":25,"away":20},{"home":25,"away":20},{"home":25,"away":20}]' },
      { id: 2, provisional_sets_json: [{ home: 20, away: 25 }, { home: 20, away: 25 }, { home: 20, away: 25 }] },
    ]
    const { spawn, calls } = fakeSpawn()
    const run = dispatchQueuedResultPushes({ database: db, log: logger, spawn, now: noon })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    // the second waits for the first worker's exit (it holds the shared account)
    expect(vmAccountHeldBy()).toBe('game-result:push')
    calls[0].child.emit('exit', 0, null)
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    calls[1].child.emit('exit', 0, null)
    expect(await run).toEqual({ queued: 2, dispatched: 2 })
    expect(calls.map((c) => c.opts.env.FORCE)).toEqual(['', ''])
    expect(JSON.parse(calls[1].opts.env.SETS_JSON)[0]).toEqual({ home: 20, away: 25 })
  })
  it('stops when the shared account is busy — the next hour tries again', async () => {
    queue = [{ id: 1, provisional_sets_json: '[{"home":25,"away":20}]' }, { id: 2, provisional_sets_json: '[{"home":25,"away":20}]' }]
    const release = claimVmAccount('vm_sync')
    const { spawn, calls } = fakeSpawn()
    expect(await dispatchQueuedResultPushes({ database: db, log: logger, spawn, now: noon })).toEqual({ queued: 2, dispatched: 0 })
    expect(calls).toEqual([])
    release()
  })
  it('fails a queued row that has no score to send', async () => {
    queue = [{ id: 7, provisional_sets_json: null }]
    const { spawn, calls } = fakeSpawn()
    await dispatchQueuedResultPushes({ database: db, log: logger, spawn, now: noon })
    expect(calls).toEqual([])
    expect(updates[0].data).toMatchObject({ vm_result_status: 'failed', vm_result_error: 'no_sets' })
  })
})

// ── Eligibility: no VM login for people with no link to the team ─────────────

describe('authorizeGameParticipant — who gets the Einsatzliste consulted', () => {
  afterEach(() => vi.useRealTimers())
  const AWAY = { ...GAME, type: 'away', scorer_member: null }
  const makeDb = ({ squad = false, guest = false, sheet = [], rsvps = [] } = {}) => {
    const seen = []
    const db = fakeDb((op, table) => {
      seen.push(table)
      if (table === 'games') return AWAY
      if (table === 'teams') return op === 'first' ? { sport: 'volleyball', id: 7 } : []
      if (table === 'members') return { id: 12, first_name: 'Anna', last_name: 'Muster' }
      if (table === 'teams_coaches' || table === 'teams_responsibles') return undefined
      if (table === 'game_guest_teams') return []
      if (table === 'member_teams') return squad ? { id: 1 } : undefined
      if (table === 'game_guests') return guest ? { id: 1 } : undefined
      if (table === 'game_rosters') return sheet
      if (table === 'participations') return rsvps
      // loadVmRoster's only step: the list stored at kickoff −45 min (migration 396)
      if (table === 'game_vm_sheets') return undefined
      throw new Error(`unexpected ${op} ${table}`)
    })
    return { db, seen }
  }
  const req = { accountability: { user: 'u-12' }, params: { gameId: '541' } }
  const opts = { beforeMs: -OPENS_AFTER_MS, afterMs: CLOSES_AFTER_MS, vmOnlyForSquad: true }
  const at = () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(KICKOFF + OPENS_AFTER_MS + 60 * 1000) }

  it('a member with no roster row and no call-up never gets the Einsatzliste consulted', async () => {
    at()
    const { db, seen } = makeDb()
    expect((await authorizeGameParticipant(db, logger, req, opts)).code).toBe('not_participant')
    expect(seen).not.toContain('game_vm_sheets')
  })
  it('…but a confirmed RSVP still counts for them', async () => {
    at()
    const { db, seen } = makeDb({ rsvps: [12] })
    expect((await authorizeGameParticipant(db, logger, req, opts)).status).toBeUndefined()
    expect(seen).not.toContain('game_vm_sheets')
  })
  it('a squad member or a called-up guest gets the Einsatzliste consulted', async () => {
    at()
    for (const link of [{ squad: true }, { guest: true }]) {
      const { db, seen } = makeDb(link)
      await authorizeGameParticipant(db, logger, req, opts)
      expect(seen).toContain('game_vm_sheets')
      expect(seen).not.toContain('svrz_games') // stored, never a live VM read
    }
  })
  it('caches a refusal for 2 minutes', async () => {
    at()
    const cache = new Map()
    const first = makeDb()
    await authorizeGameParticipant(first.db, logger, req, { ...opts, cache })
    const second = makeDb({ rsvps: [12] })
    expect((await authorizeGameParticipant(second.db, logger, req, { ...opts, cache })).code).toBe('not_participant')
    expect(second.seen).not.toContain('participations')
    vi.setSystemTime(Date.now() + 2 * 60 * 1000 + 1)
    expect((await authorizeGameParticipant(second.db, logger, req, { ...opts, cache })).status).toBeUndefined()
  })
})

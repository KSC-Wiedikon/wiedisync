/**
 * Phone live scoring (migration 394) — the pure halves of live-scoring.js: the
 * plausibility check on a published score and the short team codes.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanState, shortName, channelFor, registerLiveScoring, boardHolds, liveGameId, BOARD_FRESH_MS } from '../live-scoring.js'

const base = {
  points_a: 12, points_b: 10, sets_won_a: 1, sets_won_b: 0,
  set_results: [{ a: 25, b: 21 }], status: 'live', serving_team: 'left', event: null,
}

describe('cleanState', () => {
  it('accepts a mid-match score and derives period + over', () => {
    const c = cleanState(base)
    expect(c).toMatchObject({ points_a: 12, sets_won_a: 1, period: 2, over: false, status: 'live' })
  })
  it('lets a deuce set run past 25', () => {
    expect(cleanState({ ...base, set_results: [{ a: 31, b: 29, dur: 1800 }] })).not.toBeNull()
  })
  it('refuses a set count that disagrees with the set results', () => {
    expect(cleanState({ ...base, sets_won_a: 2 })).toBeNull()
    expect(cleanState({ ...base, sets_won_b: 1 })).toBeNull()
  })
  it('refuses junk', () => {
    expect(cleanState(null)).toBeNull()
    expect(cleanState({ ...base, points_a: -1 })).toBeNull()
    expect(cleanState({ ...base, points_b: 1.5 })).toBeNull()
    expect(cleanState({ ...base, status: 'over' })).toBeNull()
    expect(cleanState({ ...base, set_results: 'x' })).toBeNull()
    expect(cleanState({ ...base, set_results: Array(6).fill({ a: 25, b: 0 }), sets_won_a: 6 })).toBeNull()
  })
  it('marks a final match over and keeps the last set as the period', () => {
    const c = cleanState({
      ...base, status: 'final', points_a: 25, points_b: 20, sets_won_a: 3,
      set_results: [{ a: 25, b: 21 }, { a: 25, b: 18 }, { a: 25, b: 20 }], event: 'match-end',
    })
    expect(c).toMatchObject({ over: true, period: 3, event: 'match-end' })
  })
})

describe('shortName', () => {
  it('reads our own club as KSCW', () => {
    expect(shortName('KSC Wiedikon H3')).toBe('KSCW')
  })
  it('takes initials, or the start of a single word', () => {
    expect(shortName('VBC Zürich Lions')).toBe('VZL')
    expect(shortName('Volero')).toBe('VOLE')
    expect(shortName('')).toBe('')
  })
})

it('names the channel after the game', () => {
  expect(channelFor(541)).toBe('game-541')
})

describe('who may score — the shared eligibility check', () => {
  afterEach(() => vi.useRealTimers())
  // Any logged-in member can open any game modal, and the check may read the VM
  // Einsatzliste on the SHARED account. Someone with no roster row on the team and no
  // call-up for the game must be decided without it (game-participant.js squadLinked).
  it('never reads Volleymanager for a member with no link to the team', async () => {
    const seen = []
    const db = (table) => {
      seen.push(table)
      const b = {}
      for (const m of ['where', 'whereNot', 'whereRaw', 'join']) b[m] = () => b
      b.first = async () => {
        if (table === 'games') return { id: 541, game_id: 'vb_406208', kscw_team: 7, type: 'away', status: 'scheduled', date: '2026-09-28', time: '20:45:00' }
        if (table === 'teams') return { sport: 'volleyball', id: 7 }
        if (table === 'members') return { id: 12, first_name: 'Anna', last_name: 'Muster' }
        return undefined
      }
      b.select = async () => []
      b.pluck = async () => []
      return b
    }
    const routes = {}
    const router = { get: (p, h) => { routes[`GET ${p}`] = h }, post: (p, h) => { routes[`POST ${p}`] = h } }
    const noop = () => {}
    const logger = { child: () => logger, info: noop, warn: noop, error: noop }
    registerLiveScoring(router, { database: db, logger })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 8, 28, 18, 45))   // kickoff
    let body
    await routes['GET /live-scoring/game/:gameId'](
      { accountability: { user: 'u-12' }, params: { gameId: '541' } },
      { status() { return this }, json(b) { body = b } },
    )
    expect(body).toMatchObject({ can_score: false, code: 'not_participant' })
    expect(seen).toContain('member_teams')
    expect(seen).not.toContain('svrz_games')
  })
})

describe('the hall board holds a game row', () => {
  const now = Date.UTC(2026, 9, 23, 19, 0)
  const at = (msAgo) => new Date(now - msAgo).toISOString()
  it('while it wrote the row in the last ten minutes', () => {
    expect(boardHolds({ source: 'board:kscw', date_updated: at(60_000) }, now)).toBe(true)
    expect(boardHolds({ source: 'board:kscw', date_updated: at(BOARD_FRESH_MS + 1) }, now)).toBe(false)
  })
  it('never for a phone row, an old row or no row', () => {
    expect(boardHolds({ source: 'phone', date_updated: at(1000) }, now)).toBe(false)
    expect(boardHolds({ source: null, date_updated: at(1000) }, now)).toBe(false)
    expect(boardHolds({ source: 'board:kscw', date_updated: null }, now)).toBe(false)
    expect(boardHolds(null, now)).toBe(false)
  })
})

/** A knex stand-in: games by id, and `where('game_id')…where('type')…whereNot('id')` lookups. */
function fakeDb({ games = [], live = {} } = {}) {
  const writes = []
  const db = (table) => {
    const conds = []
    const b = {}
    b.where = (k, v) => { if (typeof k === 'object') for (const [kk, vv] of Object.entries(k)) conds.push([kk, vv]); else conds.push([k, v]); return b }
    b.whereNot = (k, v) => { conds.push([k, v, 'not']); return b }
    for (const m of ['whereRaw', 'join']) b[m] = () => b
    const match = (row) => conds.every(([k, v, not]) => (not ? String(row[k]) !== String(v) : String(row[k]) === String(v)))
    b.first = async () => {
      if (table === 'games') return games.find(match)
      if (table === 'live_scores') { const ch = conds.find(([k]) => k === 'channel')?.[1]; return live[ch] }
      if (table === 'teams') return { sport: 'volleyball', id: 7 }
      if (table === 'members') return { id: 12, first_name: 'Anna', last_name: 'Muster' }
      return undefined
    }
    b.update = (cols) => { writes.push({ table, cols }); return { returning: async () => [{ ...cols }] } }
    b.select = async () => []
    b.pluck = async () => []
    return b
  }
  db.raw = async (sql, params) => { writes.push({ table: 'raw', sql, params }); return { rows: [{ channel: params[0] }] } }
  db.writes = writes
  return db
}

describe('a derby publishes to ONE row: the home copy\'s', () => {
  const home = { id: 800, game_id: 'vb_1', type: 'home' }
  const away = { id: 801, game_id: 'vb_1', type: 'away' }
  it('the away copy resolves to the home copy, every other game to itself', async () => {
    const db = fakeDb({ games: [home, away] })
    expect(await liveGameId(db, away)).toBe(800)
    expect(await liveGameId(db, home)).toBe(800)
    expect(await liveGameId(fakeDb({ games: [{ id: 5, game_id: 'vb_2', type: 'away' }] }), { id: 5, game_id: 'vb_2', type: 'away' })).toBe(5)
    expect(await liveGameId(db, { id: 9, type: 'away', game_id: null })).toBe(9)
  })
})

describe('phones stand down while the board publishes', () => {
  afterEach(() => vi.useRealTimers())
  const kickoff = Date.UTC(2026, 9, 23, 18, 0)
  const game = { id: 455, game_id: 'vb_9', kscw_team: 7, type: 'home', status: 'scheduled', date: '2026-10-23', time: '20:00:00', home_team: 'KSC Wiedikon H3', away_team: 'VBC Einsiedeln H1' }

  function setup(liveRow) {
    const db = fakeDb({ games: [game], live: liveRow ? { 'game-455': liveRow } : {} })
    const routes = {}
    const router = { get: (p, h) => { routes[`GET ${p}`] = h }, post: (p, h) => { routes[`POST ${p}`] = h } }
    const noop = () => {}
    const logger = { child: () => logger, info: noop, warn: noop, error: noop }
    registerLiveScoring(router, { database: db, logger })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(kickoff + 30 * 60_000)
    const call = async (method, body) => {
      const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b } }
      // An admin: eligibility is not what these tests are about.
      await routes[`${method} /live-scoring/game/:gameId`]({ accountability: { user: 'u-1', admin: true }, params: { gameId: '455' }, body }, res)
      return res
    }
    return { db, call }
  }
  const boardRow = (msAgo) => ({ channel: 'game-455', source: 'board:kscw', ts: 5, date_updated: new Date(kickoff + 30 * 60_000 - msAgo).toISOString(), status: 'live' })
  const state = { points_a: 1, points_b: 0, sets_won_a: 0, sets_won_b: 0, set_results: [], status: 'live', serving_team: 'left', event: null }

  it('GET says board_scoring and still hands back the row for "Watch live"', async () => {
    const { call } = setup(boardRow(60_000))
    const res = await call('GET')
    expect(res.body).toMatchObject({ can_score: false, code: 'board_scoring', channel: 'game-455', row: { source: 'board:kscw' } })
    expect(res.body.game).not.toHaveProperty('game_id')
  })

  it('POST is refused 409 board_scoring, nothing written', async () => {
    const { call, db } = setup(boardRow(60_000))
    const res = await call('POST', { base_ts: 5, state })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ code: 'board_scoring', row: { source: 'board:kscw' } })
    expect(db.writes.filter((w) => w.table !== 'user_logs')).toEqual([])
  })

  it('a board quiet for ten minutes hands the row back; the phone marks its write', async () => {
    const { call, db } = setup(boardRow(BOARD_FRESH_MS + 1000))
    expect((await call('GET')).body).toMatchObject({ can_score: true, code: null })
    const res = await call('POST', { base_ts: 5, state })
    expect(res.statusCode).toBe(200)
    const upd = db.writes.find((w) => w.table === 'live_scores')
    expect(upd.cols).toMatchObject({ source: 'phone', game_id: 455 })
  })
})

/**
 * WiePlay score logs: the scoreboard's live_scores snapshots (Directus revisions) and its
 * uploaded live_match_logs turned into one game's events, by team (a = home), with corrections
 * replayed and the running score recomputed; plus GET /kscw/wieplay/v1/score-log.
 */
import crypto from 'crypto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  nameTokens, nameSimilarity, homeOnLeft, zurichToUtcMs, gameWindow, snapshotsToLog,
  matchLogToLog, loadScoreLog, setFinals,
} from '../wieplay-score-log.js'
import { registerWieplayBridge } from '../wieplay-bridge.js'

const GAME = {
  id: 509, date: '2026-10-02', time: '20:00', home: 'KSC Wiedikon H3', away: 'VBC Voléro Zürich Legends (H3)',
  sets: [[25, 27], [26, 24]],
}
const H3 = { name: 'KSC WIEDIKON H3', short: 'KSCW H3' }
const VOL = { name: 'VBC VOLÉRO ZÜRICH LEGENDS (H3)', short: 'VOLÉRO' }
const T0 = Date.UTC(2026, 9, 2, 18, 0, 0)

/**
 * A board snapshot as Directus keeps it (the row after the change): `left`/`right` are the teams
 * on the board's sides, points/sets/timeouts by side, set_results by side.
 */
function snap(i, { left = H3, right = VOL, p = [0, 0], res = [], srv = 'left', to = [0, 0], status = 'live', channel = 'kscw', sets = null, sport = 'volleyball', ts } = {}) {
  const at = T0 + i * 20000
  return {
    id: 1000 + i,
    at: new Date(at + 150),
    data: {
      channel, sport, status, ts: String(ts ?? at), over: status === 'final', side_a: 'left',
      team_a_name: left.name, team_a_short: left.short, team_b_name: right.name, team_b_short: right.short,
      points_a: p[0], points_b: p[1],
      sets_won_a: sets ? sets[0] : res.filter(([a, b]) => a > b).length,
      sets_won_b: sets ? sets[1] : res.filter(([a, b]) => b > a).length,
      timeouts_a: to[0], timeouts_b: to[1], serving_team: srv,
      set_results: res.map(([a, b]) => ({ a, b })),
    },
  }
}

const kinds = (events) => events.map((e) => e.kind)
const points = (events) => events.filter((e) => e.kind === 'point')

describe('team names', () => {
  it('reads KSCW, accents and filler words alike', () => {
    expect([...nameTokens('KSC Wiedikon H3')]).toEqual(['kscw', 'h3'])
    expect([...nameTokens('VBC Voléro Zürich Legends (H3)')]).toEqual(['volero', 'zurich', 'legends', 'h3'])
    expect(nameSimilarity('VOLÉRO', 'VBC Voléro Zürich Legends (H3)')).toBe(1)
    expect(nameSimilarity('KSCW H1', 'KSC Wiedikon H3')).toBe(0.5)
    expect(nameSimilarity('', 'KSCW')).toBe(0)
  })

  it('tells home from away, also in a club derby, and refuses other games', () => {
    const derby = { home: 'KSC Wiedikon H1', away: 'KSC Wiedikon H3' }
    expect(homeOnLeft(['KSC WIEDIKON H1', 'KSCW H1'], ['KSC WIEDIKON H3', 'KSCW H3'], derby)).toBe(true)
    expect(homeOnLeft(['KSCW H3'], ['KSCW H1'], derby)).toBe(false)
    expect(homeOnLeft(['KSCW H3'], ['VOLÉRO'], GAME)).toBe(true)
    expect(homeOnLeft(['VOLÉRO'], ['KSCW H3'], GAME)).toBe(false)
    expect(homeOnLeft(['KSCW H1'], ['VBC Züri Unterland'], GAME)).toBeNull()
    expect(homeOnLeft(['HOME'], ['AWAY'], GAME)).toBeNull()
  })
})

describe('time', () => {
  it('Zurich wall clock to UTC, summer and winter', () => {
    expect(new Date(zurichToUtcMs('2026-10-02', '20:00')).toISOString()).toBe('2026-10-02T18:00:00.000Z')
    expect(new Date(zurichToUtcMs('2026-01-09', '20:00')).toISOString()).toBe('2026-01-09T19:00:00.000Z')
  })

  it('a window around the kickoff, or the whole day without a time', () => {
    const [from, to] = gameWindow(GAME)
    expect(new Date(from).toISOString()).toBe('2026-10-02T15:00:00.000Z')
    expect(new Date(to).toISOString()).toBe('2026-10-02T23:00:00.000Z')
    const [dayFrom] = gameWindow({ ...GAME, time: null })
    expect(new Date(dayFrom).toISOString()).toBe('2026-10-01T22:00:00.000Z')
    expect(gameWindow({ ...GAME, date: null })).toBeNull()
  })
})

describe('snapshotsToLog', () => {
  it('points by team across a change of ends, set finals by team, the match end', () => {
    const rows = [
      snap(0),
      snap(1, { p: [1, 0] }),
      snap(2, { p: [1, 1], srv: 'right' }),
      snap(3, { p: [1, 2], srv: 'right' }),
      // set end: the board keeps the closing score up, then swaps the ends
      snap(4, { p: [1, 3], srv: 'right', res: [[1, 3]] }),
      snap(5, { left: VOL, right: H3, p: [0, 0], res: [[3, 1]], srv: 'right' }),
      snap(6, { left: VOL, right: H3, p: [0, 1], res: [[3, 1]], srv: 'right' }),
      snap(7, { left: VOL, right: H3, p: [0, 2], res: [[3, 1], [0, 2]], srv: 'right', status: 'final' }),
    ]
    const log = snapshotsToLog(rows, GAME)
    expect(log.source).toBe('live_scores_revisions')
    expect(log.board_names).toEqual({ a: 'KSCW H3', b: 'VOLÉRO' })
    expect(points(log.events).map((e) => [e.period, e.side, e.points_a, e.points_b])).toEqual([
      [1, 'a', 1, 0], [1, 'b', 1, 1], [1, 'b', 1, 2], [1, 'b', 1, 3],
      [2, 'a', 1, 0], [2, 'a', 2, 0],
    ])
    expect(setFinals(log.events).map((s) => [s.no, s.a, s.b])).toEqual([[1, 1, 3], [2, 2, 0]])
    const end = log.events.find((e) => e.kind === 'set_end' && e.period === 2)
    expect([end.sets_a, end.sets_b]).toEqual([1, 1])
    expect(kinds(log.events).at(-1)).toBe('match_end')
    // the new set's first server, by team: H3 serves from the right now
    expect(log.events.find((e) => e.kind === 'serve')).toMatchObject({ period: 2, serving: 'a' })
    const second = points(log.events)[1]
    expect(second.board_ms).toBe(T0 + 2 * 20000)
    expect(second.server_ms).toBe(T0 + 2 * 20000 + 150)
  })

  it('a correction takes the point back: replayed, not counted; an undo marker stays', () => {
    const log = snapshotsToLog([
      snap(0), snap(1, { p: [1, 0] }), snap(2, { p: [2, 0] }), snap(3, { p: [1, 0] }), snap(4, { p: [1, 1] }), snap(5, { p: [2, 1] }),
    ], GAME)
    expect(kinds(log.events)).toEqual(['point', 'undo', 'point', 'point'])
    const standing = points(log.events)
    expect(standing.map((e) => e.board_ms)).toEqual([1, 4, 5].map((i) => T0 + i * 20000))
    expect(standing.map((e) => `${e.points_a}:${e.points_b}`)).toEqual(['1:0', '1:1', '2:1'])
  })

  it('a point moved to the other team in one snapshot: undo, then the point', () => {
    const log = snapshotsToLog([snap(0), snap(1, { p: [1, 0] }), snap(2, { p: [0, 1] })], GAME)
    expect(kinds(log.events)).toEqual(['undo', 'point'])
    expect(points(log.events)[0]).toMatchObject({ side: 'b', points_a: 0, points_b: 1 })
  })

  it("a tie between the board's channel and the game's own row goes to the game's row", () => {
    // Two snapshots each: the board row and game-509 (home/away). Which one is read shows in
    // who scored — the board row here says home, the game row says away.
    const log = snapshotsToLog([
      snap(0, { p: [1, 0] }), snap(1, { p: [1, 0], channel: 'game-509' }),
      snap(2, { p: [2, 0] }), snap(3, { p: [1, 1], channel: 'game-509' }),
    ], GAME)
    expect(points(log.events).map((e) => `${e.points_a}:${e.points_b}`)).toEqual(['1:0', '1:1'])
    // More snapshots still win over the name.
    const more = snapshotsToLog([
      snap(0, { p: [1, 0] }), snap(1, { p: [2, 0] }), snap(2, { p: [0, 1], channel: 'game-509' }),
    ], GAME)
    expect(points(more.events).map((e) => `${e.points_a}:${e.points_b}`)).toEqual(['1:0', '2:0'])
  })

  it('several points at once are a jump without times of their own', () => {
    const log = snapshotsToLog([snap(0), snap(1, { p: [4, 0] }), snap(2, { p: [4, 1] })], GAME)
    expect(log.events[0]).toMatchObject({ kind: 'jump', delta: [4, 0], points_a: 4, points_b: 0 })
    expect(points(log.events)[0]).toMatchObject({ points_a: 4, points_b: 1 })
  })

  it('test taps before the match and a board reset are void', () => {
    const log = snapshotsToLog([
      snap(0, { p: [0, 1] }), snap(1, { p: [0, 2] }), snap(2, { p: [0, 3] }), snap(3, { p: [0, 0] }),
      snap(4, { p: [1, 0] }),
    ], GAME)
    expect(kinds(log.events)).toEqual(['reset', 'point'])
    expect(points(log.events)[0]).toMatchObject({ points_a: 1, points_b: 0 })
  })

  it('a timeout counted and taken back; a set count mis-tap is no set', () => {
    const log = snapshotsToLog([
      snap(0), snap(1, { p: [1, 0] }), snap(2, { p: [1, 0], to: [0, 1] }), snap(3, { p: [1, 0], to: [0, 2] }),
      snap(4, { p: [1, 0], to: [0, 1] }), snap(5, { p: [1, 0], to: [0, 1], sets: [0, 1] }),
      snap(6, { p: [1, 0], to: [0, 1], sets: [0, 0] }), snap(7, { p: [2, 0], to: [0, 1] }),
    ], GAME)
    expect(kinds(log.events)).toEqual(['point', 'timeout', 'point'])
    expect(log.events[1]).toMatchObject({ side: 'b', period: 1 })
    expect(setFinals(log.events)).toEqual([])
  })

  it('a set end taken back: the set goes on', () => {
    const log = snapshotsToLog([
      snap(0, { p: [24, 22] }), snap(1, { p: [25, 22], res: [[25, 22]] }), snap(2, { p: [24, 22] }),
      snap(3, { p: [24, 23] }),
    ], GAME)
    expect(setFinals(log.events)).toEqual([])
    expect(log.events.at(-1)).toMatchObject({ kind: 'point', period: 1, side: 'b', points_a: 24, points_b: 23 })
  })

  it('keeps only the game: other teams, idle boards, other channels, other sports', () => {
    const other = { name: 'VBC ZÜRI UNTERLAND', short: 'ZUL' }
    const log = snapshotsToLog([
      snap(0, { left: { name: 'HOME', short: 'HOME' }, right: { name: 'AWAY', short: 'AWAY' }, p: [3, 0] }),
      snap(1, { right: other, p: [5, 0] }),
      snap(2, { p: [9, 9], channel: 'hall-2' }),
      snap(3, { p: [7, 7], status: 'idle' }),
      snap(4, { p: [7, 7], sport: 'basketball' }),
      snap(5), snap(6, { p: [0, 1], srv: 'right' }),
    ], GAME)
    expect(log.snapshots).toBe(2)
    expect(log.channel).toBe('kscw')
    expect(points(log.events).map((e) => `${e.points_a}:${e.points_b}`)).toEqual(['0:1'])
    expect(snapshotsToLog([snap(0, { right: other })], GAME)).toBeNull()
  })
})

describe('matchLogToLog', () => {
  const ev = (el, type, extra = {}) => ({ t: '20:00:00', el, type, score: [0, 0], sets: [0, 0], ...extra })
  const row = {
    channel: 'kscw', match_key: 'k1', game_id: 509, sport: 'volleyball', board_date: '2026-10-02 19:58',
    team_a: 'VOLÉRO', team_b: 'KSCW H3', // a = left at the first rally: the away team here
    events: [
      ev(10.5, 'point', { side: 'a', delta: 1, srv: 'a' }),
      ev(30.2, 'point', { side: 'b', delta: 1, srv: 'b' }),
      ev(31.0, 'point', { side: 'b', delta: -1, srv: 'a' }),
      ev(40.0, 'point', { side: 'b', delta: 1, srv: 'b' }),
      ev(55.0, 'timeout', { side: 'a', delta: 1 }),
      ev(70.0, 'point', { side: 'b', delta: 1, srv: 'b' }),
      ev(70.1, 'set-end', { set: 1, score: [1, 2] }),
      ev(300, 'point', { side: 'b', value: 3 }),
      ev(301, 'match-end'),
    ],
  }

  it('by team (home = a), corrections replayed, the board clock from its start stamp', () => {
    const log = matchLogToLog(row, GAME)
    expect(log).toMatchObject({ source: 'live_match_logs', match_key: 'k1', orientation: 'names', board_names: { a: 'KSCW H3', b: 'VOLÉRO' } })
    expect(points(log.events).map((e) => [e.period, e.side, e.points_a, e.points_b])).toEqual([
      [1, 'b', 0, 1], [1, 'a', 1, 1], [1, 'a', 2, 1],
    ])
    expect(setFinals(log.events).map((s) => [s.no, s.a, s.b])).toEqual([[1, 2, 1]])
    const start = zurichToUtcMs('2026-10-02', '19:58')
    expect(points(log.events)[1].board_ms).toBe(start + 40000)
    expect(log.events.find((e) => e.kind === 'timeout')).toMatchObject({ side: 'b' })
    expect(log.events.find((e) => e.kind === 'jump')).toMatchObject({ period: 2, delta: [3, 0] })
  })

  it('names that say nothing: the set finals against the official ones decide', () => {
    const log = matchLogToLog({ ...row, team_a: 'A', team_b: 'B', events: [ev(1, 'set-end', { set: 1, score: [27, 25] })] }, GAME)
    expect(log.orientation).toBe('sets')
    expect(setFinals(log.events).map((s) => [s.a, s.b])).toEqual([[25, 27]])
    expect(matchLogToLog({ ...row, team_a: 'A', team_b: 'B', events: [] }, GAME)).toBeNull()
  })
})

describe('loadScoreLog', () => {
  const game = async (id) => (id === 509 ? GAME : null)
  const rows = [snap(0), snap(1, { p: [1, 0] })]

  it('a match log filed against the game wins over the snapshots', async () => {
    const found = await loadScoreLog(509, {
      game,
      matchLogs: async () => [{ game_id: 509, board_date: '2026-10-02 19:58', team_a: 'KSCW H3', team_b: 'VOLÉRO', events: [{ el: 1, type: 'point', side: 'a', delta: 1 }] }],
      snapshots: async () => { throw new Error('not needed') },
    })
    expect(found.source).toBe('live_match_logs')
    expect(found).toMatchObject({ version: 1, team_a: GAME.home, team_b: GAME.away, game: { id: 509 } })
  })

  it('else the snapshots in the game window; else none; null for an unknown game', async () => {
    let asked = null
    const found = await loadScoreLog(509, { game, matchLogs: async () => [], snapshots: async (from, to) => { asked = [from, to]; return rows } })
    expect(found.source).toBe('live_scores_revisions')
    expect(asked.map((d) => d.toISOString())).toEqual(['2026-10-02T15:00:00.000Z', '2026-10-02T23:00:00.000Z'])
    const none = await loadScoreLog(509, { game, matchLogs: async () => [], snapshots: async () => [] })
    expect(none).toMatchObject({ source: null, events: [], sets: [] })
    expect(await loadScoreLog(1, { game, matchLogs: async () => [], snapshots: async () => [] })).toBeNull()
  })
})

// ── The route ─────────────────────────────────────────────────────────────────

const TOKEN = 'service-token-for-tests'
const HEADER = 'x-wieplay-service-token'

/** knex stand-in: every query on a table resolves to that table's rows; joins keep the first table. */
function fakeDatabase(tables) {
  return (table) => {
    const rows = tables[table.split(' ')[0]] ?? []
    const q = {}
    for (const m of ['where', 'orWhere', 'whereIn', 'whereBetween', 'join', 'leftJoin', 'orderBy', 'limit', 'select']) q[m] = () => q
    q.first = async () => rows[0]
    q.then = (resolve, reject) => Promise.resolve(rows).then(resolve, reject)
    return q
  }
}

function call(database, query, headers = { [HEADER]: TOKEN }) {
  const routes = new Map()
  const noop = () => {}
  registerWieplayBridge({ get: (path, handler) => routes.set(path, handler) }, {
    database, logger: { child: () => ({ info: noop, warn: noop, error: noop }) },
  })
  const res = {
    statusCode: 200, headers: {}, body: undefined,
    set(k, v) { this.headers[k] = v; return this },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
  }
  return routes.get('/wieplay/v1/score-log')({ query, headers }, res).then(() => res)
}

describe('GET /kscw/wieplay/v1/score-log', () => {
  const saved = { ...process.env }
  beforeEach(() => { process.env.WIEPLAY_SYNC_TOKEN_HASH = crypto.createHash('sha256').update(TOKEN).digest('hex') })
  afterEach(() => { process.env = { ...saved } })

  const games = [{ id: 509, date: '2026-10-02', time: '20:00:00', home_team: GAME.home, away_team: GAME.away, status: 'completed', sets_json: [{ home: 25, away: 27 }] }]

  it('serves the game\'s log from the revisions', async () => {
    const res = await call(fakeDatabase({ games, live_match_logs: [], directus_activity: [snap(0), snap(1, { p: [1, 0] })] }), { game: '509' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['Cache-Control']).toBe('no-store')
    expect(res.body).toMatchObject({ version: 1, source: 'live_scores_revisions', game: { id: 509, time: '20:00', sets: [[25, 27]] } })
    expect(points(res.body.events)).toHaveLength(1)
  })

  it('400 on junk, 404 on an unknown game, 401 without the token', async () => {
    expect((await call(fakeDatabase({}), { game: '1;DROP' })).statusCode).toBe(400)
    expect((await call(fakeDatabase({ games: [] }), { game: '7' })).statusCode).toBe(404)
    expect((await call(fakeDatabase({}), { game: '7' }, {})).statusCode).toBe(401)
  })
})

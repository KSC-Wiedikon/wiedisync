/**
 * WiePlay score logs — the club scoreboard's point-by-point history of one game, for WiePlay
 * to check (and, where it agrees with the official result, fill in) the rally winners and the
 * running score of the game's video (WiePlay docs/PLAN.md §10.10).
 *
 *   GET /kscw/wieplay/v1/score-log?game=<games.id>   service route (wieplay-bridge.js)
 *
 * Two sources, best first:
 *
 * 1. `live_match_logs` (migration 376): the board's own play-by-play, uploaded after the match
 *    (point-hub matchUpload.js). A row filed against the game (`game_id`), else one from the
 *    game's day whose team names match. Times: the board's match clock (`el`, 0.1 s).
 * 2. The `live_scores` revisions: the board PATCHes its one row on every change through the
 *    items API, so Directus keeps one snapshot per change (`directus_revisions.data`, the row
 *    after it; `directus_activity.timestamp`, when it arrived). Only while the board was online,
 *    coalesced (150 ms, latest wins). Taken from the game's time window (kickoff − 3 h to
 *    + 5 h, Zurich time), only snapshots whose two team names match the game's, only the
 *    channel with most of them. Consecutive snapshots are diffed into events.
 *
 * Read-only. Team names and scores only: no person is named anywhere in a score log.
 *
 * The answer is by TEAM, not by side: `a` is the game's home team, `b` its away team, from the
 * first rally to the last (the board projects whoever stands on the left as its "a" and swaps at
 * every change of ends; the names say who is where). A score going down is a correction: the
 * point it takes back is removed (replayed, not counted) and an `undo` marker stays; a jump of
 * several points at once (the board was offline, a double tap, a typed score) is a `jump`, its
 * points have no time of their own. The running score on every event is recomputed after the
 * replay, so it counts exactly the points that stand.
 *
 * Event: { kind, board_ms, server_ms, period, points_a, points_b, sets_a, sets_b, serving,
 *          side?, delta? }
 *   kind     point | jump | undo | reset | set_end | timeout | serve | match_end
 *   board_ms the board's clock (ms epoch; live_match_logs: its start stamp + the match clock)
 *   server_ms when Directus received it (revisions only)
 *   period   the set (1-based); points_* the set's score after the event, sets_* sets won
 *   serving  'a' | 'b' | null after the event; side 'a' | 'b' (point, undo, timeout);
 *   delta    [a, b] points a jump or an undo moved
 */

export const SCORE_LOG_VERSION = 1
const SPORTS = ['volleyball', 'beach']
const MATCH_MIN = 1.5 // both names must match well: the sum of the two similarities
const MATCH_MARGIN = 0.25 // and clearly better than the crossed assignment
const BEFORE_MS = 3 * 3600 * 1000
const AFTER_MS = 5 * 3600 * 1000
const MAX_SNAPSHOTS = 5000
const RESET_MIN_POINTS = 3 // a set's score back to 0:0 from at least this: the board was reset

// Words that say nothing about which team it is.
const GENERIC = new Set(['vbc', 'vc', 'volley', 'volleyball', 'sc', 'tv', 'club', 'de', 'the', 'und', 'and'])

const num = (v) => {
  const n = Number(Array.isArray(v) ? v.length : v)
  return Number.isFinite(n) ? n : 0
}

const parseJson = (value, fallback) => {
  if (typeof value !== 'string') return value ?? fallback
  try { return JSON.parse(value) } catch { return fallback }
}

/** "KSC Wiedikon H3" and "KSCW H3" → {kscw, h3}; accents and punctuation gone. */
export function nameTokens(name) {
  const s = String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/ksc\s+wiedikon/g, 'kscw').replace(/[^a-z0-9]+/g, ' ').trim()
  return new Set(s.split(' ').filter((t) => t && !GENERIC.has(t)))
}

/** Share of the shorter name's words found in the other (0..1). */
export function nameSimilarity(a, b) {
  const A = nameTokens(a)
  const B = nameTokens(b)
  if (!A.size || !B.size) return 0
  let common = 0
  for (const t of A) if (B.has(t)) common++
  return common / Math.min(A.size, B.size)
}

const teamSim = (names, gameName) => Math.max(...names.map((n) => nameSimilarity(n, gameName)), 0)

/**
 * Do the board's two teams (left, right: each [full, short]) name the game's? → true when the
 * home team stands on the left, false when on the right, null when they are not this game's.
 */
export function homeOnLeft(left, right, game) {
  const straight = teamSim(left, game.home) + teamSim(right, game.away)
  const crossed = teamSim(left, game.away) + teamSim(right, game.home)
  if (Math.max(straight, crossed) < MATCH_MIN || Math.abs(straight - crossed) < MATCH_MARGIN) return null
  return straight > crossed
}

/** Wall-clock time in Zurich → ms epoch (DST-aware, no library). */
export function zurichToUtcMs(date, time = '00:00') {
  const [y, m, d] = String(date).split('-').map(Number)
  const [hh, mm] = String(time || '00:00').split(':').map(Number)
  const wall = Date.UTC(y, m - 1, d, hh || 0, mm || 0)
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Zurich', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const offset = (ms) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms
  }
  let utc = wall - offset(wall)
  const again = offset(utc)
  if (wall - again !== utc) utc = wall - again
  return utc
}

/** The snapshots' window around the game: kickoff − 3 h to + 5 h (no time: the whole day). */
export function gameWindow(game) {
  if (!game.date) return null
  if (game.time) {
    const kickoff = zurichToUtcMs(game.date, game.time)
    return [kickoff - BEFORE_MS, kickoff + AFTER_MS]
  }
  const start = zurichToUtcMs(game.date, '00:00')
  return [start, start + 30 * 3600 * 1000]
}

// ── The replay ─────────────────────────────────────────────────────────────────

/**
 * Builds the event list. Points are added as they come; `take(side)` removes the newest point
 * of that side in the current set (a correction); `finish()` recomputes the running score and
 * the sets on every event and drops the internal fields.
 */
class Replay {
  constructor() { this.events = [] }

  push(kind, t, period, extra = {}) {
    const e = { kind, board_ms: t.board_ms, server_ms: t.server_ms, period, ...extra }
    this.events.push(e)
    return e
  }

  /** from → to within one set: a point, a jump, corrections; or a reset of the board. */
  step(from, to, period, t, serving) {
    const da = to[0] - from[0]
    const db = to[1] - from[1]
    if (!da && !db) return false
    if (da < 0 || db < 0) {
      if (!to[0] && !to[1] && from[0] + from[1] >= RESET_MIN_POINTS) {
        // The board went back to 0:0 in the middle of a set: what was scored is void.
        for (const e of this.events) if (e.period === period && (e.kind === 'point' || e.kind === 'jump')) e.void = true
        this.push('reset', t, period, { serving })
        return true
      }
      for (const [i, d] of [[0, da], [1, db]]) {
        for (let k = 0; k < -d; k++) this.take(i, period)
      }
      if (da < 0 || db < 0) {
        this.push('undo', t, period, {
          side: da < 0 ? 'a' : 'b', delta: [Math.min(0, da), Math.min(0, db)], serving,
        })
      }
      const up = [Math.max(0, da), Math.max(0, db)]
      if (up[0] + up[1] === 1) this.push('point', t, period, { side: up[0] ? 'a' : 'b', serving })
      else if (up[0] + up[1] > 1) this.push('jump', t, period, { delta: up, serving })
      return true
    }
    if (da + db === 1) this.push('point', t, period, { side: da ? 'a' : 'b', serving })
    else this.push('jump', t, period, { delta: [da, db], serving })
    return true
  }

  /** Take back the newest standing point of side i (0 a, 1 b) in the set. */
  take(i, period) {
    const side = i === 0 ? 'a' : 'b'
    for (let k = this.events.length - 1; k >= 0; k--) {
      const e = this.events[k]
      if (e.period !== period || e.void) continue
      if (e.kind === 'set_end') return
      if (e.kind === 'point' && e.side === side) { e.void = true; return }
      if (e.kind === 'jump' && e.delta[i] > 0) {
        e.delta = e.delta.map((v, j) => (j === i ? v - 1 : v))
        if (!e.delta[0] && !e.delta[1]) e.void = true
        return
      }
    }
  }

  /** Take back the newest timeout of a side in the set (the board's count went down). */
  untimeout(side, period) {
    for (let k = this.events.length - 1; k >= 0; k--) {
      const e = this.events[k]
      if (e.kind === 'timeout' && e.period === period && e.side === side && !e.void) { e.void = true; return }
    }
  }

  /** Remove the newest set_end (a set end taken back); true when there was one. */
  reopen(period) {
    for (let k = this.events.length - 1; k >= 0; k--) {
      const e = this.events[k]
      if (e.kind === 'set_end' && e.period === period && !e.void) { e.void = true; return true }
    }
    return false
  }

  finish() {
    const out = []
    let period = null
    let score = [0, 0]
    const sets = [0, 0]
    for (const e of this.events) {
      if (e.void) continue
      if (e.period !== period) { period = e.period; score = [0, 0] }
      if (e.kind === 'point') score = e.side === 'a' ? [score[0] + 1, score[1]] : [score[0], score[1] + 1]
      else if (e.kind === 'jump') score = [score[0] + e.delta[0], score[1] + e.delta[1]]
      else if (e.kind === 'set_end') {
        score = [e.final[0], e.final[1]]
        sets[score[0] > score[1] ? 0 : 1] += 1
      } else if (e.kind === 'reset') score = [0, 0]
      const { final, void: _gone, ...rest } = e
      out.push({ ...rest, points_a: score[0], points_b: score[1], sets_a: sets[0], sets_b: sets[1] })
    }
    return out
  }
}

/** The log's set finals, from its set_end events. */
export function setFinals(events) {
  return events.filter((e) => e.kind === 'set_end')
    .map((e) => ({ no: e.period, a: e.points_a, b: e.points_b, board_ms: e.board_ms, server_ms: e.server_ms }))
}

// ── Source 2: the live_scores revisions ─────────────────────────────────────────

const msOf = (value) => {
  if (value == null) return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value))
  return Number.isFinite(ms) ? ms : null
}

/** One snapshot by team (a = home): points, timeouts, closed sets, who serves. */
function view(data, homeLeft) {
  const pick = (left, right) => (homeLeft ? [left, right] : [right, left])
  const results = (parseJson(data.set_results, []) || []).filter((r) => r && typeof r === 'object')
    .map((r) => pick(num(r.a), num(r.b)))
  const points = pick(num(data.points_a), num(data.points_b))
  const last = results[results.length - 1]
  // The board keeps the closing score up for a moment after a set: those points are the
  // closed set's, not the next one's.
  const showsFinal = last && points[0] + points[1] > 0 && points[0] === last[0] && points[1] === last[1]
  const side = data.serving_team === 'left' ? 'left' : data.serving_team === 'right' ? 'right' : null
  return {
    points,
    timeouts: pick(num(data.timeouts_a), num(data.timeouts_b)),
    results,
    set: showsFinal ? results.length : results.length + 1,
    serving: side ? ((side === 'left') === homeLeft ? 'a' : 'b') : null,
    final: data.status === 'final' || data.over === true || data.over === 'true',
  }
}

/**
 * Snapshots ({ id, at, data }, oldest first) of the game's window → the game's events. Keeps
 * only snapshots naming the game's two teams, of the channel with most of them.
 */
export function snapshotsToLog(rows, game) {
  const matching = []
  for (const row of rows) {
    const data = parseJson(row.data, null)
    if (!data || typeof data !== 'object') continue
    if (data.sport && !SPORTS.includes(data.sport)) continue
    if (data.status && !['live', 'final'].includes(data.status)) continue
    const homeLeft = homeOnLeft([data.team_a_name, data.team_a_short], [data.team_b_name, data.team_b_short], game)
    if (homeLeft === null) continue
    matching.push({ row, data, homeLeft })
  }
  if (!matching.length) return null
  const perChannel = new Map()
  for (const m of matching) perChannel.set(m.data.channel ?? '', (perChannel.get(m.data.channel ?? '') ?? 0) + 1)
  const channel = [...perChannel.entries()].sort((x, y) => y[1] - x[1])[0][0]
  const snaps = matching.filter((m) => (m.data.channel ?? '') === channel)

  const replay = new Replay()
  let prev = null
  let names = null
  for (const { row, data, homeLeft } of snaps) {
    const cur = view(data, homeLeft)
    const ts = Number(data.ts)
    const t = { board_ms: Number.isFinite(ts) && ts > 0 ? ts : null, server_ms: msOf(row.at) }
    if (!names) {
      const left = data.team_a_short || data.team_a_name || null
      const right = data.team_b_short || data.team_b_name || null
      names = homeLeft ? { a: left, b: right } : { a: right, b: left }
    }
    const before = prev ?? { points: [0, 0], timeouts: [0, 0], results: [], set: 1, serving: null, final: false }
    let scored = false
    if (cur.results.length > before.results.length) {
      // Sets closed: each one's last points, its end, then the new set's points.
      for (let k = before.results.length; k < cur.results.length; k++) {
        const from = before.set === k + 1 ? before.points : [0, 0]
        scored = replay.step(from, cur.results[k], k + 1, t, cur.serving) || scored
        const end = replay.push('set_end', t, k + 1, { serving: cur.serving })
        end.final = cur.results[k]
      }
      if (cur.set > cur.results.length) scored = replay.step([0, 0], cur.points, cur.set, t, cur.serving) || scored
    } else if (cur.results.length < before.results.length) {
      // A set end taken back: the set goes on from its last standing score.
      for (let k = before.results.length; k > cur.results.length; k--) replay.reopen(k)
      replay.push('undo', t, cur.set, { serving: cur.serving })
      const standing = replay.finish().filter((e) => e.period === cur.set).pop()
      const from = standing ? [standing.points_a, standing.points_b] : [0, 0]
      scored = replay.step(from, cur.points, cur.set, t, cur.serving) || scored
    } else if (cur.set === before.set) {
      scored = replay.step(before.points, cur.points, cur.set, t, cur.serving)
    } else if (cur.set === before.set + 1) {
      scored = replay.step([0, 0], cur.points, cur.set, t, cur.serving)
    }
    if (cur.set === before.set) {
      for (const [i, side] of [[0, 'a'], [1, 'b']]) {
        for (let k = before.timeouts[i]; k < cur.timeouts[i]; k++) replay.push('timeout', t, cur.set, { side, serving: cur.serving })
        for (let k = cur.timeouts[i]; k < before.timeouts[i]; k++) replay.untimeout(side, cur.set)
      }
    }
    if (!scored && prev && cur.serving && cur.serving !== before.serving) {
      replay.push('serve', t, cur.set, { serving: cur.serving })
    }
    if (cur.final && !before.final) replay.push('match_end', t, Math.max(1, cur.results.length), { serving: cur.serving })
    prev = cur
  }
  const events = replay.finish()
  return {
    source: 'live_scores_revisions',
    channel: channel || null,
    match_key: null,
    board_names: names,
    orientation: 'names',
    snapshots: snaps.length,
    events,
  }
}

// ── Source 1: live_match_logs ─────────────────────────────────────────────────

/** Which of the log's teams is home: by the names, else by the set finals against the official ones. */
function logHomeIsA(row, game, finalsAB) {
  const byNames = homeOnLeft([row.team_a], [row.team_b], game)
  if (byNames !== null) return { homeIsA: byNames, orientation: 'names' }
  if (game.sets?.length && finalsAB.length) {
    let vote = 0
    finalsAB.forEach(([x, y], i) => {
      const off = game.sets[i]
      if (!off) return
      if (x === off[0] && y === off[1]) vote += 1
      else if (y === off[0] && x === off[1]) vote -= 1
    })
    if (vote) return { homeIsA: vote > 0, orientation: 'sets' }
  }
  return { homeIsA: null, orientation: null }
}

/**
 * A live_match_logs row (events by team: a = left at the first rally) → the game's events. The
 * board removed undone actions itself; a "−" on a point (delta < 0) and a typed score are
 * corrections like any other.
 */
export function matchLogToLog(row, game) {
  const raw = (parseJson(row.events, []) || []).filter((e) => e && typeof e === 'object')
  const finalsAB = raw.filter((e) => e.type === 'set-end' && Array.isArray(e.score)).map((e) => [num(e.score[0]), num(e.score[1])])
  const { homeIsA, orientation } = logHomeIsA(row, game, finalsAB)
  if (homeIsA === null) return null
  const flip = (side) => (side === 'a' || side === 'b' ? ((side === 'a') === homeIsA ? 'a' : 'b') : null)
  const pair = (v) => (homeIsA ? [num(v?.[0]), num(v?.[1])] : [num(v?.[1]), num(v?.[0])])
  const base = row.board_date && /^\d{4}-\d{2}-\d{2}/.test(row.board_date)
    ? zurichToUtcMs(row.board_date.slice(0, 10), row.board_date.slice(11, 16) || '00:00')
    : null

  const replay = new Replay()
  let set = 1
  let score = [0, 0]
  for (const e of raw) {
    const el = Number(e.el)
    const t = { board_ms: Number.isFinite(el) ? (base ?? 0) + Math.round(el * 1000) : null, server_ms: null }
    const serving = flip(e.srv)
    const side = flip(e.side)
    if (e.type === 'point' && side) {
      const i = side === 'a' ? 0 : 1
      let to = score.slice()
      if (Number.isFinite(Number(e.delta)) && Number(e.delta) !== 0) to[i] = Math.max(0, to[i] + Number(e.delta))
      else if (e.value != null) to[i] = Math.max(0, num(e.value))
      else to = score
      replay.step(score, to, set, t, serving)
      score = to
    } else if (e.type === 'set-end') {
      const final = Array.isArray(e.score) ? pair(e.score) : score
      replay.step(score, final, set, t, serving)
      const end = replay.push('set_end', t, set, { serving })
      end.final = final
      set += 1
      score = [0, 0]
    } else if (e.type === 'remove-set' && set > 1) {
      set -= 1
      replay.reopen(set)
      replay.push('undo', t, set, { serving })
      const standing = replay.finish().filter((x) => x.period === set).pop()
      score = standing ? [standing.points_a, standing.points_b] : [0, 0]
    } else if (e.type === 'timeout' && side && Number(e.delta) > 0) {
      replay.push('timeout', t, set, { side, serving })
    } else if (e.type === 'serve' && serving) {
      replay.push('serve', t, set, { serving })
    } else if (e.type === 'undo') {
      replay.push('undo', t, set, { serving })
    } else if (e.type === 'match-end') {
      replay.push('match_end', t, Math.max(1, set - 1), { serving })
    }
  }
  const names = homeIsA ? { a: row.team_a ?? null, b: row.team_b ?? null } : { a: row.team_b ?? null, b: row.team_a ?? null }
  return {
    source: 'live_match_logs',
    channel: row.channel ?? null,
    match_key: row.match_key ?? null,
    board_names: names,
    orientation,
    snapshots: null,
    events: replay.finish(),
  }
}

// ── Loading ─────────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0')
const isoDay = (value) => {
  if (value == null) return null
  if (value instanceof Date) return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  const s = String(value)
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

/**
 * The score log of one game, or a "none" answer. `deps` reads the database:
 *   game(id)                → { id, date, time, home, away, sets } | null
 *   matchLogs(game)         → live_match_logs rows (game_id = id, or the game's day)
 *   snapshots(from, to)     → [{ id, at, data }] of live_scores, oldest first
 */
export async function loadScoreLog(gameId, deps) {
  const game = await deps.game(gameId)
  if (!game) return null
  const head = {
    version: SCORE_LOG_VERSION,
    game: { id: game.id, date: game.date, time: game.time, home: game.home, away: game.away, sets: game.sets },
    team_a: game.home,
    team_b: game.away,
  }
  const none = { ...head, source: null, channel: null, match_key: null, board_names: null, orientation: null, snapshots: null, events: [], sets: [] }
  if (!game.home || !game.away) return none

  const logs = await deps.matchLogs(game)
  const own = logs.filter((r) => r.game_id === game.id)
  const sameDay = logs.filter((r) => r.game_id !== game.id && String(r.board_date ?? '').slice(0, 10) === game.date)
  for (const row of [...own, ...sameDay]) {
    if (row.sport && !SPORTS.includes(row.sport)) continue
    const found = matchLogToLog(row, game)
    if (found && found.events.some((e) => e.kind === 'point')) return { ...head, ...found, sets: setFinals(found.events) }
  }

  const window = gameWindow(game)
  if (!window) return none
  const rows = await deps.snapshots(new Date(window[0]), new Date(window[1]))
  const found = snapshotsToLog(rows, game)
  if (!found || !found.events.some((e) => e.kind === 'point')) return none
  return { ...head, ...found, sets: setFinals(found.events) }
}

/** The database readers for loadScoreLog (knex). */
export function scoreLogDeps(database, { normalizeSets, hhmm }) {
  return {
    async game(id) {
      const g = await database('games').where('id', id)
        .first('id', 'date', 'time', 'home_team', 'away_team', 'status', 'sets_json')
      if (!g) return null
      return {
        id: g.id,
        date: isoDay(g.date),
        time: hhmm(g.time),
        home: g.home_team || null,
        away: g.away_team || null,
        sets: g.status === 'completed' ? normalizeSets(g.sets_json) : null,
      }
    },
    async matchLogs(game) {
      return database('live_match_logs')
        .where((q) => {
          q.where('game_id', game.id)
          if (game.date) q.orWhere('board_date', 'like', `${game.date}%`)
        })
        .orderBy('uploaded_at', 'desc')
        .limit(20)
        .select('id', 'channel', 'match_key', 'game_id', 'sport', 'team_a', 'team_b', 'set_results', 'events', 'board_date', 'uploaded_at')
    },
    async snapshots(from, to) {
      return database('directus_activity as a')
        .join('directus_revisions as r', 'r.activity', 'a.id')
        .where('a.collection', 'live_scores')
        .whereIn('a.action', ['create', 'update'])
        .whereBetween('a.timestamp', [from, to])
        .orderBy('a.id')
        .limit(MAX_SNAPSHOTS)
        .select('a.id as id', 'a.timestamp as at', 'r.data as data')
    },
  }
}

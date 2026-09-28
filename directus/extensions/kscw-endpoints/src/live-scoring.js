/**
 * Phone live scoring for one game (migration 394).
 *
 *   GET /kscw/live-scoring/game/:gameId   may I score it? + the current row
 *   POST /kscw/live-scoring/game/:gameId  publish the next state { base_ts, state }
 *        (POST, not PUT: Directus's CORS preflight does not allow PUT — no-put-routes.test)
 *
 * Each game publishes to its own `live_scores` row, channel `game-<id>`, which the
 * public `/live?channel=game-<id>` page already renders. The scoring RULES (25/15 by
 * two, best of five, a "−" that takes back a set) run in the browser — a port of
 * point-hub's manualSource, `src/modules/live/scoring.ts`. This endpoint only decides
 * WHO may publish and checks that what they publish is a plausible volleyball score.
 *
 * WHO MAY SCORE (volleyball, games with a KSCW team):
 *   - anyone on the game's sheet: the coach's saved match sheet, else the Einsatzliste
 *     filed in Volleymanager, else confirmed RSVPs — `gameSheetMemberIds`, the SAME
 *     definition the scorer's match sheet uses, so the two cannot drift;
 *   - a coach / TR of the team, or of a team the game was opened to;
 *   - HOME games only: the assigned duty members (Schreiber, Täfeler, both-in-one).
 *     An away game's scorer duty is the opponent's, and our members on it are none.
 *   Window: kickoff −60 min … +4 h. Full admins bypass everything.
 *
 * TWO PHONES AT ONCE. Two teammates will both open it. Every write carries the `ts` of
 * the row it was built from and the UPDATE is conditional on it, so a write built on
 * a stale score is refused (409 `stale`, with the current row) instead of silently
 * rolling the other phone's points back. The client adopts the row and the tap is
 * re-applied by the person — a lost tap is visible, a rolled-back score is not.
 *
 * ACTOR CAPTURE. Raw knex bypasses Directus's activity trail, so writeUserLog records
 * who started, ended a set, finished or reset a match, and whenever a DIFFERENT member
 * takes over the scoring. Not every rally: ~180 rows a match would bury the audit log,
 * and a rally carries nothing a later reader needs that the set results do not.
 */

import { writeUserLog } from './activity-log.js'
import { gameStartMs, gameSheetMemberIds, isTeamLeader, isGuestTeamLeader } from './scorer-roster.js'

const WINDOW_BEFORE_MS = 60 * 60 * 1000
const WINDOW_AFTER_MS = 4 * 60 * 60 * 1000
// Home-game duty seats that may score. Volleyball only for now; the BB seats are
// listed so switching basketball on later is a sport check, not a hunt for columns.
const DUTY_COLS = ['scorer_member', 'scoreboard_member', 'scorer_scoreboard_member',
  'bb_scorer_member', 'bb_timekeeper_member', 'bb_24s_official']
const ELIGIBLE_TTL_MS = 10 * 60 * 1000

export const channelFor = (gameId) => `game-${gameId}`

// "KSC Wiedikon H3" → "KSCW", "VBC Zürich Lions" → "VZL". The board's short code is
// what the /live headline and the discoverability banner print.
export function shortName(name) {
  const s = String(name ?? '').trim()
  if (!s) return ''
  if (/wiedikon|kscw/i.test(s)) return 'KSCW'
  const words = s.split(/\s+/).filter((w) => /[A-Za-zÀ-ÿ]/.test(w))
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase()
  return words.slice(0, 4).map((w) => w[0]).join('').toUpperCase()
}

const int = (v, max) => {
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null
}

/**
 * Validate a published state. Returns the clean column values, or null. Deliberately a
 * plausibility check, not a rules engine: the rules live in the client, and an
 * operator correcting a mis-tap must be able to publish any score a real match can
 * reach (deuce sets run past 25 uncapped).
 */
export function cleanState(state) {
  if (!state || typeof state !== 'object') return null
  const points_a = int(state.points_a, 99)
  const points_b = int(state.points_b, 99)
  const sets_won_a = int(state.sets_won_a, 3)
  const sets_won_b = int(state.sets_won_b, 3)
  if ([points_a, points_b, sets_won_a, sets_won_b].includes(null)) return null
  if (!Array.isArray(state.set_results) || state.set_results.length > 5) return null
  const set_results = []
  for (const r of state.set_results) {
    const a = int(r?.a, 99)
    const b = int(r?.b, 99)
    if (a == null || b == null) return null
    const dur = r?.dur == null ? null : int(r.dur, 3 * 60 * 60)
    set_results.push(dur == null ? { a, b } : { a, b, dur })
  }
  // The set count must agree with the recorded sets, or /live's pills and its set score
  // disagree in front of the hall.
  const winsA = set_results.filter((r) => r.a > r.b).length
  const winsB = set_results.filter((r) => r.b > r.a).length
  if (winsA !== sets_won_a || winsB !== sets_won_b) return null
  const status = ['live', 'final', 'idle'].includes(state.status) ? state.status : null
  if (!status) return null
  const serving_team = state.serving_team === 'left' || state.serving_team === 'right' ? state.serving_team : null
  const event = ['set-end', 'match-end'].includes(state.event) ? state.event : null
  return {
    points_a, points_b, sets_won_a, sets_won_b,
    set_results, status, serving_team, event,
    over: status === 'final',
    // The set on the board: the one being played, or — from the set point until NEXT
    // SET, which is what a set-end/match-end event marks — the one just finished.
    period: Math.max(1, Math.min(set_results.length + (event ? 0 : 1), 5)),
  }
}

export function registerLiveScoring(router, { database, logger }) {
  const log = logger.child({ endpoint: 'live-scoring' })
  // `${gameId}:${memberId}` → expiry. Positive answers only: the check can read
  // Volleymanager, and a scorer taps every rally.
  const eligible = new Map()
  // channel → member id of the last writer, to log a hand-over once.
  const lastWriter = new Map()

  const fail = (res, status, error, code) => res.status(status).json({ error, code })

  async function loadRow(channel) {
    return database('live_scores').where('channel', channel).first('*')
  }

  /**
   * → { game, member, isAdmin } or { status, error, code }.
   */
  async function authorize(req) {
    const isAdmin = req.accountability?.admin === true
    const userId = req.accountability?.user
    if (!userId && !isAdmin) return { status: 401, error: 'Authentication required', code: 'auth' }

    const game = await database('games').where('id', req.params.gameId).first('*')
    if (!game) return { status: 404, error: 'Game not found', code: 'not_found' }
    if (game.kscw_team == null) return { status: 422, error: 'Game has no KSCW team', code: 'no_team' }
    const team = await database('teams').where('id', game.kscw_team).first('sport')
    if (team?.sport !== 'volleyball') return { status: 422, error: 'Live scoring is volleyball only', code: 'sport' }
    if (game.status === 'cancelled' || game.status === 'postponed') {
      return { status: 422, error: 'Game is not being played', code: 'not_played' }
    }

    const member = userId ? await database('members').where('user', userId).first('id', 'first_name', 'last_name') : null
    if (isAdmin) return { game, member, isAdmin }
    if (!member) return { status: 403, error: 'Only club members can score', code: 'no_member' }

    const startMs = gameStartMs(game)
    if (startMs == null) return { status: 403, error: 'Game has no scheduled time', code: 'no_time' }
    const now = Date.now()
    if (now < startMs - WINDOW_BEFORE_MS || now > startMs + WINDOW_AFTER_MS) {
      return { status: 403, error: 'Live scoring is not open at this time', code: 'outside_window' }
    }

    const memberId = Number(member.id)
    const key = `${game.id}:${memberId}`
    if ((eligible.get(key) ?? 0) > now) return { game, member, isAdmin }

    const onDuty = game.type === 'home' && DUTY_COLS.some((c) => game[c] != null && Number(game[c]) === memberId)
    const ok = onDuty
      || await isTeamLeader(database, memberId, game.kscw_team)
      || await isGuestTeamLeader(database, memberId, game.id)
      || (await gameSheetMemberIds(database, log, game)).has(memberId)
    if (!ok) return { status: 403, error: 'Only the players, staff and duty of this game can score it', code: 'not_participant' }
    eligible.set(key, now + ELIGIBLE_TTL_MS)
    return { game, member, isAdmin }
  }

  router.get('/live-scoring/game/:gameId', async (req, res) => {
    try {
      const channel = channelFor(req.params.gameId)
      const auth = await authorize(req)
      const row = await loadRow(channel)
      // Names + kickoff only — what the public games list already shows.
      const game = await database('games').where('id', req.params.gameId)
        .first('id', 'home_team', 'away_team', 'date', 'time', 'type', 'league')
      // The row itself is public (/live) — hand it back even when the caller may not
      // score, so the game modal can still offer "Watch live".
      res.json({ can_score: !auth.status, code: auth.code ?? null, channel, game: game ?? null, row: row ?? null })
    } catch (err) {
      log.error(`[live-scoring] GET ${req.params.gameId}: ${err.message}`)
      fail(res, 500, 'Internal error', 'internal')
    }
  })

  router.post('/live-scoring/game/:gameId', async (req, res) => {
    try {
      const auth = await authorize(req)
      if (auth.status) return fail(res, auth.status, auth.error, auth.code)
      const { game, member } = auth
      const clean = cleanState(req.body?.state)
      if (!clean) return fail(res, 400, 'Invalid score', 'invalid_state')

      const channel = channelFor(game.id)
      const baseTs = req.body?.base_ts == null ? null : Number(req.body.base_ts)
      const ts = Math.max(Date.now(), (baseTs ?? 0) + 1)
      const cols = {
        ...clean,
        set_results: JSON.stringify(clean.set_results),
        sport: 'volleyball',
        side_a: 'left',
        ts,
        game_id: game.id,
        team_a_name: game.home_team ?? '',
        team_a_short: shortName(game.home_team),
        team_a_color: '#2563eb',
        team_b_name: game.away_team ?? '',
        team_b_short: shortName(game.away_team),
        team_b_color: '#ef4444',
        timeouts_a: 0, timeouts_b: 0, subs_a: 0, subs_b: 0, fouls_a: 0, fouls_b: 0,
        date_updated: new Date(),
      }

      const before = await loadRow(channel)
      let written
      if (!before) {
        // First publish for this game. A second phone racing us loses on the PK and
        // is told to re-read, same as a stale update. Raw SQL: knex's .ignore() drops
        // RETURNING, so a won insert would read as a lost one.
        const keys = Object.keys(cols)
        const sql = `INSERT INTO live_scores (channel, ${keys.map((k) => `"${k}"`).join(', ')})
          VALUES (?, ${keys.map(() => '?').join(', ')})
          ON CONFLICT (channel) DO NOTHING RETURNING *`
        const r = await database.raw(sql, [channel, ...keys.map((k) => cols[k])])
        written = r.rows?.[0]
      } else if (baseTs != null && Number(before.ts) === baseTs) {
        const rows = await database('live_scores')
          .where({ channel })
          .where('ts', baseTs)
          .update(cols)
          .returning('*')
        written = rows?.[0]
      }
      if (!written) {
        return res.status(409).json({ error: 'The score changed on another phone', code: 'stale', row: await loadRow(channel) })
      }

      // Lifecycle + hand-over logging (see the header for why not every rally).
      const prevSets = before ? Number(before.sets_won_a) + Number(before.sets_won_b) : 0
      const sets = clean.sets_won_a + clean.sets_won_b
      const memberId = member ? Number(member.id) : null
      const handOver = memberId != null && lastWriter.has(channel) && lastWriter.get(channel) !== memberId
      const action = !before || before.status !== clean.status ? `live_${clean.status}`
        : sets !== prevSets ? 'live_set'
          : handOver ? 'live_takeover' : null
      if (memberId != null) lastWriter.set(channel, memberId)
      if (action) {
        await writeUserLog(database, log, {
          accountability: req.accountability,
          action,
          collection: 'live_scores',
          recordId: channel,
          data: {
            game: game.id,
            status: clean.status,
            sets: `${clean.sets_won_a}:${clean.sets_won_b}`,
            points: `${clean.points_a}:${clean.points_b}`,
            set_results: clean.set_results,
          },
        })
      }
      res.json({ row: written })
    } catch (err) {
      log.error(`[live-scoring] POST ${req.params.gameId}: ${err.message}`)
      fail(res, 500, 'Internal error', 'internal')
    }
  })
}

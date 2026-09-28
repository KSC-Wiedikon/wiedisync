/**
 * Game result entry + Volleymanager result report (migration 395).
 *
 *   GET  /kscw/game-result/:gameId   may I report? + provisional / official / VM / live state
 *   POST /kscw/game-result/:gameId   { sets: [{home, away}], force? } → store provisional, push to VM
 *        (POST, not PUT: Directus's CORS preflight does not allow PUT — no-put-routes.test)
 *
 * WHO + WHEN. The live-scoring participants (game-participant.js: the game's sheet,
 * coach/TR of the team or a guest team, HOME duty seats), from kickoff +3 h until
 * kickoff +14 d, and only until the official result lands (games.status 'completed',
 * set by sv-sync). Full admins bypass both.
 *
 * WHAT A SUBMIT DOES.
 *   1. The score is stored as PROVISIONAL on the game at once — every surface shows it
 *      with a "Provisional" badge until sv-sync delivers the official one. Official
 *      always wins; the provisional columns stay as history.
 *   2. A detached worker (`scripts/vm-push-result.mjs`) files our report in VM in the
 *      background and writes its outcome into the vm_result_* journal, which the modal
 *      polls. Same spawn contract as nomination-push.js: the shared VM account is
 *      claimed BEFORE the row lease and released on the child's exit, never earlier.
 *
 * NO SILENT CONFLICT. If the opponent has reported a different score, the submit is
 * refused (409 `conflict`) unless the member explicitly sends `force` — the modal puts
 * that behind a danger confirm, because two differing reports mean VM creates no
 * result and SVRZ takes the score from the paper match sheet.
 *
 * NO AUTOMATIC CONFIRMATION. The GET (and the hourly sweep in kscw-hooks) only READS
 * the opponent's report and shows it as provisional (source 'opponent'). Confirming in
 * VM makes the result official, so it always takes a member's tap.
 *
 * SVRZ_RC'S WINDOWS. svrz_rc logs in to the same VM account from another host
 * (vm-windows.js). Inside its windows the GET serves the stored state without a VM
 * read, and a submit is stored and QUEUED (vm_result_status 'pending', error
 * 'queued_window', no lease) — the hourly :35 sweep in kscw-hooks dispatches it
 * through spawnResultPush, the same path as an immediate submit.
 *
 * SKIPS — provisional stored, no VM write, vm_result_status 'skipped' + reason:
 *   derby (both teams ours, two games rows per game_id) · no_vm_game · vm_not_configured.
 *   The worker adds home_team_reports / not_reportable, which need a VM read.
 *
 * ACTOR CAPTURE. Raw knex bypasses Directus's activity trail: every submit writes a
 * `result_entered` user_log, and the entering member's name lands on the row
 * (provisional_by_name).
 */

import { writeUserLog } from './activity-log.js'
import { claimVmAccount, vmAccountHeldBy } from './vm-account-lock.js'
import { authorizeGameParticipant } from './game-participant.js'
import { gameStartMs } from './scorer-roster.js'
import { readVmGameResult, cachedVmGameResult } from './vm-game-result.js'
import { isSvrzRcBlackout } from './vm-windows.js'

const HOUR = 60 * 60 * 1000
// Opens three hours AFTER kickoff (a negative "before"), closes two weeks after it.
export const OPENS_AFTER_MS = 3 * HOUR
export const CLOSES_AFTER_MS = 14 * 24 * HOUR

const MESSAGES = {
  sport: 'Result entry is volleyball only',
  no_member: 'Only club members can report a result',
  outside_window: 'Result entry is not open at this time',
  not_participant: 'Only the players, staff and duty of this game can report its result',
}

const WORKER = '/directus/scripts/vm-push-result.mjs'
const WORKER_LOG = '/directus/logs/vm-result.log'

// The worker's own watchdog ends it after 8 minutes; the sweep waits a little longer
// before it moves on to the next queued push regardless.
const DISPATCH_WAIT_MS = 9 * 60 * 1000
const QUEUED_WINDOW = 'queued_window'

// A push may take the row when none is in flight: not 'pending', a queued one (no
// lease), or a lease older than 10 minutes — a worker killed mid-run (every
// ext:deploy restarts this container) must not strand the row at 'pending'.
const LEASE_FREE_SQL = "(vm_result_status IS DISTINCT FROM 'pending'"
  + ' OR vm_result_claimed_at IS NULL'
  + " OR vm_result_claimed_at < now() - interval '10 minutes')"

// ── Pure helpers (unit-tested) ─────────────────────────────────────────────

const isInt = (v, max) => Number.isInteger(v) && v >= 0 && v <= max

function checkSets(clean, needed) {
  if (clean.length > 2 * needed - 1) return `More than ${2 * needed - 1} sets`
  let home = 0
  let away = 0
  for (let i = 0; i < clean.length; i++) {
    if (home === needed || away === needed) return `Set ${i + 1} played after the match was decided`
    const { home: h, away: a } = clean[i]
    const deciding = i + 1 === 2 * needed - 1
    const target = deciding ? 15 : 25
    const win = Math.max(h, a)
    const lose = Math.min(h, a)
    if (win < target) return `Set ${i + 1}: the winner needs at least ${target} points`
    if (win - lose < 2) return `Set ${i + 1}: must be won by two points`
    if (h > a) home++
    else away++
  }
  if (home !== needed && away !== needed) return `Nobody has won ${needed} sets`
  return { home, away }
}

/**
 * Validate an entered result. Same rules as src/utils/gameResult.ts.
 * 1..5 sets, integers 0..99; each set won by ≥2 with the winner at ≥25 (≥15 in the
 * deciding set: set 5 of best-of-5 / set 3 of best-of-3); the match winner reaches
 * `neededSets` and no set follows the deciding one. `neededSets` unknown (null) →
 * whichever of 3 and 2 the entered sets satisfy.
 *
 * → { ok: true, sets, home, away, needed } | { ok: false, detail }
 */
export function validateSets(sets, neededSets) {
  if (!Array.isArray(sets) || sets.length < 1 || sets.length > 5) {
    return { ok: false, detail: 'Enter between 1 and 5 sets' }
  }
  const clean = []
  for (let i = 0; i < sets.length; i++) {
    const home = sets[i]?.home
    const away = sets[i]?.away
    if (!isInt(home, 99) || !isInt(away, 99)) return { ok: false, detail: `Set ${i + 1}: scores must be whole numbers 0–99` }
    clean.push({ home, away })
  }
  const candidates = neededSets === 2 || neededSets === 3 ? [neededSets] : [3, 2]
  let firstError = null
  for (const needed of candidates) {
    const r = checkSets(clean, needed)
    if (typeof r === 'string') {
      firstError ??= r
      continue
    }
    return { ok: true, sets: clean, home: r.home, away: r.away, needed }
  }
  return { ok: false, detail: firstError }
}

/** Same sets, same order, same balls. */
export function setsEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  return a.every((s, i) => Number(s?.home) === Number(b[i]?.home) && Number(s?.away) === Number(b[i]?.away))
}

export const parseJson = (v) => {
  if (v == null) return null
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch { return null }
}

/** { opens_at, closes_at } ISO strings, or nulls when the game has no kickoff. */
export function resultWindow(startMs) {
  if (startMs == null) return { opens_at: null, closes_at: null }
  return {
    opens_at: new Date(startMs + OPENS_AFTER_MS).toISOString(),
    closes_at: new Date(startMs + CLOSES_AFTER_MS).toISOString(),
  }
}

/**
 * What a validated submit does, before anything is written.
 * → { action: 'already_official' } | { action: 'conflict' }
 *   | { action: 'skip', reason, source } | { action: 'push', source }
 */
export function decideSubmit({ game, sets, opponent, force, isDerby, vmUuid, vmConfigured }) {
  if (game?.status === 'completed') return { action: 'already_official' }
  const hasOpponent = Array.isArray(opponent?.sets) && opponent.sets.length > 0
  const equal = hasOpponent && setsEqual(opponent.sets, sets)
  if (hasOpponent && !equal && !force) return { action: 'conflict' }
  const source = equal ? 'confirmed' : 'own'
  if (isDerby) return { action: 'skip', reason: 'derby', source }
  if (!vmUuid) return { action: 'skip', reason: 'no_vm_game', source }
  if (!vmConfigured) return { action: 'skip', reason: 'vm_not_configured', source }
  return { action: 'push', source }
}

/** Our reporting party: VM's word when it gave one, else our own home/away flag. */
export function ourParty(read, game) {
  return read?.own_party ?? (game?.type === 'away' ? 'awayteam' : 'hometeam')
}

/** The two team reports in a VM read, from our point of view. */
export function pickReports(read, game) {
  const us = ourParty(read, game)
  const them = us === 'hometeam' ? 'awayteam' : 'hometeam'
  const reports = Array.isArray(read?.reports) ? read.reports : []
  const find = (party) => reports.find((r) => r.party === party && Array.isArray(r.sets) && r.sets.length) ?? null
  return { own: find(us), opponent: find(them) }
}

/**
 * The games columns a VM read refreshes. Pure — the GET applies it.
 *   - vm_opponent_report / vm_result_checked_at: always (the read is authoritative);
 *   - provisional ← VM's official result (source 'vm_official') when VM holds one;
 *   - else provisional ← the opponent's report (source 'opponent') when we have no
 *     provisional yet or the one we have came from the opponent. An 'own' or
 *     'confirmed' entry is never overwritten by a read.
 */
export function vmRefreshPatch(game, read, now = new Date()) {
  const { opponent } = pickReports(read, game)
  const patch = {
    vm_opponent_report: opponent
      ? JSON.stringify({ sets: opponent.sets, home: opponent.home, away: opponent.away, reported_at: opponent.updated_at, party: opponent.party })
      : null,
    vm_result_checked_at: read?.checked_at ? new Date(read.checked_at) : now,
  }
  const current = parseJson(game.provisional_sets_json)
  const setProvisional = (res, source) => {
    if (game.provisional_source === source && setsEqual(current, res.sets)) return
    Object.assign(patch, {
      provisional_sets_json: JSON.stringify(res.sets),
      provisional_home_score: res.home,
      provisional_away_score: res.away,
      provisional_source: source,
      provisional_by_name: null,
      provisional_at: now,
    })
  }
  if (read?.official) setProvisional(read.official, 'vm_official')
  else if (opponent && (game.provisional_home_score == null || game.provisional_source === 'opponent')) {
    setProvisional(opponent, 'opponent')
  }
  return patch
}

const JOURNAL_COLS = ['vm_opponent_report', 'vm_result_checked_at']

/**
 * Write a VM read onto the game and return the game as it now stands.
 *
 * vmRefreshPatch decided on the row as the GET loaded it; a member may have submitted
 * since, or sv-sync delivered the official result. So the journal columns are written
 * as they are (the read is authoritative for them), but the provisional_* columns only
 * under a guard in the UPDATE itself: the game is still 'scheduled', and — unless VM's
 * OFFICIAL result is what we write, which may replace anything — the stored score is
 * none or the opponent's. A member's own entry is never overwritten by a read.
 */
export async function applyVmRefresh(database, game, read, now = new Date()) {
  const patch = vmRefreshPatch(game, read, now)
  const journal = {}
  const provisional = {}
  for (const [k, v] of Object.entries(patch)) (JOURNAL_COLS.includes(k) ? journal : provisional)[k] = v
  await database('games').where('id', game.id).update(journal)
  let next = { ...game, ...journal }
  if (Object.keys(provisional).length) {
    let q = database('games').where('id', game.id).where('status', 'scheduled')
    if (provisional.provisional_source !== 'vm_official') {
      q = q.whereRaw("(provisional_source IS NULL OR provisional_source = 'opponent')")
    }
    if (await q.update(provisional)) next = { ...next, ...provisional }
  }
  return next
}

function provisionalOf(game) {
  if (game.provisional_home_score == null) return null
  return {
    sets: parseJson(game.provisional_sets_json) ?? [],
    home: Number(game.provisional_home_score),
    away: game.provisional_away_score == null ? null : Number(game.provisional_away_score),
    source: game.provisional_source ?? null,
    by_name: game.provisional_by_name ?? null,
    at: game.provisional_at ?? null,
  }
}

/** live_scores row (team_a = home, see live-scoring.js) → the prefill block. */
export function liveOf(row) {
  const results = parseJson(row?.set_results)
  if (!row || !Array.isArray(results) || !results.length) return null
  return {
    sets: results.map((r) => ({ home: Number(r.a), away: Number(r.b) })),
    home: Number(row.sets_won_a),
    away: Number(row.sets_won_b),
    final: row.status === 'final' || row.over === true,
  }
}

const memberName = (m) => (m ? `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || null : null)
const vmConfigured = () => !!(process.env.VM_USERNAME && process.env.VM_PASSWORD)

// ── Spawning the worker (endpoint + the :35 sweep's queue) ──────────────────

/**
 * Take the shared VM account and the row lease, then spawn vm-push-result.mjs
 * detached. The ONE way a result push starts — the POST and the sweep's queue both
 * come here, so neither can skip a step.
 *
 * Order matters (same as nomination-push.js): the account BEFORE the row — a row left
 * at 'pending' with no worker behind it hides the member's retry until the lease runs
 * out. The account is released on the child's `exit` only, never in a `finally` that
 * runs while it is still logged in.
 *
 * @param {object} p
 * @param {Array<{home:number, away:number}>} p.sets  what the worker files — passed in
 *   SETS_JSON rather than re-read from provisional_sets_json, so a submit that lands
 *   while the worker runs cannot change what gets filed under this one's lease.
 * @param {object} [p.cols]  extra columns for the lease UPDATE (the POST stores the
 *   provisional score in the same statement, so a refused submit writes nothing).
 * @param {Function} [p.spawn]  child_process.spawn, injectable for tests.
 * @returns {Promise<{ ok: true, exited: Promise<number|null> }
 *   | { ok: false, code: 'vm_account_busy'|'push_running'|'spawn_failed', holder? }>}
 */
export async function spawnResultPush({ database, log, gameId, sets, force = false, cols = {}, spawn = null }) {
  const releaseVmAccount = claimVmAccount('game-result:push')
  if (!releaseVmAccount) return { ok: false, code: 'vm_account_busy', holder: vmAccountHeldBy() }

  // One conditional UPDATE is the guard (Postgres row lock: the loser matches 0 rows).
  let claimed
  try {
    claimed = await database('games').where('id', gameId).whereRaw(LEASE_FREE_SQL).update({
      ...cols,
      vm_result_status: 'pending',
      vm_result_error: null,
      vm_result_claimed_at: database.fn.now(),
    })
  } catch (err) {
    releaseVmAccount()
    throw err
  }
  if (!claimed) {
    releaseVmAccount()
    return { ok: false, code: 'push_running' }
  }

  // Only a row still in flight is resolved here — a worker that reached its own
  // finish() already wrote the better answer.
  const markFailed = (error) => database('games').where('id', gameId).where('vm_result_status', 'pending')
    .update({ vm_result_status: 'failed', vm_result_error: error, vm_result_claimed_at: null })
    .catch((e) => log.warn(`[game-result] ${gameId}: could not mark failed: ${e.message}`))

  let child
  try {
    const run = spawn ?? (await import('node:child_process')).spawn
    const { openSync } = await import('node:fs')
    let logOut
    try { logOut = openSync(WORKER_LOG, 'a') } catch { logOut = 'ignore' }
    child = run('node', [WORKER], {
      detached: true,
      stdio: ['ignore', logOut, logOut],
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        VM_USERNAME: process.env.VM_USERNAME,
        VM_PASSWORD: process.env.VM_PASSWORD,
        KSCW_SVRZ_CLUB_ID: process.env.KSCW_SVRZ_CLUB_ID || '',
        DIRECTUS_URL: 'http://127.0.0.1:8055',
        DIRECTUS_SYNC_EMAIL: process.env.DIRECTUS_SYNC_EMAIL,
        DIRECTUS_SYNC_PASSWORD: process.env.DIRECTUS_SYNC_PASSWORD,
        GAME_ID: String(gameId),
        SETS_JSON: JSON.stringify(sets),
        FORCE: force ? '1' : '',
        // Lets the worker refuse to write from the dev DB — VM has no staging.
        DB_DATABASE: process.env.DB_DATABASE || '',
        VM_RESULT_ALLOW_DEV_WRITE: process.env.VM_RESULT_ALLOW_DEV_WRITE || '',
      },
    })
  } catch (err) {
    // Nothing is running: give the account back and mark the push failed so the retry
    // shows. The provisional result stays — it is the member's entry.
    log.error(`[game-result] ${gameId}: spawn failed: ${err.message}`)
    releaseVmAccount()
    await markFailed('spawn_failed')
    return { ok: false, code: 'spawn_failed' }
  }

  // Detached: the request returns long before the worker does, but the account stays
  // claimed until it actually exits (leased, so a hung worker loses it).
  let done = false
  let resolveExited
  const exited = new Promise((r) => { resolveExited = r })
  child.once('exit', (code, signal) => {
    done = true
    releaseVmAccount()
    // A worker that died without its finish() — a crash, an OOM kill, a signal —
    // would leave 'pending' until the sweep's 15-minute reclaim. Say so now.
    if (code !== 0) {
      log.warn(`[game-result] ${gameId}: worker exited ${code ?? signal}`)
      markFailed(`worker_exit_${code ?? signal}`)
    }
    resolveExited(code)
  })
  // A child that never started (e.g. ENOENT) emits 'error' and no 'exit'; without a
  // listener that 'error' would also throw in this process.
  child.once('error', (err) => {
    log.error(`[game-result] ${gameId}: worker error: ${err.message}`)
    if (done) return
    done = true
    releaseVmAccount()
    markFailed('spawn_failed')
    resolveExited(null)
  })
  child.unref?.()
  return { ok: true, exited }
}

/**
 * The :35 sweep's first job: send the pushes that were submitted inside an svrz_rc
 * window (vm_result_error 'queued_window', no lease). One at a time — each worker
 * holds the shared account until it exits, so the next could not start anyway.
 *
 * Always without FORCE: a "Report ours anyway" that had to wait may meet a different
 * opponent report by now, and a differing report is never filed unseen. The worker
 * then ends at 'conflict', and the member decides again.
 *
 * → { queued, dispatched }
 */
export async function dispatchQueuedResultPushes({ database, log, max = 5, now = () => new Date(), spawn = null, waitMs = DISPATCH_WAIT_MS }) {
  if (isSvrzRcBlackout(now())) return { queued: 0, dispatched: 0 }
  const rows = await database('games')
    .where('vm_result_status', 'pending')
    .where('vm_result_error', QUEUED_WINDOW)
    .whereNull('vm_result_claimed_at')
    .orderBy('provisional_at', 'asc')
    .limit(max)
    .select('id', 'provisional_sets_json')
  let dispatched = 0
  for (const row of rows) {
    // A long worker can run the sweep into the next window; stop, the rest keep.
    if (isSvrzRcBlackout(now())) break
    const sets = parseJson(row.provisional_sets_json)
    if (!Array.isArray(sets) || !sets.length) {
      await database('games').where('id', row.id).where('vm_result_status', 'pending')
        .update({ vm_result_status: 'failed', vm_result_error: 'no_sets', vm_result_claimed_at: null })
      continue
    }
    const r = await spawnResultPush({ database, log, gameId: row.id, sets, force: false, spawn })
    if (!r.ok) {
      if (r.code === 'vm_account_busy') break   // the next hour tries again
      continue
    }
    dispatched += 1
    let timer
    await Promise.race([r.exited, new Promise((res) => { timer = setTimeout(res, waitMs) })])
    clearTimeout(timer)
  }
  return { queued: rows.length, dispatched }
}

// ── Route ──────────────────────────────────────────────────────────────────

export function registerGameResult(router, { database, logger }) {
  const log = logger.child({ endpoint: 'game-result' })
  // Eligibility answers (game-participant.js): a yes for 10 min, a no for 2 (the check can read VM).
  const eligible = new Map()

  const fail = (res, status, error, code, extra = {}) => res.status(status).json({ error, code, ...extra })

  function authorize(req) {
    return authorizeGameParticipant(database, log, req, {
      beforeMs: -OPENS_AFTER_MS, afterMs: CLOSES_AFTER_MS, cache: eligible, vmOnlyForSquad: true, messages: MESSAGES,
    })
  }

  /**
   * VM game uuid — matched by game number, exactly as scorer-roster.js does it:
   * `games.game_id` is `vb_<n>` and `svrz_games.svrz_number` is that n.
   */
  async function vmGameUuid(game) {
    const gid = String(game.game_id ?? '')
    if (!gid.startsWith('vb_')) return null
    const number = Number(gid.slice(3))
    if (!Number.isInteger(number)) return null
    const row = await database('svrz_games').where('svrz_number', number).first('svrz_persistence_id')
    return row?.svrz_persistence_id ?? null
  }

  // An intra-club derby is two games rows sharing one game_id (derby-games-two-rows).
  async function isDerby(game) {
    if (!game.game_id) return false
    return !!(await database('games').where('game_id', game.game_id).whereNot('id', game.id).first('id'))
  }

  router.get('/game-result/:gameId', async (req, res) => {
    try {
      const auth = await authorize(req)
      if (auth.status === 401 || auth.status === 404) return fail(res, auth.status, auth.error, auth.code)
      let game = auth.game ?? await database('games').where('id', req.params.gameId).first('*')
      if (!game) return fail(res, 404, 'Game not found', 'not_found')

      const startMs = gameStartMs(game)
      const official = game.status === 'completed'
      let read = null
      // One VM read when it can matter: a participant, past +3 h, not official yet —
      // and never inside an svrz_rc window (vm-windows.js). A busy account or a VM
      // hiccup returns null — show the stored state, never wait.
      if (!auth.status && !official && startMs != null && Date.now() >= startMs + OPENS_AFTER_MS
        && vmConfigured() && !isSvrzRcBlackout(new Date()) && !(await isDerby(game))) {
        const uuid = await vmGameUuid(game)
        if (uuid) read = await readVmGameResult(uuid, log)
        if (read) game = await applyVmRefresh(database, game, read)
      }

      const live = await database('live_scores').where('channel', `game-${game.id}`)
        .first('set_results', 'sets_won_a', 'sets_won_b', 'status', 'over')
      const own = read ? pickReports(read, game).own : null

      res.json({
        can_report: !auth.status,
        code: auth.code ?? null,
        window: resultWindow(startMs),
        game: {
          id: game.id, home_team: game.home_team, away_team: game.away_team,
          date: game.date, time: game.time, type: game.type, league: game.league,
          status: game.status, home_score: game.home_score, away_score: game.away_score,
          sets_json: parseJson(game.sets_json),
        },
        official,
        provisional: provisionalOf(game),
        vm: {
          status: game.vm_result_status ?? null,
          error: game.vm_result_error ?? null,
          pushed_at: game.vm_result_pushed_at ?? null,
          checked_at: game.vm_result_checked_at ?? null,
          report_id: game.vm_result_report_id ?? null,
          opponent: parseJson(game.vm_opponent_report),
          own: own ? { sets: own.sets, home: own.home, away: own.away, reported_at: own.updated_at } : null,
          reportable: read ? read.reportable : null,
          needed_sets: read ? read.needed_sets : null,
          notification_system: read ? read.notification_system : null,
        },
        live: liveOf(live),
      })
    } catch (err) {
      log.error(`[game-result] GET ${req.params.gameId}: ${err.message}`)
      fail(res, 500, 'Internal error', 'internal')
    }
  })

  router.post('/game-result/:gameId', async (req, res) => {
    try {
      const auth = await authorize(req)
      if (auth.status) return fail(res, auth.status, auth.error, auth.code)
      const { game } = auth
      if (game.status === 'completed') {
        return fail(res, 409, 'The official result is already in', 'already_official')
      }
      // Admins bypass WHO may report and the upper bound, never the opening: a result
      // for a game that has not been played would be filed in VolleyManager for real.
      const startMs = gameStartMs(game)
      if (startMs == null || Date.now() < startMs + OPENS_AFTER_MS) {
        return fail(res, 403, 'The result can be entered 3 hours after kickoff', 'outside_window')
      }

      const uuid = await vmGameUuid(game)
      // Needed sets: VM's league setting when a recent read knows it, else inferred.
      const needed = uuid ? cachedVmGameResult(uuid)?.needed_sets ?? null : null
      const v = validateSets(req.body?.sets, needed)
      if (!v.ok) return fail(res, 400, 'Invalid set scores', 'invalid_sets', { detail: v.detail })

      const force = req.body?.force === true
      const opponent = parseJson(game.vm_opponent_report)
      const decision = decideSubmit({
        game, sets: v.sets, opponent, force,
        isDerby: await isDerby(game), vmUuid: uuid, vmConfigured: vmConfigured(),
      })
      if (decision.action === 'conflict') {
        return fail(res, 409, 'The opponent reported a different result', 'conflict', { opponent })
      }

      const byName = memberName(auth.member)
      const now = new Date()
      const cols = {
        provisional_sets_json: JSON.stringify(v.sets),
        provisional_home_score: v.home,
        provisional_away_score: v.away,
        provisional_source: decision.source,
        provisional_by_name: byName,
        provisional_at: now,
      }
      const provisional = { sets: v.sets, home: v.home, away: v.away, source: decision.source, by_name: byName, at: now.toISOString() }

      const logEntry = () => writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'result_entered',
        collection: 'games',
        recordId: game.id,
        data: { sets: v.sets, source: decision.source, force },
      })

      if (decision.action === 'skip') {
        // Nothing goes to VM, so neither the account nor the lease is taken. A
        // missing VM config is a skip like the others: the score IS stored.
        await database('games').where('id', game.id).update({
          ...cols,
          vm_result_status: 'skipped',
          vm_result_error: decision.reason,
          vm_result_claimed_at: null,
        })
        await logEntry()
        return res.json({ ok: true, provisional, vm: { status: 'skipped', error: decision.reason } })
      }

      if (isSvrzRcBlackout(new Date())) {
        // svrz_rc is on the shared account: store and queue, no account, no spawn. No
        // lease either (claimed_at NULL marks it queued, and the stale-lease reclaim
        // leaves it alone) — but the UPDATE still refuses to clobber a push in flight.
        const queued = await database('games').where('id', game.id).whereRaw(LEASE_FREE_SQL).update({
          ...cols,
          vm_result_status: 'pending',
          vm_result_error: QUEUED_WINDOW,
          vm_result_claimed_at: null,
        })
        if (!queued) {
          log.info(`[game-result] ${game.id}: rejected, a push is already in flight`)
          return fail(res, 409, 'A result push for this game is already running — give it a minute', 'push_running')
        }
        log.info(`[game-result] ${game.id}: queued for the next sweep (svrz_rc VM window)`)
        await logEntry()
        return res.json({ ok: true, provisional, vm: { status: 'pending', error: QUEUED_WINDOW } })
      }

      const push = await spawnResultPush({ database, log, gameId: game.id, sets: v.sets, force, cols })
      if (push.code === 'vm_account_busy') {
        log.info(`[game-result] ${game.id}: rejected, the shared VM account is busy (${push.holder})`)
        return fail(res, 409, 'Volleymanager is busy with another sync — try again in a few minutes', 'vm_account_busy', { holder: push.holder })
      }
      if (push.code === 'push_running') {
        log.info(`[game-result] ${game.id}: rejected, a push is already in flight`)
        return fail(res, 409, 'A result push for this game is already running — give it a minute', 'push_running')
      }
      await logEntry()
      if (push.code === 'spawn_failed') {
        return res.json({ ok: true, provisional, vm: { status: 'failed', error: 'spawn_failed' } })
      }
      return res.json({ ok: true, provisional, vm: { status: 'pending' } })
    } catch (err) {
      log.error(`[game-result] POST ${req.params.gameId}: ${err.message}`)
      fail(res, 500, 'Internal error', 'internal')
    }
  })
}

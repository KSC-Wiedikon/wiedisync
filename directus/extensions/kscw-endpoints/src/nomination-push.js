/**
 * Manual "push now" for the Volleymanager Einsatzliste.
 *
 * The T-60 cron (kscw-hooks) does this automatically for games whose
 * auto_nomination_list flag resolves to true. This endpoint is the escape hatch:
 * a coach whose push failed, or who wants the list filed early, can trigger the
 * same worker on demand — including for a game whose flag is off.
 *
 * POST /kscw/games/:id/nomination-push   → { spawned: true, queued, position }
 * GET  /kscw/games/:id/nomination-preview → what a push would send (DB only, no VM)
 *
 * The club SAVES the list; the referee closes it after the game. Refused once the
 * game has started — from then on the list is the referee's.
 *
 * Fire-and-forget, exactly like the cron: the worker writes its outcome onto the
 * game (vm_nomination_status/_error) and the UI polls that, so a slow or failing
 * VM never hangs the request.
 *
 * ⚠ This writes into the real Swiss Volley production system — there is no VM
 * staging. Hence the tight authz: only a coach/TR of the playing team, or a sport
 * admin, may file a list on that team's behalf.
 *
 * ⚠ …and hence the lease: this endpoint and the cron BOTH claim the same
 * `games` row with the same predicate before spawning anything, so only one
 * worker per fixture can be in flight. See the claim below.
 *
 * ⚠ …and ONE push at a time ACROSS fixtures: requests from different teams join a
 * FIFO (createSerialQueue) that holds the shared-VM-account claim per worker, so
 * two teams pressing at once never put two logins on the account. The head coach
 * (C) is required — refused with 422 `no_head_coach` / `head_coach_no_licence`.
 */
import { writeUserLog } from './activity-log.js'
import { claimVmAccount, vmAccountHeldBy } from './vm-account-lock.js'
import { gameStartMs } from './scorer-roster.js'

// ⚠ MIRROR of pickOfficials() in directus/scripts/vm-push-nomination.mjs — the
// worker is the one that acts on it, this only previews it. Change both.
const SLOT_ROLES = ['coach', 'assistant_coach_1', 'assistant_coach_2']
export function pickOfficials(savedRows, teamDefault) {
  const out = {}
  const rows = (savedRows ?? []).filter(Boolean)
  if (rows.some((r) => SLOT_ROLES.includes(r.role))) {
    for (const role of SLOT_ROLES) {
      const row = rows.find((r) => r.role === role)
      if (!row) out[role] = null
      else out[role] = row.member == null ? undefined : Number(row.member)
    }
    return { source: 'game', slots: out }
  }
  for (const role of SLOT_ROLES) {
    const id = teamDefault?.[role]
    out[role] = id == null || id === '' ? undefined : Number(id)
  }
  return { source: 'team', slots: out }
}

/**
 * Who goes up as C / AC1 / AC2 for this game, as display rows, plus the head-coach
 * gate. C is REQUIRED (VM fines a list without one); AC1/AC2 are optional. "Set"
 * means we name a member WITH a licence number — without one VM cannot find them.
 */
async function resolveOfficials(database, gameId, teamId) {
  const [savedOfficials, team] = await Promise.all([
    database('game_roster_officials').where('game', gameId).select('member', 'role'),
    database('teams').where('id', teamId).first('features_enabled'),
  ])
  const fe = typeof team?.features_enabled === 'string' ? JSON.parse(team.features_enabled) : team?.features_enabled
  const picked = pickOfficials(savedOfficials, fe?.nomination_officials)
  const ids = Object.values(picked.slots).filter((v) => typeof v === 'number')
  const people = ids.length
    ? await database('members').whereIn('id', ids).select('id', 'first_name', 'last_name', 'license_nr')
    : []
  const officials = {}
  for (const role of SLOT_ROLES) {
    const v = picked.slots[role]
    if (v === undefined) { officials[role] = { keep: true }; continue }
    if (v === null) { officials[role] = null; continue }
    const m = people.find((x) => Number(x.id) === v)
    officials[role] = m
      ? { member: Number(m.id), name: `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim(), license_nr: m.license_nr || null }
      : { member: v, name: null, license_nr: null }
  }
  const c = officials.coach
  const headCoach = !c || 'keep' in c ? 'missing' : !c.license_nr ? 'no_licence' : 'ok'
  return { source: picked.source, officials, headCoach }
}

/**
 * A FIFO that runs ONE job at a time, each only while holding `claim(job)` — the
 * shared-VM-account claim. A busy account is waited for (polled every `pollMs`, up
 * to `waitMs`), never refused; past that the job is handed to `onGiveUp`. The claim
 * is released only after `run` settles, i.e. after the worker has EXITED.
 * Returns `enqueue(job) → position` (1 = runs now).
 */
export function createSerialQueue({ claim, run, onGiveUp, onError, waitMs, pollMs = 3000 }) {
  const queue = []
  let draining = false

  async function waitForClaim(job) {
    const until = Date.now() + waitMs
    for (;;) {
      const release = claim(job)
      if (release) return release
      if (Date.now() >= until) return null
      await new Promise((r) => setTimeout(r, pollMs))
    }
  }

  async function drain() {
    if (draining) return
    draining = true
    try {
      while (queue.length) {
        const job = queue.shift()
        const release = await waitForClaim(job)
        if (!release) { await onGiveUp?.(job); continue }
        try { await run(job) } catch (err) { await onError?.(job, err) } finally { release() }
      }
    } finally {
      draining = false
    }
  }

  return function enqueue(job) {
    queue.push(job)
    const position = queue.length + (draining ? 1 : 0)
    void drain()
    return position
  }
}

/** Sport admin, or coach / TR of the game's (active) team. */
async function mayFile(database, accountability, teamId) {
  if (accountability?.admin) return true
  if (teamId == null || !accountability?.user) return false
  const me = await database('members').where({ user: accountability.user }).first('id')
  // Active team only (audit 2026-09-28 F31): a seat on an archived team grants nothing.
  const teamActive = await database('teams').where({ id: teamId, active: true }).first('id')
  if (!me || !teamActive) return false
  const [coach, tr] = await Promise.all([
    database('teams_coaches').where({ teams_id: teamId, members_id: me.id }).first('id'),
    database('teams_responsibles').where({ teams_id: teamId, members_id: me.id }).first('id'),
  ])
  return !!coach || !!tr
}

export function registerNominationPush(router, { database, logger }) {
  const log = logger || console

  // ── The manual-push queue ─────────────────────────────────────────────────
  // Process-local, like the account claim itself (one Directus process). A
  // restart loses queued jobs; their rows are 'pending' and the cron's lease
  // sweep turns them into 'failed' after 10 minutes, which re-offers the button.
  // How long a queued push waits for the account before giving up. Under the
  // 10-minute row lease, so the cron never reclaims a row this is still serving.
  const ACCOUNT_WAIT_MS = 8 * 60 * 1000
  const WORKER_MAX_MS = 3 * 60 * 1000

  const enqueue = createSerialQueue({
    claim: (job) => claimVmAccount(`nomination-push:manual:${job.gameId}`),
    waitMs: ACCOUNT_WAIT_MS,
    run: async (job) => {
      // Fresh lease from the moment the worker actually starts.
      await database('games').where('id', job.gameId).update({ vm_nomination_claimed_at: database.fn.now() })
      await runWorker(job.gameId)
    },
    onGiveUp: async (job) => {
      log.warn?.({ msg: `[nomination-push] game ${job.gameId}: account busy for ${ACCOUNT_WAIT_MS / 60000} min — gave up (${vmAccountHeldBy()})`, game: job.gameId })
      await database('games').where('id', job.gameId).update({
        vm_nomination_status: 'failed',
        vm_nomination_error: 'Volleymanager stayed busy with another sync — please press again in a few minutes',
        vm_nomination_claimed_at: null,
      }).catch(() => {})
    },
    onError: async (job, err) => {
      log.error?.({ msg: `[nomination-push] game ${job.gameId}: ${err.message}`, game: job.gameId })
      await database('games').where('id', job.gameId).update({
        vm_nomination_status: 'failed',
        vm_nomination_error: 'Could not start the push',
        vm_nomination_claimed_at: null,
      }).catch(() => {})
    },
  })

  async function runWorker(gameId) {
    const { spawn } = await import('node:child_process')
    const { openSync } = await import('node:fs')
    let logOut
    try { logOut = openSync('/directus/logs/vm-nomination.log', 'a') } catch { logOut = 'ignore' }
    const child = spawn('node', ['/directus/scripts/vm-push-nomination.mjs'], {
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
        // Lets the worker refuse to write from the dev DB — VM has no staging.
        DB_DATABASE: process.env.DB_DATABASE || '',
        VM_NOMINATION_ALLOW_DEV_WRITE: process.env.VM_NOMINATION_ALLOW_DEV_WRITE || '',
      },
    })
    child.unref()
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      const timer = setTimeout(() => {
        log.warn?.({ msg: `[nomination-push] game ${gameId}: worker hung — killed`, game: gameId })
        try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch { /* gone */ } }
      }, WORKER_MAX_MS)
      child.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }

  // ── Preview: what "Update Einsatzliste" would send. DB only — eligibility in VM
  // (validated licence for this team) is only known once the worker asks VM, and
  // lands in vm_nomination_error as a note.
  router.get('/games/:id/nomination-preview', async (req, res) => {
    const gameId = Number(req.params.id)
    if (!Number.isInteger(gameId)) return res.status(400).json({ error: 'Invalid game id' })
    try {
      const game = await database('games').where('id', gameId)
        .first('id', 'game_id', 'kscw_team', 'date', 'time', 'vm_nomination_status', 'vm_nomination_list_id')
      if (!game) return res.status(404).json({ error: 'Game not found' })
      if (!(await mayFile(database, req.accountability, game.kscw_team))) {
        return res.status(403).json({ error: 'Not a coach of this team', code: 'forbidden' })
      }

      // Same selection as the worker: confirmed RSVPs ∩ the team's roster, guests excluded.
      const players = await database('participations as p')
        .join('member_teams as mt', function () {
          this.on('mt.member', '=', 'p.member').andOn('mt.team', '=', database.raw('?', [game.kscw_team]))
        })
        .join('members as m', 'm.id', 'p.member')
        .where({ 'p.activity_type': 'game', 'p.activity_id': String(gameId), 'p.status': 'confirmed', 'mt.guest_level': 0 })
        .distinct('m.id', 'm.first_name', 'm.last_name', 'm.license_nr')
        .orderBy([{ column: 'm.last_name' }, { column: 'm.first_name' }])

      const { source, officials, headCoach } = await resolveOfficials(database, gameId, game.kscw_team)

      const startMs = gameStartMs(game)
      res.json({
        data: {
          players: players.map((m) => ({
            member: Number(m.id),
            name: `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim(),
            license_nr: m.license_nr || null,
          })),
          officials,
          officials_source: source,
          // 'ok' | 'missing' | 'no_licence' — the push is refused unless 'ok'.
          head_coach: headCoach,
          status: game.vm_nomination_status ?? null,
          // A list is already in VM (a re-save replaces it) / the referee closed it.
          exists: ['saved', 'filled'].includes(game.vm_nomination_status),
          closed: game.vm_nomination_status === 'closed',
          started: startMs != null && Date.now() >= startMs,
        },
      })
    } catch (err) {
      log.error?.({ msg: `[nomination-preview] ${err.message}`, game: gameId, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  router.post('/games/:id/nomination-push', async (req, res) => {
    const gameId = Number(req.params.id)
    if (!Number.isInteger(gameId)) return res.status(400).json({ error: 'Invalid game id' })

    if (!process.env.VM_USERNAME || !process.env.VM_PASSWORD) {
      return res.status(503).json({ error: 'Volleymanager is not configured', code: 'vm_unconfigured' })
    }

    // The reads below run before any claim is taken, so a DB error here has
    // nothing to hand back — but it must become a 500, not an unhandled
    // rejection that leaves the request hanging (Express 4 does not catch it).
    let game
    let allowed = false
    try {
      game = await database('games').where('id', gameId)
        .first('id', 'game_id', 'kscw_team', 'status', 'date', 'time',
          // Read as-found so a failed spawn can hand the claim straight back.
          'vm_nomination_status', 'vm_nomination_error', 'vm_nomination_claimed_at')
      // Authz: a sport admin, or a coach / team responsible of the playing team.
      if (game) allowed = await mayFile(database, req.accountability, game.kscw_team)
    } catch (err) {
      log.error?.({ msg: `[nomination-push] lookup failed: ${err.message}`, game: gameId, stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
    if (!game) return res.status(404).json({ error: 'Game not found' })
    if (!String(game.game_id ?? '').startsWith('vb_')) {
      return res.status(422).json({ error: 'Only volleyball games have an Einsatzliste', code: 'not_volleyball' })
    }
    if (game.kscw_team == null) {
      return res.status(422).json({ error: 'Game has no KSCW team', code: 'no_team' })
    }

    if (!allowed) return res.status(403).json({ error: 'Not a coach of this team', code: 'forbidden' })

    const startMs = gameStartMs(game)
    if (startMs != null && Date.now() >= startMs) {
      return res.status(422).json({ error: 'The game has started — the Einsatzliste can no longer be changed from here', code: 'game_started' })
    }

    // The head coach is REQUIRED — a list without one is fineable, and VM can only
    // find a person by licence. Refused here, before any claim, so nothing changes.
    try {
      const { headCoach } = await resolveOfficials(database, gameId, game.kscw_team)
      if (headCoach !== 'ok') {
        return res.status(422).json({
          error: headCoach === 'missing' ? 'No head coach (C) set for this game' : 'The head coach (C) has no licence number',
          code: headCoach === 'missing' ? 'no_head_coach' : 'head_coach_no_licence',
        })
      }
    } catch (err) {
      log.error?.({ msg: `[nomination-push] officials lookup failed: ${err.message}`, game: gameId })
      return res.status(500).json({ error: 'Internal error' })
    }

    // ── Claim the game ────────────────────────────────────────────────────────
    // One conditional UPDATE: Postgres takes the row lock, so two callers on the
    // SAME fixture (coach + TR on two phones, or coach vs the T-60 cron) serialize
    // and the loser matches 0 rows → 409. The cron takes the same claim with the
    // same predicate and lease; keep them in step. The lease (migration 354) lets
    // the cron hand a row whose worker died back as 'failed' after 10 minutes.
    let claimed
    try {
      claimed = await database('games').where('id', gameId)
        .whereRaw(
          "(COALESCE(vm_nomination_status, '') <> 'pending'"
          + ' OR vm_nomination_claimed_at IS NULL'
          + " OR vm_nomination_claimed_at < now() - interval '10 minutes')",
        )
        .update({
          vm_nomination_status: 'pending',
          vm_nomination_error: null,
          vm_nomination_claimed_at: database.fn.now(),
        })
    } catch (err) {
      log.error?.({ msg: `[nomination-push] row claim failed: ${err.message}`, game: gameId })
      return res.status(500).json({ error: 'Internal error' })
    }
    if (!claimed) {
      log.info?.({ msg: '[nomination-push] rejected: a push is already in flight', game: gameId })
      return res.status(409).json({
        error: 'A push for this game is already running — give it a minute',
        code: 'push_in_flight',
      })
    }

    // ── Queue it ─────────────────────────────────────────────────────────────
    // Two DIFFERENT teams pressing at once must not put two logins on the one
    // shared VM account (nor overlap vm_sync, the SVRZ sync or the T-60 cron).
    // So the request never spawns directly: it joins a FIFO that runs one worker
    // at a time, each under claimVmAccount — the same process-wide claim every
    // VM job here takes — and waits for the account rather than refusing.
    const position = enqueue({ gameId })

    // Raw spawn → no Directus revision trail. Saving an official document on the
    // club's behalf is exactly the kind of state change the audit log exists for.
    await writeUserLog(database, log, {
      accountability: req.accountability,
      action: 'update',
      collection: 'games',
      recordId: gameId,
      data: { what: 'nomination_push', team: game.kscw_team, manual: true, queue_position: position },
    })

    return res.json({ spawned: true, queued: position > 1, position })
  })
}

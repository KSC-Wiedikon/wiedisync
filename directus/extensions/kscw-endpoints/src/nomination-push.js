/**
 * Manual "push now" for the Volleymanager Einsatzliste.
 *
 * The T-60 cron (kscw-hooks) does this automatically for games whose
 * auto_nomination_list flag resolves to true. This endpoint is the escape hatch:
 * a coach whose push failed, or who wants the list filed early, can trigger the
 * same worker on demand — including for a game whose flag is off.
 *
 * POST /kscw/games/:id/nomination-push   → { spawned: true }
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

      const [savedOfficials, team] = await Promise.all([
        database('game_roster_officials').where('game', gameId).select('member', 'role'),
        database('teams').where('id', game.kscw_team).first('features_enabled'),
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

      const startMs = gameStartMs(game)
      res.json({
        data: {
          players: players.map((m) => ({
            member: Number(m.id),
            name: `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim(),
            license_nr: m.license_nr || null,
          })),
          officials,
          officials_source: picked.source,
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

    // ── Claim the SHARED Volleymanager account, BEFORE the row ────────────────
    //
    // Two different shared things, two different claims. The row claim below
    // stops a second worker on this fixture; this one stops a worker of any kind
    // running while vm_sync, the SVRZ sync or an admin's "Sync now" holds the
    // account — VM keeps the active role per ACCOUNT and the worker's vmLogin()
    // switches it, so an overlap reads under somebody else's role, where VM
    // answers 200 with the WRONG ROWS as readily as 403.
    //
    // Order matters: the row claim writes 'pending', and a row left at 'pending'
    // with no worker behind it hides the coach's button (which renders only for
    // 'failed') until the 10-minute lease runs out. Refusing BEFORE that write
    // leaves the game exactly as it was, so the coach can press again in a
    // moment rather than being locked out of their own fixture.
    const releaseVmAccount = claimVmAccount('nomination-push:manual')
    if (!releaseVmAccount) {
      const holder = vmAccountHeldBy()
      log.info?.({ msg: `[nomination-push] rejected: the shared VM account is busy (${holder})`, game: gameId })
      return res.status(409).json({
        error: 'Volleymanager is busy with another sync — try again in a few minutes',
        code: 'vm_account_busy',
        holder,
      })
    }

    // ── Claim the game, then spawn ────────────────────────────────────────────
    // The T-60 cron (kscw-hooks/src/index.js) retries exactly the states this
    // button is offered for, so cron-vs-coach — and coach-vs-team-responsible on
    // two phones — really do land seconds apart on one fixture. Two detached
    // workers on one game create two Einsatzlisten in the REAL Swiss Volley
    // system, or one reopens the list the other has just closed, and both then
    // race to stamp the journal (last writer wins, so the coach can be shown
    // 'failed' for a list that is filed).
    //
    // One conditional UPDATE is the whole guard: Postgres takes the row lock, so
    // two callers serialize and the loser matches 0 rows and gets a 409. The cron
    // takes the SAME claim on the SAME row with the SAME predicate and lease —
    // keep the two in sync, a guard only one of the two actors honours is none.
    // Keyed on the single game id, so pushes for different fixtures never wait.
    //
    // ⚠⚠ The lease MUST be able to expire. A worker killed mid-run (every
    // `ext:deploy` restarts this container) never writes its terminal status, so
    // a claim without an expiry would strand the row at 'pending' for ever — the
    // cron skips it and the coach's button, which only renders for 'failed',
    // cannot reach it, so the list could never be filed at all. That is what
    // `vm_nomination_claimed_at` (migration 354) is for: after 10 minutes the
    // claim is reclaimable. A worker that finishes releases implicitly — finish()
    // writes a terminal status, and anything not 'pending' is claimable again at
    // once. This also folds in the old post-spawn "clear the previous failure so
    // the UI shows in progress" write, which a fast worker could otherwise beat.
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
      // Nothing spawned — give the account back rather than holding it for the lease.
      releaseVmAccount()
      log.error?.({ msg: `[nomination-push] row claim failed: ${err.message}`, game: gameId })
      return res.status(500).json({ error: 'Internal error' })
    }
    if (!claimed) {
      // Nothing was spawned, so the account goes straight back — otherwise a
      // rejected button press would lock every VM job out for the lease.
      releaseVmAccount()
      log.info?.({ msg: '[nomination-push] rejected: a push is already in flight', game: gameId })
      return res.status(409).json({
        error: 'A push for this game is already running — give it a minute',
        code: 'push_in_flight',
      })
    }

    // Set the instant the child is away; the catch below must not release the
    // claim once a worker is running against the real Swiss Volley system.
    let spawned = false
    try {
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
      // Detached, so the request returns long before the worker does — but the
      // account stays claimed until it actually exits. Leased and process-local,
      // so a hung worker loses it after VM_LEASE_MS and a restart clears it.
      child.once('exit', () => releaseVmAccount())
      child.unref()
      // ⚠ Past this point a worker IS running against the real Swiss Volley system.
      // The catch below must not release the claim, or the row returns to 'failed' —
      // which both re-renders the coach's button and makes it cron-claimable within
      // 5 minutes, i.e. a SECOND Einsatzliste filed while the first worker is still
      // going. Today the only await after this is writeUserLog, which swallows its
      // own errors, so the catch is unreachable by accident; this flag makes it
      // unreachable by construction.
      spawned = true

      // Raw spawn → no Directus revision trail. Filing an official document on the
      // club's behalf is exactly the kind of state change the audit log exists for.
      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'update',
        collection: 'games',
        recordId: gameId,
        data: { what: 'nomination_push', team: game.kscw_team, manual: true },
      })

      return res.json({ spawned: true })
    } catch (err) {
      log.error?.({ msg: `[nomination-push] spawn failed: ${err.message}`, game: gameId })
      // Release ONLY when no worker got away — see the flag above. If one did, the
      // lease is what ends the claim, not this handler.
      if (spawned) return res.status(500).json({ error: 'Could not start the push' })
      // Nothing is running, so give BOTH claims back now rather than making the
      // game wait out a lease. The account one has no child to release it — the
      // throw happened before there was a child — and holding it would keep
      // vm_sync and the SVRZ sync out for twenty minutes over a spawn that never
      // touched Volleymanager at all.
      releaseVmAccount()
      // The row claim next: 'pending' hides the Push now button. Restores the
      // journal exactly as this request found it, so a failed spawn changes nothing.
      try {
        await database('games').where('id', gameId).update({
          vm_nomination_status: game.vm_nomination_status ?? null,
          vm_nomination_error: game.vm_nomination_error ?? null,
          vm_nomination_claimed_at: game.vm_nomination_claimed_at ?? null,
        })
      } catch (releaseErr) {
        log.warn?.({ msg: `[nomination-push] claim release failed: ${releaseErr.message}`, game: gameId })
      }
      return res.status(500).json({ error: 'Could not start the push' })
    }
  })
}

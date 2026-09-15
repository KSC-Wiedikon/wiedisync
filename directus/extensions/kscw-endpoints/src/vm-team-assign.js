/**
 * VolleyManager team rosters — put our players onto their VM team.
 *
 * The club must list, per VM team and season, the licensed players it may
 * nominate. VM only offers players whose licence is ACTIVATED, so the list is
 * built in waves: the bulk after the season rollover, then one more player at
 * a time as late licences come through. This endpoint is the "one more" button:
 * it diffs every active volleyball team's `member_teams` roster (guest_level 0)
 * against VM live and assigns whoever VM now offers. Add-only — see the module
 * header of directus/scripts/vm-team-players.mjs for the rules.
 *
 *   GET  /kscw/admin/vm-team-assign          plan from OUR data + the last run
 *   POST /kscw/admin/vm-team-assign          { dry_run?: bool, team_ids?: number[] }
 *                                            → 202 { started: true }; poll the GET
 *
 * The GET plan is computed from `sv_vm_check` (Monday's VM snapshot) so it
 * costs nothing and never touches VM; the POST is the truth, read live. The
 * two disagree exactly when a licence was activated since Monday — which is
 * the case the button exists for.
 *
 * Runs IN-PROCESS in the background (no child): the module is imported from the
 * scripts bind-mount like vm-nomination-list.js does, the request returns 202
 * and the UI polls. State is module-local, so a container restart forgets the
 * last result — the audit trail (`user_logs`) and the `sync_runs` heartbeat
 * survive it.
 *
 * ⚠ There is no VM staging. On the dev database the run is forced to a dry
 * run unless VM_TEAM_ASSIGN_ALLOW_DEV_WRITE=1, same guard as the nomination
 * push — dev holds a clone of prod's rosters, so a "test" from dev would be a
 * real assignment in the real Swiss Volley system.
 */
import { claimVmAccount, vmAccountHeldBy } from './vm-account-lock.js'
import { writeUserLog } from './activity-log.js'
import { logCronRun } from './error-log.js'

const VM_TEAM_PLAYERS = '/directus/scripts/vm-team-players.mjs'
const SYNC_SOURCE = 'vm_team_assign'

const IS_DEV_DB = /dev/i.test(process.env.DB_DATABASE || '')
const DEV_WRITE_ALLOWED = !!process.env.VM_TEAM_ASSIGN_ALLOW_DEV_WRITE
export const FORCED_DRY = IS_DEV_DB && !DEV_WRITE_ALLOWED

/** Same gate as licence-status: Directus admin, or a club / sport admin member. */
async function adminGate(database, req) {
  if (req.accountability?.admin) return true
  const userId = req.accountability?.user
  if (!userId) return false
  const m = await database('members').where('user', userId).first('role')
  if (!m) return false
  const roles = Array.isArray(m.role)
    ? m.role
    : (m.role ? (() => { try { return JSON.parse(m.role) } catch { return [] } })() : [])
  return ['superuser', 'admin', 'vb_admin'].some((r) => roles.includes(r))
}

async function actorName(database, req) {
  const userId = req.accountability?.user
  if (!userId) return null
  const m = await database('members').where('user', userId).first('first_name', 'last_name')
  return m ? `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || null : null
}

/**
 * Flat (team, player) rows for every active volleyball team — the shape
 * `buildWanted` consumes. Players only: `member_teams` IS the player roster
 * (coaches / TRs live in their own junctions and are not VM "Spieler").
 */
export function rosterRowsSql(database, teamIds = null) {
  const q = database('member_teams as mt')
    .join('teams as t', 't.id', 'mt.team')
    .join('members as m', 'm.id', 'mt.member')
    .where('t.sport', 'volleyball')
    .where('t.active', true)
    .where('mt.guest_level', 0)
    .select(
      't.id as team_db_id', 't.team_id', 't.name as team_name',
      'm.id as member_id', 'm.license_nr', 'm.first_name', 'm.last_name',
    )
    .orderBy(['t.name', 'm.last_name', 'm.first_name'])
  if (Array.isArray(teamIds) && teamIds.length) q.whereIn('t.id', teamIds)
  return q
}

/**
 * The plan from our own data. `sv_vm_check.team_ids` is a comma list of VM
 * staticTeamIdentifiers per licence, refreshed by the Monday vm_sync — so
 * "on VM" here means "as of that sync", and any function on the team counts
 * (a player-coach reads as on). The live run is what decides.
 */
/**
 * `members.license_nr` is a varchar with significant leading zeros ('038514')
 * and the odd hand-typed placeholder; `sv_vm_check.association_id` is an
 * integer. Compare as the integer's decimal string, and treat a non-numeric
 * value as "no licence number" rather than as a lookup that can never hit.
 */
export function normalizeLicenceNr(value) {
  const s = String(value ?? '').trim()
  return /^[0-9]+$/.test(s) ? String(BigInt(s)) : null
}

/**
 * `sv_vm_check.team_ids` is written by vm-sync-check.mjs as `join(', ')` —
 * comma AND space — so a bare `,${id},` probe only ever matched the first
 * team (2026-09-15: every multi-team player read as "assignable"). Split and
 * trim instead; tolerates either spelling.
 */
export function isOnVmTeam(teamIds, staticId) {
  if (!teamIds || !staticId) return false
  return String(teamIds).split(',').map((s) => s.trim()).filter(Boolean).includes(String(staticId))
}

export async function buildPlanFromDb(database, staticIdFromTeamId) {
  const rows = await rosterRowsSql(database)
  const licences = [...new Set(rows.map((r) => normalizeLicenceNr(r.license_nr)).filter(Boolean))]
  const checks = licences.length
    ? await database('sv_vm_check').whereIn(database.raw('association_id::text'), licences)
      .select('association_id', 'licence_activated', 'licence_validated', 'team_ids', 'synced_at')
    : []
  const byLicence = new Map(checks.map((c) => [String(c.association_id), c]))
  const syncedAt = checks.reduce((max, c) => (c.synced_at && (!max || c.synced_at > max) ? c.synced_at : max), null)

  const teams = new Map()
  for (const r of rows) {
    const staticId = staticIdFromTeamId(r.team_id)
    let t = teams.get(r.team_db_id)
    if (!t) {
      t = { teamDbId: r.team_db_id, teamName: r.team_name, staticId, hasVmTeam: !!staticId, players: [] }
      teams.set(r.team_db_id, t)
    }
    const licenseNr = normalizeLicenceNr(r.license_nr)
    const check = licenseNr ? byLicence.get(licenseNr) : null
    const onTeam = isOnVmTeam(check?.team_ids, staticId)
    let status
    if (!staticId) status = 'no_vm_team'
    else if (!licenseNr) status = 'no_licence_nr'
    else if (!check) status = 'unknown_to_vm'
    else if (onTeam) status = 'on_vm_team'
    else if (check.licence_activated) status = 'assignable'
    else status = 'licence_pending'
    t.players.push({
      memberId: r.member_id,
      name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || `#${r.member_id}`,
      licenseNr,
      status,
      licenceActivated: check?.licence_activated ?? null,
      licenceValidated: check?.licence_validated ?? null,
    })
  }
  const list = [...teams.values()].sort((a, b) => a.teamName.localeCompare(b.teamName))
  const totals = { assignable: 0, licence_pending: 0, on_vm_team: 0, no_licence_nr: 0, unknown_to_vm: 0, no_vm_team: 0 }
  for (const t of list) for (const p of t.players) totals[p.status]++
  return { teams: list, totals, vmSyncedAt: syncedAt }
}

export function registerVmTeamAssign(router, { database, logger }) {
  const log = logger || console

  // The one run in flight, and the last one that finished. Process-local by
  // design (see the header).
  const state = { running: null, last: null }

  const publicRun = (run) => (run ? {
    status: run.status, dryRun: run.dryRun, forcedDryRun: run.forcedDryRun, startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? null, actor: run.actor, progress: run.progress, log: run.log,
    error: run.error ?? null, result: run.result ?? null,
  } : null)

  router.get('/admin/vm-team-assign', async (req, res) => {
    try {
      if (!(await adminGate(database, req))) return res.status(403).json({ error: 'Forbidden' })
      const mod = await import(VM_TEAM_PLAYERS)
      const plan = await buildPlanFromDb(database, mod.staticIdFromTeamId)
      const heartbeat = await database('sync_runs').where('source', SYNC_SOURCE).first()
      res.json({
        ...plan,
        running: publicRun(state.running),
        lastRun: publicRun(state.last),
        heartbeat: heartbeat ? { lastRunAt: heartbeat.last_run_at, status: heartbeat.status, rowsChanged: heartbeat.rows_changed, error: heartbeat.error_message } : null,
        vmConfigured: !!(process.env.VM_USERNAME && process.env.VM_PASSWORD),
        forcedDryRun: FORCED_DRY,
        vmAccountHeldBy: vmAccountHeldBy(),
      })
    } catch (err) {
      log.error?.({ msg: `[vm-team-assign] plan failed: ${err.message}` })
      res.status(500).json({ error: 'Could not build the plan' })
    }
  })

  router.post('/admin/vm-team-assign', async (req, res) => {
    try {
      if (!(await adminGate(database, req))) return res.status(403).json({ error: 'Forbidden' })
      if (!process.env.VM_USERNAME || !process.env.VM_PASSWORD) {
        return res.status(503).json({ error: 'Volleymanager is not configured', code: 'vm_unconfigured' })
      }
      if (state.running) {
        return res.status(409).json({ error: 'A run is already in progress', code: 'run_in_flight' })
      }
      const wantDry = req.body?.dry_run === true || req.body?.dry_run === 1 || req.body?.dry_run === '1'
      const dryRun = wantDry || FORCED_DRY
      const teamIds = Array.isArray(req.body?.team_ids)
        ? req.body.team_ids.map(Number).filter(Number.isInteger)
        : null

      // Everything is built BEFORE the account is claimed, so a bad request
      // never costs the other VM jobs a lease.
      const mod = await import(VM_TEAM_PLAYERS)
      const wanted = mod.buildWanted(await rosterRowsSql(database, teamIds))
      if (!wanted.length) return res.status(422).json({ error: 'No volleyball team with a VolleyManager id', code: 'nothing_to_do' })

      // ── The SHARED Volleymanager account ─────────────────────────────────
      // Same claim as every other VM job here: the worker's vmLogin switches
      // the account's role, and an overlap with vm_sync / svrz_sync / a
      // nomination push reads under someone else's role. Released when the run
      // settles; leased, so a hung VM cannot strand it.
      const releaseVmAccount = claimVmAccount(dryRun ? 'vm_team_assign:dry' : 'vm_team_assign')
      if (!releaseVmAccount) {
        const holder = vmAccountHeldBy()
        return res.status(409).json({
          error: 'Volleymanager is busy with another sync — try again in a few minutes',
          code: 'vm_account_busy', holder,
        })
      }

      const actor = await actorName(database, req)
      const accountability = req.accountability
      const run = {
        status: 'running', dryRun, forcedDryRun: FORCED_DRY && !wantDry, startedAt: new Date().toISOString(),
        actor, progress: { done: 0, total: wanted.length, team: '' }, log: [], teamIds,
      }
      state.running = run
      const startedMs = Date.now()

      // Fire and forget; the GET reports progress and the outcome.
      ;(async () => {
        try {
          const result = await mod.runTeamAssignment({
            username: process.env.VM_USERNAME,
            password: process.env.VM_PASSWORD,
            wanted,
            dryRun,
            log: (line) => { run.log.push(line); if (run.log.length > 200) run.log.shift() },
            onProgress: (p) => { run.progress = p },
          })
          run.result = result
          run.status = result.totals.failed ? 'partial' : 'ok'
          run.finishedAt = new Date().toISOString()
          if (!dryRun) {
            // Raw HTTP into VM: no Directus trail. The audit log is the only
            // record of WHO put WHOM on a team, so it carries the names.
            await writeUserLog(database, log, {
              accountability, action: 'update', collection: 'teams', recordId: null,
              data: {
                what: 'vm_team_assign',
                assigned: result.totals.assigned,
                pending: result.totals.pending,
                failed: result.totals.failed,
                teams: result.teams
                  .filter((t) => t.assigned.length || t.error)
                  .map((t) => ({ team: t.teamName, assigned: t.assigned.map((p) => `${p.name} (${p.licenseNr})`), error: t.error })),
              },
            })
            await logCronRun(database, SYNC_SOURCE, {
              status: result.totals.failed ? 'error' : 'ok',
              rowsChanged: result.totals.assigned,
              durationMs: Date.now() - startedMs,
              errorMessage: result.totals.failed
                ? result.teams.filter((t) => t.error).map((t) => `${t.teamName}: ${t.error}`).join('; ').slice(0, 900)
                : null,
            })
          }
          log.info?.(`[vm-team-assign] ${dryRun ? 'dry run' : 'run'} by ${actor ?? '?'}: ${result.totals.assigned} assigned, ${result.totals.pending} pending, ${result.totals.failed} failed`)
        } catch (err) {
          run.status = 'error'
          run.error = err.message
          run.finishedAt = new Date().toISOString()
          log.error?.({ msg: `[vm-team-assign] run failed: ${err.message}`, endpoint: 'admin/vm-team-assign' })
          if (!dryRun) {
            await logCronRun(database, SYNC_SOURCE, { status: 'error', durationMs: Date.now() - startedMs, errorMessage: err.message.slice(0, 900) }).catch(() => {})
          }
        } finally {
          state.last = run
          state.running = null
          releaseVmAccount()
        }
      })()

      res.status(202).json({ started: true, dryRun, forcedDryRun: run.forcedDryRun, teams: wanted.length })
    } catch (err) {
      log.error?.({ msg: `[vm-team-assign] start failed: ${err.message}`, endpoint: 'admin/vm-team-assign' })
      res.status(500).json({ error: 'Could not start the run' })
    }
  })
}

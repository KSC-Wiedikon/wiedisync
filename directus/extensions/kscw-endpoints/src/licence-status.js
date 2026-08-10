/**
 * Licence status — the club's own licence-ordering workflow (migration 301).
 *
 * `members.licence_status` is five states in order:
 *
 *   none → to_be_ordered → ordered → finalized → licenced
 *
 * The first four are human judgements typed in the Data Explorer or on
 * /admin/anmeldungen. The fifth is machine-asserted here, and ONLY here, from
 * the two registers that actually issue licences:
 *
 *   volleyball  sv_vm_check.licence_activated AND .licence_validated
 *               (activated = the club switched it on; validated = Swiss Volley
 *                reconciled the paperwork, which for a transfer means the ITC
 *                landed. Fielding an unvalidated licence is sanctionable, so
 *                "Licenced" has to mean both.)
 *   basketball  a basketplan_people row with a licence number, scraped on or
 *               after this season's 1 June rollover. Basketplan has no season
 *               column; the scrape date is the only thing that pins its licence
 *               list to a season, so a stale scrape confirms nobody.
 *
 * ── Two rules that are load-bearing ─────────────────────────────────────────
 *
 * 1. THE SWEEP PROMOTES, IT NEVER DEMOTES. A member sitting at `licenced` is
 *    left alone even if the register stops confirming them, and a member the
 *    register does not know is left at whatever a human last said. This is the
 *    same set-true-only rule vm-sync-check.mjs applies to scorer_vb/referee_vb,
 *    for the same reason: Volleymanager returns transient 403s and stalls (see
 *    the `vm_sync` deferral logic), Basketplan is scraped by hand, and absence
 *    of evidence is not evidence of absence. A register having a bad morning
 *    must not wipe the club's own records.
 *
 * 2. THE SEASON ROLLOVER IS THE ONLY DEMOTION. A licence is issued FOR a
 *    season, so `licence_status_season` carries the one it describes. When that
 *    stamp goes stale the sweep resets the row to `none` before re-promoting,
 *    which is what stops last season's green badge from reading as this
 *    season's. That reset is deliberately SILENT — 250 people receiving "Your
 *    licence status is now No licence" every 1 June would be alarming and
 *    would say nothing true. Only forward movement notifies.
 *
 *   POST /kscw/admin/licence-status/sync            run it
 *   POST /kscw/admin/licence-status/sync?dry_run=1  report it, write nothing
 *   GET  /kscw/admin/licence-status                 distribution + last run
 *
 * Runs daily from kscw-hooks (05:45 UTC — after the Monday 04:00 VM sync, so a
 * fresh licence lands the same morning it appears in Volleymanager).
 *
 * Writes go through knex, which bypasses the Directus activity trail, so the
 * actor is recorded on the row (`licence_status_by_name`) and in `user_logs`
 * per CLAUDE.md → "Audit logging".
 */

import { logCronRun } from './error-log.js'
import { writeUserLog } from './activity-log.js'
import { sendLocalizedPush } from './push-i18n.js'
import { sendPushToMembers } from './web-push.js'
import { FRONTEND_URL } from './email-template.js'

const SYNC_SOURCE = 'licence_status'

/** The closed set, in workflow order. Mirrors the CHECK constraint in migration
 *  301 and LICENCE_STATUSES in src/utils/licenceStatus.ts. */
export const LICENCE_STATUSES = ['none', 'to_be_ordered', 'ordered', 'finalized', 'licenced']

/** Rank for "may only move up" comparisons. */
export const LICENCE_STATUS_RANK = {
  none: 0, to_be_ordered: 1, ordered: 2, finalized: 3, licenced: 4,
}

export function isLicenceStatus(value) {
  return typeof value === 'string' && LICENCE_STATUSES.includes(value)
}

/**
 * Tell a member their licence status moved. In-app bell + web push, the push
 * in their own locale — the club decided admins are NOT copied, because the
 * admin is the one who just made the change.
 *
 * The bell row stores the i18n KEY as `title` and a variable bag as `body`;
 * NotificationPanel localizes at render time (same shape as fine_issued), so a
 * member who switches language later sees it in the new one.
 *
 * Never throws: a notification failure must not roll back the status change
 * that caused it.
 */
export async function notifyLicenceStatusChange(database, log, { memberId, status, season }) {
  if (!memberId || !isLicenceStatus(status)) return
  try {
    await database('notifications').insert({
      member: memberId,
      type: 'licence_status',
      title: 'licence_status_changed',
      body: JSON.stringify({ status, season: season || '' }),
      activity_type: '',
      activity_id: '',
      read: false,
    })
  } catch (err) {
    log?.warn?.({ msg: `[licence-status] bell insert failed: ${err.message}`, memberId, status })
  }
  try {
    await sendLocalizedPush(
      database, [memberId],
      (ids, title, body) => sendPushToMembers(database, ids, title, body, `${FRONTEND_URL}/profile`, `licence-status-${memberId}`, log),
      'licenceStatus.title', `licenceStatus.body.${status}`,
      { season: season || '' },
    )
  } catch (err) {
    log?.warn?.({ msg: `[licence-status] push failed: ${err.message}`, memberId, status })
  }
}

/**
 * The whole sweep, as one function so the endpoint and the cron share it byte
 * for byte rather than drifting the way a copied cohort rule always does.
 *
 * @returns {Promise<{season: string, reset: number, promoted: Array, dryRun: boolean}>}
 */
export async function runLicenceStatusSweep(database, log, { dryRun = false, actorName = null } = {}) {
  const [{ season }] = (await database.raw('SELECT public.kscw_current_season_label() AS season')).rows

  // ── 1. Season rollover ────────────────────────────────────────────────────
  // Anything stamped with another season (or never stamped) is last season's
  // answer. Reset to `none` and re-stamp; the promotion pass below then earns
  // `licenced` back for whoever the registers still confirm, in the same run.
  // IS DISTINCT FROM, not `<>` — a NULL stamp (never swept, or a member row
  // created by a raw-knex path that did not set one) must count as stale, and
  // `licence_status_season <> '2026/27'` is NULL for those rows, so they would
  // sail through untouched carrying whatever status they were born with.
  const staleIds = (await database('members')
    .whereRaw('licence_status_season IS DISTINCT FROM ?', [season])
    .select('id')).map((r) => r.id)

  if (!dryRun && staleIds.length > 0) {
    await database('members').whereIn('id', staleIds).update({
      licence_status: 'none',
      licence_status_season: season,
      licence_status_updated_at: database.fn.now(),
      licence_status_by_name: 'Season rollover',
    })
  }

  // ── 2. Promotion ──────────────────────────────────────────────────────────
  // One query, both registers, and deliberately NOT filtered to `none`: a
  // member parked at `ordered` or `finalized` whose licence the federation has
  // since confirmed is exactly who this is for. Rows already at `licenced` are
  // excluded because promoting them is a no-op that would notify.
  //
  // ⚠ association_id is bigint; license_nr is a varchar that legitimately holds
  // leading zeros and, on a handful of rows, hand-typed non-numeric
  // placeholders. The digits-only guard is what stops one placeholder from
  // throwing on the whole statement — the same trap TransfersPage.tsx documents
  // for its `_in` list.
  const { rows: candidates } = await database.raw(`
    SELECT m.id, m.first_name, m.last_name, m.licence_status AS from_status,
           EXISTS (
             SELECT 1 FROM sv_vm_check s
              WHERE btrim(coalesce(m.license_nr, '')) ~ '^[0-9]+$'
                AND s.association_id = btrim(m.license_nr)::bigint
                AND s.licence_activated IS TRUE
                AND s.licence_validated IS TRUE
           ) AS by_sv,
           EXISTS (
             SELECT 1 FROM basketplan_people b
              WHERE nullif(btrim(b.licence_nr), '') IS NOT NULL
                AND b.scraped_at >= make_date(EXTRACT(YEAR FROM public.kscw_current_season_start())::int, 6, 1)::timestamptz
                AND (
                  nullif(btrim(b.licence_nr), '') = nullif(btrim(coalesce(m.license_nr, '')), '')
                  OR (lower(btrim(b.last_name))  = lower(btrim(m.last_name))
                  AND lower(btrim(b.first_name)) = lower(btrim(m.first_name))
                  AND b.birthdate = m.birthdate)
                )
           ) AS by_bp
      FROM members m
     WHERE m.licence_status <> 'licenced'
  `)

  const promoted = candidates
    .filter((r) => r.by_sv || r.by_bp)
    .map((r) => ({
      id: r.id,
      name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim(),
      from: r.from_status,
      source: r.by_sv ? 'Swiss Volley sync' : 'Basketplan sync',
    }))

  if (!dryRun && promoted.length > 0) {
    // Grouped by source so the row records WHICH register confirmed it — "who
    // said so" is the first question asked when a status looks wrong.
    for (const source of ['Swiss Volley sync', 'Basketplan sync']) {
      const ids = promoted.filter((p) => p.source === source).map((p) => p.id)
      if (ids.length === 0) continue
      await database('members').whereIn('id', ids).update({
        licence_status: 'licenced',
        licence_status_season: season,
        licence_status_updated_at: database.fn.now(),
        licence_status_by_name: source,
      })
    }
    for (const p of promoted) {
      await notifyLicenceStatusChange(database, log, { memberId: p.id, status: 'licenced', season })
    }
  }

  log?.info?.({
    msg: `[licence-status] ${dryRun ? 'dry-run: ' : ''}season ${season}, reset ${staleIds.length}, promoted ${promoted.length}`,
    event: 'licence_status_sweep',
    season, reset: staleIds.length, promoted: promoted.length, dryRun, actorName,
  })

  return { season, reset: staleIds.length, promoted, dryRun }
}

export function registerLicenceStatus(router, { database, logger }) {
  const log = logger.child({ endpoint: 'licence-status' })

  /**
   * Mirrors superGate() in vis-player-check.js / scorer-vm-check.js. Local by
   * design — the extension has no shared admin guard and every module closes
   * over its own `database`. BOTH sport admins are in: the sweep touches
   * volleyball and basketball members alike.
   */
  async function adminGate(req) {
    if (req.accountability?.admin) return true
    const userId = req.accountability?.user
    if (!userId) return false
    const m = await database('members').where('user', userId).first('role')
    if (!m) return false
    const roles = Array.isArray(m.role)
      ? m.role
      : (m.role ? (() => { try { return JSON.parse(m.role) } catch { return [] } })() : [])
    return ['superuser', 'admin', 'vb_admin', 'bb_admin'].some((r) => roles.includes(r))
  }

  async function actorName(req) {
    const userId = req.accountability?.user
    if (!userId) return null
    const m = await database('members').where('user', userId).first('first_name', 'last_name')
    if (!m) return null
    return [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || null
  }

  router.get('/admin/licence-status', async (req, res) => {
    try {
      if (!(await adminGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const [{ season }] = (await database.raw('SELECT public.kscw_current_season_label() AS season')).rows
      const rows = await database('members')
        .select('licence_status')
        .count({ count: '*' })
        .groupBy('licence_status')
      const distribution = Object.fromEntries(LICENCE_STATUSES.map((s) => [s, 0]))
      for (const r of rows) distribution[r.licence_status] = Number(r.count)
      let last = null
      try {
        const run = await database('sync_runs').where('source', SYNC_SOURCE).first()
        if (run) {
          last = {
            last_run_at: run.last_run_at instanceof Date ? run.last_run_at.toISOString() : run.last_run_at,
            status: run.status,
            rows_changed: run.rows_changed ?? 0,
            duration_ms: run.duration_ms ?? 0,
            error_message: run.error_message ?? null,
          }
        }
      } catch { /* sync_runs is a convenience, not a dependency */ }
      res.json({ season, distribution, last })
    } catch (err) {
      log.error({ msg: `licence-status read: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // Synchronous on purpose, unlike /admin/vis-player-check: this is two local
  // Postgres statements with no third party in the path, so there is nothing
  // for a 202-and-poll to protect against.
  router.post('/admin/licence-status/sync', async (req, res) => {
    const startedAt = Date.now()
    try {
      if (!(await adminGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const dryRun = req.query.dry_run === '1' || req.query.dry_run === 'true'
      const who = await actorName(req)

      const result = await runLicenceStatusSweep(database, log, { dryRun, actorName: who })

      if (!dryRun) {
        await writeUserLog(database, log, {
          accountability: req.accountability,
          action: 'update', collection: 'members', recordId: null,
          data: {
            what: 'licence_status_sync',
            season: result.season,
            reset: result.reset,
            promoted: result.promoted.length,
          },
        }).catch(() => {})
        await logCronRun(database, SYNC_SOURCE, {
          status: 'success',
          rowsChanged: result.reset + result.promoted.length,
          durationMs: Date.now() - startedAt,
        }).catch(() => {})
      }

      res.json({
        season: result.season,
        dry_run: dryRun,
        reset: result.reset,
        promoted: result.promoted.length,
        promoted_members: result.promoted,
        duration_ms: Date.now() - startedAt,
      })
    } catch (err) {
      log.error({ msg: `licence-status/sync: ${err.message}`, stack: err.stack })
      await logCronRun(database, SYNC_SOURCE, {
        status: 'error', rowsChanged: 0, durationMs: Date.now() - startedAt, errorMessage: err.message,
      }).catch(() => {})
      res.status(500).json({ error: 'Internal error' })
    }
  })
}

#!/usr/bin/env node
/**
 * Post-run verification for the nightly SVRZ sync's audit footprint.
 *
 * Guards two changes made 2026-08-25, both of which fail SILENTLY and both of
 * which look identical to "working" from the outside:
 *
 *   1. Migration 336 moved `svrz_games` to `accountability = 'activity'`, so the
 *      sync must stop writing `directus_revisions`. If Directus's schema cache is
 *      ever stale (a raw-SQL `directus_collections` write does NOT bust it), the
 *      revisions come back and nothing says so — the table just grows again.
 *   2. The audit hook now SKIPS `svrz_games` / `svrz_spielplaner_contacts`, and
 *      `svrz-scheduling-sync.mjs` writes ONE summary row per run instead. If that
 *      summary write fails it is deliberately swallowed (a failed audit row must
 *      never fail the sync), so the nightly sync would become genuinely
 *      untracked with no error anywhere.
 *
 * ⚠⚠ "No qualifying run" is a DISTINCT outcome from "pass", and that is the whole
 *    point of the anchoring below. The first attempt to verify migration 336 by
 *    hand used a fixed `now() - interval '6 hours'` window; it returned a clean
 *    3135/0 that proved nothing, because the window straddled a sync that PREDATED
 *    the migration and a prune that had just emptied the table. A verifier that
 *    can report success without a qualifying run is worse than no verifier.
 *
 * Anchoring: `sync_runs` holds one row per source, upserted on completion, with
 * `last_run_at` and `duration_ms`. The window is therefore
 * [last_run_at - duration_ms - slack, now], which is exactly the run that just
 * finished — never a fixed clock interval.
 *
 * Exit codes: 0 = pass or inconclusive (nothing to alarm about), 1 = FAIL.
 * A FAIL also appends a `cron_error` line to the JSONL error log, so it surfaces
 * at /kscw/admin/error-logs (`?event=cron_error`) instead of needing to be
 * remembered.
 *
 * Usage:
 *   node svrz-sync-verify.mjs <dev|prod>
 *   KSCW_LOCAL_PSQL=1 node svrz-sync-verify.mjs prod   # on the VPS (no ssh hop)
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const ENVS = {
  prod: { container: 'kscw-postgres', user: 'supabase_admin', database: 'postgres', logDir: '/opt/directus-kscw/logs' },
  dev: { container: 'kscw-postgres', user: 'supabase_admin', database: 'directus_kscw_dev', logDir: '/opt/directus-kscw-dev/logs' },
}

const target = process.argv[2]
const env = ENVS[target]
if (!env) {
  console.error('usage: node svrz-sync-verify.mjs <dev|prod>')
  process.exit(2)
}

/**
 * ⚠ Never pass a `|` inside an ssh argv — ssh joins args into a REMOTE SHELL
 * string, so it becomes a pipe. `-tA` already defaults to `|`.
 * (Same helper shape as vis-player-check.mjs; kept duplicated rather than
 * imported because these scripts are run individually from a bind mount.)
 */
function psql(sql) {
  const local = process.env.KSCW_LOCAL_PSQL === '1'
  const base = ['sudo', 'docker', 'exec', '-i', env.container,
    'psql', '-U', env.user, '-d', env.database, '-tA', '-X', '-v', 'ON_ERROR_STOP=1']
  const cmd = local ? base : ['ssh', 'hetzner', ...base]
  const r = spawnSync(cmd[0], cmd.slice(1), { input: sql, encoding: 'utf-8' })
  if (r.status !== 0) throw new Error(`psql failed:\n${r.stderr || r.stdout}`)
  return r.stdout.trim()
}

function writeErrorLog(entry) {
  try {
    const day = new Date().toISOString().slice(0, 10)
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'
    appendFileSync(`${env.logDir}/errors-${day}.jsonl`, line)
  } catch (err) {
    // The log write is best-effort; the non-zero exit is the real signal.
    console.error(`[svrz-verify] could not write error log: ${err.message}`)
  }
}

// ── Gather ────────────────────────────────────────────────────────────
// ONE statement, deliberately. A `WITH` clause scopes only to the statement it
// precedes, so the earlier six-semicolon version could not see `w` past the first
// SELECT and died with `relation "w" does not exist`. concat_ws returns a single
// text value, which also sidesteps psql's `|` column separator entirely.
const raw = psql(`
  WITH w AS (
    SELECT last_run_at,
           status,
           last_run_at - (duration_ms || ' milliseconds')::interval - interval '60 seconds' AS win_start
    FROM sync_runs WHERE source = 'svrz_sync'
  )
  SELECT concat_ws(E'\\n',
    coalesce((SELECT last_run_at::text FROM w), 'NONE'),
    coalesce((SELECT status FROM w), 'NONE'),
    coalesce((SELECT extract(epoch FROM (now() - last_run_at))::bigint FROM w), -1)::text,
    (SELECT count(*) FROM user_logs u, w
       WHERE u.action = 'svrz_sync' AND u.date_created >= w.win_start)::text,
    -- ⚠ Must match on ACTION, not collection alone. The summary row this very
    -- check requires also carries collection_name='svrz_games' (that is its
    -- subject), so a collection-only predicate counts the summary as a per-row
    -- entry and FAILS every successful night. Caught by executing the pass path.
    -- 'create'/'update'/'delete' is exactly what the audit hook writes.
    (SELECT count(*) FROM user_logs u, w
       WHERE u.collection_name IN ('svrz_games','svrz_spielplaner_contacts')
         AND u.action IN ('create','update','delete')
         AND u.date_created >= w.win_start)::text,
    (SELECT count(*) FROM directus_revisions rv
       JOIN directus_activity ac ON ac.id = rv.activity, w
       WHERE rv.collection = 'svrz_games' AND ac.timestamp >= w.win_start)::text
  );
`)

const [lastRunAt, status, ageSecStr, summaryRows, perRowRows, revisionRows] = raw.split('\n').map(s => s.trim())
const ageSec = Number(ageSecStr)
const n = (v) => Number(v)

// ── Decide ────────────────────────────────────────────────────────────
// INCONCLUSIVE is never a pass. It is reported and exits 0 (nothing is wrong
// yet), but it must never be mistaken for evidence that the checks held.
if (lastRunAt === 'NONE') {
  console.log('INCONCLUSIVE — sync_runs has no svrz_sync row yet; nothing to verify.')
  process.exit(0)
}
// The caller runs this shortly after the 04:30 sync. If the newest recorded run
// is older than 6h, this invocation is not looking at a fresh run at all.
if (ageSec > 6 * 3600) {
  console.log(`INCONCLUSIVE — newest svrz_sync run is ${Math.round(ageSec / 3600)}h old (${lastRunAt}); no fresh run to verify.`)
  process.exit(0)
}
if (status === 'error') {
  // The sync itself failed. That is its own alert (the spawner records it), and
  // the audit expectations below do not apply to a run that never finished.
  console.log(`INCONCLUSIVE — the ${lastRunAt} run recorded status=error; audit checks do not apply to a failed run.`)
  process.exit(0)
}

const failures = []
if (n(summaryRows) !== 1) {
  failures.push(`expected exactly 1 summary row (action='svrz_sync') for the ${lastRunAt} run, found ${summaryRows}` +
    (n(summaryRows) === 0 ? ' — writeSyncSummary is swallowing a failure, the nightly sync is now UNTRACKED' : ''))
}
if (n(perRowRows) !== 0) {
  failures.push(`expected 0 per-row user_logs rows for svrz_games/svrz_spielplaner_contacts, found ${perRowRows}` +
    ' — the audit hook SKIP_COLLECTIONS change is not in effect (stale extension deploy?)')
}
if (n(revisionRows) !== 0) {
  failures.push(`expected 0 new svrz_games revisions, found ${revisionRows}` +
    " — migration 336's accountability='activity' is not in effect (stale Directus schema cache — restart the container)")
}

if (failures.length === 0) {
  console.log(`PASS — run ${lastRunAt}: 1 summary row, 0 per-row audit rows, 0 revisions.`)
  process.exit(0)
}

const message = `svrz sync audit footprint regressed: ${failures.join(' | ')}`
console.error(`FAIL — ${message}`)
writeErrorLog({
  level: 'warn',
  source: null,
  project: 'wiedisync',
  event: 'cron_error',
  cron: 'svrz_sync_verify',
  error: message,
})
process.exit(1)

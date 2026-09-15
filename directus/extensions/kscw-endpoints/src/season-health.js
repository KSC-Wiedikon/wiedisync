/**
 * Season health — superadmin whole-season diagnostic (the runner).
 *
 *   GET /kscw/admin/season-health              → the full report (rows capped per check)
 *   GET /kscw/admin/season-health?refresh=1    → same, bypassing the in-process cache
 *   GET /kscw/admin/season-health?check=KEY    → one check with ALL its rows (export /
 *                                                drill-down); never cached; 400 on an
 *                                                unknown key
 *
 * What runs: the two non-finding tables (`TABLES.players`, `TABLES.teams`,
 * uncapped) and every entry of the check registry (`CHECKS`, rows capped at
 * ROW_LIMIT in the overview). Each statement is its own read-only transaction
 * with a 15 s statement_timeout, and at most CONCURRENCY statements are in
 * flight at once — the endpoint `database` is the global knex pool and one
 * request must not drain it (2026-09-14 members privacy hook deadlock).
 *
 * One broken statement never blanks the page: that entry comes back as
 * `{ …, error: 'check_failed', count: null, rows: [] }`, the failure lands in
 * the JSONL error log (`/admin/error-logs`), and the response is still 200.
 *
 * Concurrent full-report requests for the same season coalesce onto one
 * in-flight build (`getReport`) rather than each running their own
 * CONCURRENCY-wide sweep — two superadmins opening the page at once must not
 * double the load on the shared pool.
 *
 * Response (full report):
 *   { season, generated_at,
 *     anchors: { rollover, season_start, season_end, today },
 *     registers: { vm_synced_at, basketplan_scraped_at, clubdesk_imported_at, finance_synced_at },
 *     teams: [...], players: [...],
 *     checks: [{ key, section, sport, severity, grain, title, description,
 *                count, by_sport: { volleyball, basketball, club }, rows, truncated, ms, error? }],
 *     errors?: { players?: 'check_failed', teams?: 'check_failed' },   // only when a table failed
 *     ms }
 *
 * Sport on member-grain rows: a check that names `memberIdColumn` gets
 * `sport` + `sport_source` per row from resolveMemberSportsDetailed (THE
 * server-side scope rule — never re-derived in SQL). 'both' counts in both
 * sport buckets; source 'unknown' ships `sport: null` and counts as club.
 *
 * Read-only: no writeUserLog (CLAUDE.md → reads never need actor capture).
 * The moment a "fix" route lands here it MUST call writeUserLog in the same
 * commit — raw-knex writes bypass directus_activity.
 *
 * Auth: Directus admin (req.accountability.admin) OR a member whose `role`
 * array holds 'superuser' — the household.js isSuperadmin shape. Mirrors
 * SuperAdminRoute (isSuperAdmin = roles.includes('superuser')); app `admin`
 * members pass via the Directus flag because resolveDirectusRole already
 * makes them root. Local by design — the extension has no shared superuser
 * guard (see licence-status.js).
 */
import { logErrorToFile, logAuthDenial } from './error-log.js'
import { resolveMemberSportsDetailed } from './member-sport.js'
import { CHECKS, TABLES, assertRegistry } from './season-health-checks.js'
import { renderSql, seasonContext } from './season-health-sql.js'

// A registry that violates its own contract must fail the extension boot,
// loudly and at import time — not at the first superuser click on prod.
assertRegistry()

/** Overview row cap per check. `?check=KEY` returns everything. */
export const ROW_LIMIT = 100
/** In-process cache lifetime for the full report. */
export const CACHE_TTL_MS = 120_000
/** Per-statement Postgres timeout (mirrors sql-workspace.js). */
export const STATEMENT_TIMEOUT_MS = 15_000
/** Statements in flight at once — small on purpose, the pool is shared. */
export const CONCURRENCY = 3

const ENDPOINT = 'admin/season-health'

/** The registers whose freshness the page shows next to the findings. */
const REGISTERS = [
  { key: 'vm_synced_at', table: 'sv_vm_check', column: 'synced_at' },
  { key: 'basketplan_scraped_at', table: 'basketplan_people', column: 'scraped_at' },
  { key: 'clubdesk_imported_at', table: 'clubdesk_export', column: 'imported_at' },
  // There is no sync_runs source for the finance sync: the nightly
  // `db:finance:sync:prod` runs from a LOCAL crontab and the in-app "Sync now"
  // dispatcher shells out to the same script; both leave their only heartbeat
  // as `finance_imports` provenance rows. That row is the sync.
  { key: 'finance_synced_at', table: 'finance_imports', column: 'imported_at' },
]

/** Check-level sport → the bucket rows without their own `sport` fall into. */
const CHECK_SPORT_BUCKET = { vb: 'volleyball', bb: 'basketball', both: null }

function callerRoles(row) {
  if (!row) return []
  if (Array.isArray(row.role)) return row.role
  try { return JSON.parse(row.role || '[]') } catch { return [] }
}

/** Admin (Directus) or a member holding the 'superuser' role. */
async function isSuperadmin(database, accountability) {
  if (accountability?.admin === true) return true
  const userId = accountability?.user
  if (!userId) return false
  const caller = await database('members').where('user', userId).first('role')
  return callerRoles(caller).includes('superuser')
}

function toIso(value) {
  if (value === null || value === undefined || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Count the FULL result into the three tabs. 'both' lands in both sports;
 * NULL / unknown lands in club. A row that carries no `sport` key at all is
 * filed under its check's sport (a 'vb' check needs no sport column).
 */
export function bySport(rows, checkSport = 'both') {
  const out = { volleyball: 0, basketball: 0, club: 0 }
  const fallback = CHECK_SPORT_BUCKET[checkSport] ?? null
  for (const r of rows) {
    const s = r.sport === undefined ? fallback : r.sport
    if (s === 'volleyball') out.volleyball++
    else if (s === 'basketball') out.basketball++
    else if (s === 'both') { out.volleyball++; out.basketball++ }
    else out.club++
  }
  return out
}

/**
 * Simple worker pool — `tasks` are thunks returning promises, results keep
 * their input order. No library: three workers pulling from one cursor.
 */
export async function runPool(tasks, limit = CONCURRENCY) {
  const results = new Array(tasks.length)
  let next = 0
  async function worker() {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]()
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker)
  await Promise.all(workers)
  return results
}

export function registerSeasonHealth(router, { database, logger }) {
  const log = logger.child({ endpoint: 'season-health' })

  // Full-report cache, plus in-flight build coalescing. Both closure-scoped so
  // they are process-wide in Directus (registerSeasonHealth runs once) yet
  // fresh per registration in tests.
  let cache = null      // { season, generated_at, payload }
  // A request that lands while a build is already running for the SAME season
  // joins that build instead of starting a second CONCURRENCY-wide sweep of
  // the shared pool — two superadmins loading the page at once (or a slow
  // first build plus an impatient reload) must not double the DB load.
  let building = null   // { season, promise }

  /** One statement, its own read-only transaction, its own timeout. */
  async function runStatement(sql, ctx) {
    const rendered = renderSql(sql, ctx)
    return database.transaction(async (trx) => {
      await trx.raw(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`)
      await trx.raw('SET LOCAL TRANSACTION READ ONLY')
      const result = await trx.raw(rendered)
      return result?.rows ?? []
    })
  }

  /**
   * Member-grain rows without a `sport` key get sport + sport_source from THE
   * resolver, batched once per check. Rows that already carry `sport` (the
   * SQL joined teams) are left alone.
   */
  async function deriveSport(check, rows) {
    const col = check.memberIdColumn
    if (!col || rows.length === 0) return rows
    const pending = rows.filter((r) => r.sport === undefined)
    if (pending.length === 0) return rows
    const ids = pending.map((r) => r[col]).filter((v) => v !== null && v !== undefined)
    const resolved = await resolveMemberSportsDetailed(database, ids)
    return rows.map((r) => {
      if (r.sport !== undefined) return r
      const hit = resolved.get(String(r[col]))
      const source = hit?.source ?? 'unknown'
      return { ...r, sport: source === 'unknown' ? null : hit.sport, sport_source: source }
    })
  }

  function describe(check) {
    return {
      key: check.key, section: check.section, sport: check.sport, severity: check.severity,
      grain: check.grain, title: check.title, description: check.description,
    }
  }

  function failedCheck(check, ms) {
    return {
      ...describe(check), count: null, by_sport: { volleyball: 0, basketball: 0, club: 0 },
      rows: [], truncated: false, ms, error: 'check_failed',
    }
  }

  /** Run one registry check; never rejects. `limit` 0 = uncapped. */
  async function runCheck(check, ctx, limit, req) {
    const t0 = Date.now()
    try {
      const all = await deriveSport(check, await runStatement(check.sql, ctx))
      const capped = limit > 0 && all.length > limit
      return {
        ...describe(check),
        count: all.length,
        by_sport: bySport(all, check.sport),
        rows: capped ? all.slice(0, limit) : all,
        truncated: capped,
        ms: Date.now() - t0,
      }
    } catch (err) {
      log.warn({ msg: `season-health check ${check.key} failed: ${err.message}`, check: check.key })
      logErrorToFile(ENDPOINT, Object.assign(err, { check: check.key }), req)
      return failedCheck(check, Date.now() - t0)
    }
  }

  /** Run one of the two non-finding tables; never rejects. */
  async function runTable(name, ctx, req) {
    try {
      return { name, rows: await runStatement(TABLES[name], ctx), error: null }
    } catch (err) {
      log.warn({ msg: `season-health table ${name} failed: ${err.message}`, table: name })
      logErrorToFile(ENDPOINT, Object.assign(err, { table: name }), req)
      return { name, rows: [], error: 'check_failed' }
    }
  }

  /** max(column) of a register table as ISO, null when the table is missing or empty. */
  async function registerStamp({ table, column }, req) {
    try {
      if (!(await database.schema.hasTable(table))) return null
      const row = await database(table).max({ v: column }).first()
      return toIso(row?.v)
    } catch (err) {
      log.warn({ msg: `season-health register ${table}.${column} failed: ${err.message}` })
      logErrorToFile(ENDPOINT, err, req)
      return null
    }
  }

  async function buildReport(ctx, req) {
    const t0 = Date.now()
    const tableNames = Object.keys(TABLES)
    const tasks = [
      ...tableNames.map((name) => () => runTable(name, ctx, req)),
      ...CHECKS.map((check) => () => runCheck(check, ctx, ROW_LIMIT, req)),
    ]
    const [results, registerValues] = await Promise.all([
      runPool(tasks, CONCURRENCY),
      Promise.all(REGISTERS.map((r) => registerStamp(r, req))),
    ])
    const tables = results.slice(0, tableNames.length)
    const checks = results.slice(tableNames.length)

    const payload = {
      season: ctx.season,
      generated_at: new Date().toISOString(),
      anchors: {
        rollover: ctx.rollover, season_start: ctx.season_start,
        season_end: ctx.season_end, today: ctx.today,
      },
      registers: Object.fromEntries(REGISTERS.map((r, i) => [r.key, registerValues[i]])),
      teams: [],
      players: [],
      checks,
      ms: 0,
    }
    const errors = {}
    for (const t of tables) {
      payload[t.name] = t.rows
      if (t.error) errors[t.name] = t.error
    }
    if (Object.keys(errors).length) payload.errors = errors
    payload.ms = Date.now() - t0
    return payload
  }

  /**
   * The full report for `ctx`: served from cache when fresh, coalesced onto
   * an in-flight build for the same season when one is already running, and
   * built fresh otherwise. `refresh` skips the cache-freshness check (never
   * serves a stale payload) but still joins an in-flight build rather than
   * kicking off a redundant second one — that build is already fetching
   * current data.
   */
  async function getReport(ctx, req, refresh) {
    if (!refresh && cache && cache.season === ctx.season
        && Date.now() - Date.parse(cache.generated_at) < CACHE_TTL_MS) {
      return cache.payload
    }
    if (building && building.season === ctx.season) return building.promise

    const promise = buildReport(ctx, req)
    building = { season: ctx.season, promise }
    try {
      const payload = await promise
      cache = { season: ctx.season, generated_at: payload.generated_at, payload }
      return payload
    } finally {
      if (building?.promise === promise) building = null
    }
  }

  router.get('/admin/season-health', async (req, res) => {
    try {
      if (!req.accountability?.user) {
        logAuthDenial(req.path, req, 'auth_required')
        return res.status(401).json({ error: 'Authentication required' })
      }
      if (!(await isSuperadmin(database, req.accountability))) {
        logAuthDenial(req.path, req, 'superuser_required')
        return res.status(403).json({ error: 'Superuser access required', code: 'not_superadmin' })
      }

      const ctx = seasonContext()
      const query = req.query ?? {}

      // ── Single check, every row (export / drill-down). Never cached. ──
      if (query.check !== undefined) {
        const check = typeof query.check === 'string' ? CHECKS.find((c) => c.key === query.check) : null
        if (!check) return res.status(400).json({ error: 'Unknown check' })
        const result = await runCheck(check, ctx, 0, req)
        return res.json({
          season: ctx.season,
          generated_at: new Date().toISOString(),
          anchors: {
            rollover: ctx.rollover, season_start: ctx.season_start,
            season_end: ctx.season_end, today: ctx.today,
          },
          check: result,
        })
      }

      // ── Full report, cached per season for CACHE_TTL_MS; concurrent
      // requests for the same season coalesce onto one build. ──
      const refresh = query.refresh === '1' || query.refresh === 'true'
      const payload = await getReport(ctx, req, refresh)
      return res.json(payload)
    } catch (err) {
      log.error({ msg: `${ENDPOINT}: ${err.message}`, userId: req.accountability?.user || null, stack: err.stack })
      logErrorToFile(ENDPOINT, err, req)   // JSONL + Sentry — log.error alone never reaches /admin/error-logs
      // Never echo err.message here: this catch is the CATCH-ALL for anything
      // unexpected (gate lookup, pool, schema introspection) — none of it is
      // safe to show a caller, superuser or not.
      return res.status(500).json({ error: 'Internal error' })
    }
  })
}

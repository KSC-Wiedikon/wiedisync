/**
 * Sync status — auth-required health endpoint backing /status.
 *
 * GET /kscw/admin/sync-status
 *   {
 *     runs: [
 *       { source: 'sv_sync',   last_run_at: ISO, status: 'ok' | 'error',
 *         age_seconds: number, error_message: string | null,
 *         rows_changed: number, duration_ms: number },
 *       …
 *     ]
 *   }
 *
 * Reads from `sync_runs` (migration 045). Each cron upserts a row on
 * completion via logCronRun(). Until migration 045 runs and the first cron
 * fires, the table either doesn't exist or rows still hold the seeded
 * 1970-01-01 timestamps — both surface as "stale" upstream.
 *
 * Permission model: any authenticated KSCW Member, since /status is
 * member-facing. No PII, no internal URLs, just timestamps + status.
 *
 * ⚠ `error_message` is whatever the cron recorded — for a spawned child that is raw
 * stderr (stack traces, container paths, upstream response text). Only admins
 * (Directus admin, or app role admin / superuser / sport admin) get it verbatim;
 * everyone else gets a one-line, path-free summary (2026-09-28 audit F81).
 */

const FULL_ERROR_ROLES = ['admin', 'superuser', 'vb_admin', 'bb_admin']

/** First line, no stack frames / file paths / urls, capped. Pure; exported for the test. */
export function summarizeSyncError(msg) {
  if (msg == null) return null
  const first = String(msg).split(/\r?\n/).map((l) => l.trim()).find((l) => l && !/^at\s/.test(l)) || ''
  const clean = first
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/(?:[A-Za-z]:)?(?:\/[\w.@-]+){2,}(?::\d+(?::\d+)?)?/g, '[path]')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '[host]')
    // Hostnames: a known TLD, or anything dotted with a port. A bare `foo.bar` stays —
    // "x.map is not a function" is the error, not a host.
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:ch|com|net|org|io|dev|app|cloud|local|internal|lan)(?::\d+)?\b/gi, '[host]')
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)+:\d{2,5}\b/gi, '[host]')
    .replace(/\b(?:user|role|database)\s+"[^"]*"/gi, (m) => m.replace(/"[^"]*"/, '"[redacted]"'))
    .slice(0, 120)
  return clean || 'Sync failed'
}

function parseRoles(raw) {
  if (Array.isArray(raw)) return raw
  if (!raw) return []
  try { const r = JSON.parse(raw); return Array.isArray(r) ? r : [] } catch { return [] }
}

export function registerSyncStatus(router, { database, logger }) {
  const log = logger.child({ endpoint: 'sync-status' })

  router.get('/admin/sync-status', async (req, res) => {
    if (!req.accountability?.user) {
      return res.status(401).json({ error: 'Authentication required' })
    }
    try {
      const tableExists = await database.schema.hasTable('sync_runs')
      if (!tableExists) {
        // Fresh DB / migration not yet applied — pretend the table is empty
        // rather than 500. /status will render every source as "loading".
        return res.json({ runs: [] })
      }

      const rows = await database('sync_runs')
        .select('source', 'last_run_at', 'status', 'rows_changed', 'duration_ms', 'error_message')
        .orderBy('source', 'asc')

      let fullErrors = req.accountability.admin === true
      if (!fullErrors) {
        const me = await database('members').where('user', req.accountability.user).first('role')
        fullErrors = parseRoles(me?.role).some((r) => FULL_ERROR_ROLES.includes(r))
      }

      const now = Date.now()
      const runs = rows.map((r) => ({
        source: r.source,
        last_run_at: r.last_run_at instanceof Date ? r.last_run_at.toISOString() : r.last_run_at,
        status: r.status,
        rows_changed: r.rows_changed ?? 0,
        duration_ms: r.duration_ms ?? 0,
        error_message: fullErrors ? (r.error_message ?? null) : summarizeSyncError(r.error_message),
        age_seconds: r.last_run_at ? Math.floor((now - new Date(r.last_run_at).getTime()) / 1000) : null,
      }))

      return res.json({ runs })
    } catch (err) {
      log.error({ msg: `sync-status: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}

/**
 * Persistent JSONL error log — writes ALL errors to /directus/logs/errors.jsonl
 *
 * Every error, auth denial, CAPTCHA failure, cron failure, and push failure
 * gets appended as a single JSON line. Daily rotation keeps files manageable.
 *
 * Format per line:
 * {"ts":"2026-03-31T12:00:00.000Z","level":"error","event":"api_error","endpoint":"/check-email","userId":"abc","method":"POST","status":500,"body":{...},"error":"...","stack":"..."}
 *
 * Used by both kscw-endpoints and kscw-hooks extensions.
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

let sentryPromise = null
function getSentry() {
  if (!sentryPromise) {
    sentryPromise = import('./sentry.js').catch(() => null)
  }
  return sentryPromise
}

const LOG_DIR = process.env.ERROR_LOG_DIR || '/directus/logs'
const MAX_AGE_DAYS = 30

// Ensure log directory exists
try { fs.mkdirSync(LOG_DIR, { recursive: true }) } catch { /* ignore */ }

function getLogPath() {
  const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  return path.join(LOG_DIR, `errors-${date}.jsonl`)
}

/**
 * Append a structured error entry to the JSONL log file.
 * Non-blocking — errors in logging itself are silently ignored.
 */
/**
 * Hard ceiling for a single log line. Well above any genuine entry (the largest
 * real ones are a few KB of stack), far below anything that could fill a disk.
 */
const MAX_LINE_BYTES = 16 * 1024

/**
 * Hard ceiling for one day-file. The admin read routes `readFileSync` whole
 * files, so a file past ~512 MB throws ERR_STRING_TOO_LONG and takes the entire
 * error-log UI down for every date, not just the oversized one. 64 MB is ~40×
 * the busiest real month (legitimate logs run ~1.4 MB across 30 days) and leaves
 * the reader far inside its limits.
 */
const MAX_FILE_BYTES = 64 * 1024 * 1024

/**
 * The share of a day-file ANONYMOUS-reachable frontend reports may fill. Past it,
 * `source: 'frontend'` entries are dropped while server-side entries keep landing
 * until MAX_FILE_BYTES — so padding /kscw/client-error can no longer blind the log
 * to the backend's own errors for the rest of the day (2026-09-28 audit, F-34).
 */
const MAX_FRONTEND_FILE_BYTES = 48 * 1024 * 1024

/**
 * Append a structured error entry to the JSONL log file.
 * Non-blocking — errors in logging itself are silently ignored.
 *
 * The two ceilings below are a BACKSTOP, not the primary control: callers are
 * expected to bound their own untrusted fields (see `/kscw/client-error`). They
 * exist because this function is reachable from an unauthenticated route and
 * writes to a bind mount that shares a disk with Postgres, so "a caller forgot
 * to cap a field" must not be able to become "the database ran out of space"
 * (audit 2026-08-08, finding 11).
 */
export function writeErrorLog(entry) {
  try {
    // Bearer-in-the-URL tokens (public event shares, Terminplanung links, signup
    // invites) must not land in the JSONL log — it is readable by every admin
    // and shipped to the AI-bugfix pipeline. Redacted centrally so no caller
    // can forget (2026-09-28 audit).
    const redacted = { ...entry }
    for (const k of URLISH_FIELDS) {
      if (typeof redacted[k] === 'string') redacted[k] = redactUrlTokens(redacted[k])
    }
    let line = JSON.stringify({
      ts: new Date().toISOString(),
      ...redacted,
    }) + '\n'

    if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
      // Keep the entry — a truncated error is still a signal, and dropping it
      // would let an attacker erase their own traces by padding a field.
      line = JSON.stringify({
        ts: new Date().toISOString(),
        level: entry?.level === 'warn' ? 'warn' : 'error',
        source: entry?.source ?? null,
        project: typeof entry?.project === 'string' ? entry.project.slice(0, 100) : null,
        event: typeof entry?.event === 'string' ? entry.event.slice(0, 100) : null,
        userId: entry?.userId ?? null,
        error: typeof entry?.error === 'string' ? entry.error.slice(0, 1000) : null,
        truncated: true,
        original_bytes: Buffer.byteLength(line),
      }) + '\n'
    }

    const logPath = getLogPath()
    const ceiling = entry?.source === 'frontend' ? MAX_FRONTEND_FILE_BYTES : MAX_FILE_BYTES
    try {
      if (fs.statSync(logPath).size > ceiling) return
    } catch { /* file does not exist yet — nothing to check */ }

    fs.appendFile(logPath, line, () => {})
  } catch { /* never block the request for logging */ }
}

/**
 * Log an endpoint error with full request context.
 * Drop-in companion to logEndpointError() — writes to file in addition to Directus logger.
 */
export function logErrorToFile(endpoint, err, req) {
  const status = err.status || 500
  writeErrorLog({
    level: (err.status && err.status < 500) ? 'warn' : 'error',
    project: 'wiedisync',
    event: 'api_error',
    endpoint,
    userId: req?.accountability?.user || null,
    isAdmin: req?.accountability?.admin || false,
    method: req?.method || null,
    status,
    // Bounded: params and query are caller-chosen on anonymous routes, and a
    // padded one was a cheap way to spend the day-file budget (F-34).
    body: req?.body ? capLogged(scrubPii(req.body), 2000) : undefined,
    params: req?.params ? capLogged(scrubPii(req.params), 300) : undefined,
    query: req?.query ? capLogged(scrubPii(req.query), 500) : undefined,
    error: err.message,
    stack: err.stack,
  })

  if (status >= 500) {
    getSentry().then(s => s?.captureException(err, {
      endpoint,
      userId: req?.accountability?.user,
      method: req?.method,
      status,
    })).catch(() => {})
  }
}

/**
 * Log an auth denial (401/403).
 */
export function logAuthDenial(endpoint, req, reason) {
  writeErrorLog({
    level: 'warn',
    project: 'wiedisync',
    event: 'auth_denied',
    endpoint,
    reason,
    userId: req?.accountability?.user || null,
    method: req?.method || null,
    ip: req?.ip || req?.headers?.['x-forwarded-for'] || null,
  })
}

/**
 * Record a cron last-run heartbeat into the `sync_runs` table.
 *
 * Migration 045 added the table. /status reads `last_run_at` per source so
 * staleness reflects "did the cron actually fire?" rather than "did the cron
 * write a row to games/hall_events?". The previous implementation used the
 * latter and showed orange whenever a cron was a no-op (steady-state season
 * with no schedule changes), which is the common case.
 *
 * Failures here are swallowed: the cron itself must never fail because the
 * health tracker had a hiccup. Tracking is best-effort.
 *
 * @param database - knex instance from the cron's hook context
 * @param source   - stable key (e.g. 'sv_sync', 'bp_sync', 'gcal_sync')
 * @param opts     - { status?: 'ok' | 'error', rowsChanged?: number,
 *                     durationMs?: number, errorMessage?: string | null }
 */
export async function logCronRun(database, source, opts = {}) {
  if (!database || !source) return
  const status = opts.status === 'error' ? 'error' : 'ok'
  try {
    await database('sync_runs')
      .insert({
        source,
        last_run_at: database.fn.now(),
        status,
        rows_changed: Number.isFinite(opts.rowsChanged) ? opts.rowsChanged : 0,
        duration_ms: Number.isFinite(opts.durationMs) ? opts.durationMs : 0,
        error_message: opts.errorMessage ?? null,
      })
      .onConflict('source')
      .merge()
  } catch (err) {
    // Don't crash the cron over health tracking — just record to the file log.
    writeErrorLog({
      level: 'warn',
      project: 'wiedisync',
      event: 'sync_runs_write_failed',
      source,
      error: err.message,
    })
  }
}

/**
 * Log a cron/background job error.
 */
export function logCronError(cronName, err, extra) {
  writeErrorLog({
    level: 'error',
    project: 'wiedisync',
    event: 'cron_error',
    cron: cronName,
    error: err.message,
    stack: err.stack,
    ...extra,
  })

  getSentry().then(s => s?.captureException(err, {
    cronName,
    extra,
  })).catch(() => {})
}

/**
 * Log a generic warning (CAPTCHA failures, push failures, etc).
 */
export function logWarning(event, message, extra) {
  writeErrorLog({
    level: 'warn',
    project: 'wiedisync',
    event,
    message,
    ...extra,
  })

  getSentry().then(s => s?.captureMessage(message, 'warning', {
    event,
    extra,
  })).catch(() => {})
}

/**
 * Compute a stable hash for a log entry.
 * Uses ts|event|error — unique per entry since ts is millisecond-precision.
 */
export function computeErrorHash(entry) {
  const key = `${entry.ts || ''}|${entry.event || ''}|${entry.error || ''}`
  return crypto.createHash('md5').update(key).digest('hex')
}

/**
 * Clean up log files older than MAX_AGE_DAYS.
 * Call once daily from a cron.
 */
export function cleanOldLogs() {
  try {
    const files = fs.readdirSync(LOG_DIR)
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - MAX_AGE_DAYS)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    for (const file of files) {
      if (!file.startsWith('errors-') || !file.endsWith('.jsonl')) continue
      const dateStr = file.replace('errors-', '').replace('.jsonl', '')
      if (dateStr < cutoffStr) {
        fs.unlinkSync(path.join(LOG_DIR, file))
      }
    }
  } catch { /* ignore */ }
}

/**
 * An object as-is when its JSON fits in `max` chars, otherwise a truncated preview.
 * Pure; exported for the unit test.
 */
export function capLogged(obj, max) {
  let json
  try { json = JSON.stringify(obj) } catch { return { _unserializable: true } }
  if (json === undefined || json.length <= max) return obj
  return { _truncated: true, _bytes: json.length, preview: json.slice(0, max) }
}

// ── PII scrubbing ──────────────────────────────────────────────

const URLISH_FIELDS = ['endpoint', 'url', 'path', 'route', 'href', 'referrer', 'page']

// Route families whose path segment AFTER the prefix is a bearer secret. Keep in
// step with the routers: public-events.js, game-scheduling.js / basketball-portal.js
// (terminplanung, slots), signup-invites.js.
const TOKEN_PATH_RE = /(\/(?:public\/events|signup-invites\/info|slots|terminplanung(?:\/bb)?(?:\/club)?(?:\/(?:note|propose-away|propose-home|propose|respond|set-language|slots))?)\/)(?!:)([^/?#\s]+)/gi
// Query-string secrets (`?token=…`, `?ticket=…`, `?reference=…&email=…`).
const TOKEN_QUERY_RE = /([?&](?:token|ticket|share|key|secret|code|otp|reference|email)=)[^&#\s]*/gi

/** Redact bearer tokens in a URL or path string. Route PATTERNS (`:token`) pass
 *  through untouched. Pure; exported for the unit test. */
export function redactUrlTokens(str) {
  if (typeof str !== 'string' || !str) return str
  return str.replace(TOKEN_PATH_RE, '$1[REDACTED]').replace(TOKEN_QUERY_RE, '$1[REDACTED]')
}

const PII_KEYS = new Set([
  'email', 'password', 'phone', 'birthdate', 'first_name', 'last_name',
  'token', 'otp', 'code', 'turnstile_token', 'access_token', 'refresh_token',
])

export function scrubPii(obj) {
  if (!obj || typeof obj !== 'object') return obj
  const safe = {}
  for (const [k, v] of Object.entries(obj)) {
    // Any *token* / *secret* / *password* key too (share_token, ticket_token …).
    if (PII_KEYS.has(k) || /token|secret|password|ticket/i.test(k)) {
      safe[k] = '[REDACTED]'
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      safe[k] = scrubPii(v)
    } else {
      safe[k] = v
    }
  }
  return safe
}

/**
 * KSCW SQL Workspace endpoints — Superuser-only read-mostly Postgres console.
 *
 * Routes (mounted under /kscw):
 *   GET  /admin/sql/schema  — public schema tables, columns, keys and value hints
 *                             for the sidebar + editor autocomplete
 *   POST /admin/sql         — execute SQL: { sql, write_mode? } → { columns, rows, ... }
 *
 * Safety guarantees:
 *   - Auth: superuser only (directus_roles.name='Superuser')
 *   - Default mode = read-only: per-statement DML keyword detector + transaction
 *     is opened with `SET LOCAL TRANSACTION READ ONLY` and auto-rolled-back
 *   - write_mode=true: still wrapped in a transaction (commits on success), still
 *     superuser only, but DML/DDL allowed — and only with the 6-digit write PIN
 *     (`write_pin`), compared against the container env `SQL_WRITE_PIN`
 *   - statement_timeout = 15s
 *   - Auto-LIMIT 1000 appended to single bare SELECTs without LIMIT
 *   - Every call audited to JSONL via writeErrorLog (event: 'sql_workspace')
 */

import { timingSafeEqual } from 'node:crypto'
import { writeErrorLog } from './error-log.js'
import { writeUserLog } from './activity-log.js'
import { loadSchemaModel, invalidateSchemaCache } from './sql-schema.js'

const STATEMENT_TIMEOUT_MS = 15000
const DEFAULT_ROW_CAP = 1000
const SQL_PREVIEW_MAX = 1500

// pg type OIDs of the two zone-less temporal types, plus their array forms.
const PG_DATE = 1082
const PG_DATE_ARRAY = 1182
const PG_TIMESTAMP = 1114
const PG_TIMESTAMP_ARRAY = 1115

const pad2 = (n) => String(n).padStart(2, '0')

/** `date` → `YYYY-MM-DD`. Local getters on purpose: postgres-date built the
 *  Date with `new Date(y, m, d)` in the container's zone, so only the local
 *  fields round-trip — the ISO string shifts a day under any positive offset. */
function localDateText(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** `timestamp` (no zone) → `YYYY-MM-DD HH:MM:SS[.mmm]`, Postgres's own text form. */
function localTimestampText(d) {
  const ms = d.getMilliseconds()
  return `${localDateText(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
    + (ms ? `.${String(ms).padStart(3, '0')}` : '')
}

/**
 * Put the wall-clock text back on zone-less temporal cells.
 *
 * node-postgres hands a `date` or a `timestamp without time zone` back as a
 * JS Date built with local constructors in the *container's* zone, and
 * `res.json()` then serialises it with `toISOString()` — so `2026-09-15` left
 * here as `2026-09-15T00:00:00.000Z`, which the browser rendered as
 * "15.09.2026 02:00" (Zurich) and Excel as a midnight datetime. Neither type
 * carries a zone, so the only faithful representation is the text Postgres
 * itself prints. `timestamptz` is left alone: its Date IS the instant, and
 * the ISO form is exact — the client renders it in Europe/Zurich.
 *
 * Pure; exported for the unit test.
 */
export function pgTemporalToText(dataTypeID, value) {
  if (value == null) return value
  switch (dataTypeID) {
    case PG_DATE:
      return value instanceof Date ? localDateText(value) : value
    case PG_TIMESTAMP:
      return value instanceof Date ? localTimestampText(value) : value
    case PG_DATE_ARRAY:
      return Array.isArray(value) ? value.map((v) => pgTemporalToText(PG_DATE, v)) : value
    case PG_TIMESTAMP_ARRAY:
      return Array.isArray(value) ? value.map((v) => pgTemporalToText(PG_TIMESTAMP, v)) : value
    default:
      return value
  }
}

// Top-level DDL/DML keywords we consider "writes" — used for the error message.
// The GATE in read-only mode is the READ_KEYWORDS allowlist below, not this list:
// a blocklist missed COMMIT/END/ROLLBACK/BEGIN…, and `COMMIT; WITH d AS (DELETE …)`
// ended the READ ONLY transaction and ran the delete in autocommit (2026-09-28 audit).
const WRITE_KEYWORDS = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'TRUNCATE', 'COPY',
  'CREATE', 'ALTER', 'DROP', 'RENAME', 'GRANT', 'REVOKE',
  'COMMENT', 'CLUSTER', 'REINDEX', 'VACUUM', 'ANALYZE',
  'SET', 'RESET', 'DISCARD', 'LISTEN', 'NOTIFY', 'UNLISTEN',
  'CALL', 'DO', 'PREPARE', 'DEALLOCATE', 'EXECUTE',
  'LOCK', 'CHECKPOINT', 'IMPORT', 'LOAD', 'SECURITY', 'REFRESH',
  // Transaction control — any of these escapes the READ ONLY transaction.
  'BEGIN', 'START', 'COMMIT', 'END', 'ROLLBACK', 'ABORT', 'SAVEPOINT', 'RELEASE',
])

/** The ONLY leading keywords accepted in read-only mode. EXPLAIN ANALYZE of a
 *  write still hits the READ ONLY transaction; a data-modifying CTE likewise. */
const READ_KEYWORDS = new Set(['SELECT', 'WITH', 'VALUES', 'SHOW', 'TABLE', 'EXPLAIN'])

const IDENT_CHAR = /[A-Za-z0-9_$\u0080-￿]/

/** Split SQL into statements at top-level `;`, ignoring those inside string
 *  literals (incl. E'…' backslash escapes and $tag$…$tag$ dollar quotes),
 *  identifiers, line comments, and NESTED block comments — the same lexing
 *  Postgres does. Any disagreement with Postgres is a way to hide a second
 *  statement from the read-only check, so an unterminated literal/comment
 *  throws instead of guessing. Returns trimmed non-empty statements. */
export function splitStatements(sql) {
  const out = []
  let buf = ''
  let i = 0
  const n = sql.length
  const fail = () => {
    const err = new Error('Unterminated string, identifier or comment')
    err.status = 400
    err.code = 'unterminated'
    throw err
  }
  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1]
    const prev = i > 0 ? sql[i - 1] : ''
    // Line comment
    if (c === '-' && next === '-') {
      const nl = sql.indexOf('\n', i)
      const end = nl === -1 ? n : nl + 1
      buf += sql.slice(i, end)
      i = end
      continue
    }
    // Block comment — Postgres nests them.
    if (c === '/' && next === '*') {
      let depth = 0
      let j = i
      while (j < n) {
        if (sql[j] === '/' && sql[j + 1] === '*') { depth++; j += 2; continue }
        if (sql[j] === '*' && sql[j + 1] === '/') { depth--; j += 2; if (depth === 0) break; continue }
        j++
      }
      if (depth !== 0) fail()
      buf += sql.slice(i, j)
      i = j
      continue
    }
    // E'…' escape string: backslash escapes the next char ('' still works too).
    if ((c === 'E' || c === 'e') && next === "'" && !IDENT_CHAR.test(prev)) {
      let j = i + 2
      let closed = false
      while (j < n) {
        if (sql[j] === '\\') { j += 2; continue }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue }
          closed = true
          j++
          break
        }
        j++
      }
      if (!closed) fail()
      buf += sql.slice(i, j)
      i = j
      continue
    }
    // Standard string (standard_conforming_strings = on: no backslash escapes).
    if (c === "'") {
      let j = i + 1
      let closed = false
      while (j < n) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue }
          closed = true
          j++
          break
        }
        j++
      }
      if (!closed) fail()
      buf += sql.slice(i, j)
      i = j
      continue
    }
    // Quoted identifier
    if (c === '"') {
      let j = i + 1
      let closed = false
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') { j += 2; continue }
          closed = true
          j++
          break
        }
        j++
      }
      if (!closed) fail()
      buf += sql.slice(i, j)
      i = j
      continue
    }
    // Dollar quote $tag$…$tag$ (not $1 params, not mid-identifier like a$b).
    if (c === '$' && !IDENT_CHAR.test(prev)) {
      const m = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/.exec(sql.slice(i))
      if (m) {
        const tag = m[0]
        const close = sql.indexOf(tag, i + tag.length)
        if (close === -1) fail()
        const end = close + tag.length
        buf += sql.slice(i, end)
        i = end
        continue
      }
    }
    if (c === ';') {
      const trimmed = buf.trim()
      if (trimmed) out.push(trimmed)
      buf = ''
      i++
      continue
    }
    buf += c
    i++
  }
  const tail = buf.trim()
  if (tail) out.push(tail)
  // Comment-only chunks (`SELECT 1; -- note`) are not statements.
  return out.filter((st) => stripLeadingComments(st) !== '')
}

/** Strip leading whitespace and line/block comments (nested). */
function stripLeadingComments(stmt) {
  let s = stmt
  while (true) {
    s = s.replace(/^\s+/, '')
    if (s.startsWith('--')) {
      const nl = s.indexOf('\n')
      s = nl === -1 ? '' : s.slice(nl + 1)
      continue
    }
    if (s.startsWith('/*')) {
      let depth = 0
      let j = 0
      while (j < s.length) {
        if (s[j] === '/' && s[j + 1] === '*') { depth++; j += 2; continue }
        if (s[j] === '*' && s[j + 1] === '/') { depth--; j += 2; if (depth === 0) break; continue }
        j++
      }
      s = depth === 0 ? s.slice(j) : ''
      continue
    }
    return s
  }
}

/** First keyword after leading comments (uppercased), or '' if none. */
export function leadingKeyword(stmt) {
  // Strip an opening parenthesis (e.g. `(SELECT ...)`)
  const s = stripLeadingComments(stmt).replace(/^\(+/, '')
  const m = s.match(/^([A-Za-z]+)/)
  return m ? m[1].toUpperCase() : ''
}

/** True iff this single-statement SQL is a bare SELECT/WITH/VALUES/SHOW with
 *  no existing LIMIT clause at the end. Heuristic — good enough for the
 *  auto-cap. */
function shouldAutoLimit(stmt) {
  const kw = leadingKeyword(stmt)
  if (kw !== 'SELECT' && kw !== 'WITH' && kw !== 'VALUES' && kw !== 'SHOW' && kw !== 'TABLE') {
    return false
  }
  // Quick: contains the word LIMIT followed by whitespace/digits anywhere in
  // the tail half of the string. Slightly over-permissive but the cost of a
  // false-skip is just "no auto cap" — the timeout still applies.
  return !/\blimit\b\s+\d/i.test(stmt)
}

// ── Write PIN ────────────────────────────────────────────────────────────────
// Every full admin (since migration 402 that includes the full-scope board) can
// open this page, so write mode asks for a PIN on top of admin_access. It lives
// in the container env, never in git (the repo is public) and never in a table
// (read mode can SELECT any table). Unset or malformed = write mode refused.
// A 6-digit PIN is only as good as its attempt limit: PIN_MAX_FAILS wrong tries
// lock that user out of write mode for PIN_LOCK_MS.
const PIN_MAX_FAILS = 5
const PIN_LOCK_MS = 15 * 60 * 1000

/** Per-user failure state for the write PIN. Exported for tests. */
export function createWritePinGate({ maxFails = PIN_MAX_FAILS, lockMs = PIN_LOCK_MS } = {}) {
  const fails = new Map() // userId → { count, lockedUntil }

  /** → null when allowed, else { status, code, message }. */
  return function checkWritePin(userId, pin, expected, now = Date.now()) {
    if (!/^\d{6}$/.test(String(expected ?? ''))) {
      return { status: 503, code: 'write_pin_unconfigured', message: 'Write mode is not configured on this server' }
    }
    const state = fails.get(userId)
    if (state?.lockedUntil && state.lockedUntil > now) {
      return { status: 429, code: 'write_pin_locked', message: 'Too many wrong PINs — write mode is locked for 15 minutes' }
    }
    const given = Buffer.from(String(pin ?? ''))
    const want = Buffer.from(String(expected))
    if (given.length === want.length && timingSafeEqual(given, want)) {
      fails.delete(userId)
      return null
    }
    const count = (state?.lockedUntil && state.lockedUntil <= now ? 0 : state?.count ?? 0) + 1
    fails.set(userId, { count, lockedUntil: count >= maxFails ? now + lockMs : null })
    return count >= maxFails
      ? { status: 429, code: 'write_pin_locked', message: 'Too many wrong PINs — write mode is locked for 15 minutes' }
      : { status: 403, code: 'write_pin_invalid', message: 'Wrong PIN' }
  }
}

export function registerSqlWorkspace(router, ctx) {
  const { database, logger } = ctx
  const log = logger.child({ extension: 'kscw-sql-workspace' })
  const checkWritePin = createWritePinGate()

  function requireAuth(req) {
    if (!req.accountability?.user) {
      const err = new Error('Authentication required')
      err.status = 401
      throw err
    }
  }

  /** Gate on the resolved `admin_access` policy flag, not on the mutable
   *  `directus_roles.name` string. Same rationale as audit.js — a renamed
   *  role would otherwise slip through, and the role-name check 403s
   *  legitimate superusers whose Directus role isn't literally "Superuser". */
  function requireSuperuser(req) {
    requireAuth(req)
    if (req.accountability.admin !== true) {
      log.warn({ msg: 'Superuser access denied (sql-workspace)', userId: req.accountability.user })
      const err = new Error('Superuser access required')
      err.status = 403
      throw err
    }
  }

  // ── GET /admin/sql/schema ────────────────────────────────────
  // Columns, keys and value hints (see sql-schema.js). `?refresh=1` bypasses
  // the 60s cache — that's what the sidebar's refresh button sends.
  router.get('/admin/sql/schema', async (req, res) => {
    try {
      await requireSuperuser(req)
      const force = req.query?.refresh === '1' || req.query?.refresh === 'true'
      const model = await loadSchemaModel(database, log, force)
      res.json(model)
    } catch (err) {
      log.error({ msg: 'admin/sql/schema failed', error: err.message, status: err.status })
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
    }
  })

  // ── POST /admin/sql ──────────────────────────────────────────
  router.post('/admin/sql', async (req, res) => {
    const started = Date.now()
    let userId = null
    let sqlText = ''
    let writeMode = false
    try {
      await requireSuperuser(req)
      userId = req.accountability.user

      sqlText = String(req.body?.sql ?? '').trim()
      writeMode = req.body?.write_mode === true

      // Before anything else in write mode: the PIN covers the whole run,
      // including a data-modifying CTE that reads like a SELECT.
      if (writeMode) {
        const denied = checkWritePin(userId, req.body?.write_pin, process.env.SQL_WRITE_PIN)
        if (denied) {
          log.warn({ msg: 'SQL write PIN refused', userId, code: denied.code })
          const err = new Error(denied.message)
          err.status = denied.status
          err.code = denied.code
          throw err
        }
      }

      if (!sqlText) return res.status(400).json({ error: 'sql required' })
      if (sqlText.length > 100000) return res.status(400).json({ error: 'sql too large (max 100KB)' })

      const statements = splitStatements(sqlText)
      if (statements.length === 0) return res.status(400).json({ error: 'no executable statements' })

      // Reject writes in read-only mode (per-statement check) — fail before
      // any execution so a partially-applied multi-statement script can't
      // happen.
      if (!writeMode) {
        for (const stmt of statements) {
          const kw = leadingKeyword(stmt)
          // Allowlist, not blocklist — anything that is not a plain read needs write mode.
          if (!READ_KEYWORDS.has(kw)) {
            const err = new Error(WRITE_KEYWORDS.has(kw)
              ? `Statement "${kw}" requires write mode`
              : `Only SELECT / WITH / VALUES / SHOW / TABLE / EXPLAIN run in read-only mode${kw ? ` (got "${kw}")` : ''}`)
            err.status = 400
            err.code = 'write_required'
            throw err
          }
        }
      }

      // Last statement decides what we return to the client (most useful for
      // explorations like `WITH ... SELECT ...;` followed by a final SELECT).
      // We still execute all statements in order inside the same transaction.
      const lastIdx = statements.length - 1
      let finalColumns = []
      let finalRows = []
      let totalRowCount = 0
      let truncated = false

      await database.transaction(async (trx) => {
        await trx.raw(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`)
        if (!writeMode) await trx.raw('SET LOCAL TRANSACTION READ ONLY')

        for (let i = 0; i < statements.length; i++) {
          let stmt = statements[i]
          if (i === lastIdx && shouldAutoLimit(stmt)) {
            stmt = `${stmt}\nLIMIT ${DEFAULT_ROW_CAP + 1}`
          }
          let result
          try {
            result = await trx.raw(stmt)
          } catch (pgErr) {
            // Re-throw with Postgres metadata stripped of the echoed query
            // (knex prefixes the raw SQL onto the error message). Surface
            // the PG error code so the client can show a useful 400.
            const pgMessage = pgErr?.message?.split(' - ').pop() ?? pgErr?.message ?? 'query failed'
            const wrapped = new Error(pgMessage)
            wrapped.status = 400
            wrapped.code = pgErr?.code ?? 'pg_error'
            wrapped.detail = pgErr?.detail ?? null
            wrapped.hint = pgErr?.hint ?? null
            wrapped.position = pgErr?.position ?? null
            wrapped.statementIndex = i
            throw wrapped
          }
          // For non-SELECT statements, pg returns rowCount/command without
          // .fields. Surface them as a single-row diagnostic on the final
          // statement.
          if (i === lastIdx) {
            const fields = result?.fields ?? []
            if (fields.length > 0) {
              finalColumns = fields.map((f) => f.name)
              const typeIds = fields.map((f) => f.dataTypeID)
              const project = (r) => finalColumns.map((c, k) => pgTemporalToText(typeIds[k], r[c]))
              const raw = result.rows ?? []
              if (raw.length > DEFAULT_ROW_CAP) {
                truncated = true
                finalRows = raw.slice(0, DEFAULT_ROW_CAP).map(project)
              } else {
                finalRows = raw.map(project)
              }
              totalRowCount = raw.length
            } else {
              finalColumns = ['command', 'rowCount']
              finalRows = [[result?.command ?? 'OK', result?.rowCount ?? 0]]
              totalRowCount = 1
            }
          }
        }
      })

      // Write mode may have been DDL — the cached schema model is stale now.
      if (writeMode) invalidateSchemaCache()

      const durationMs = Date.now() - started
      writeErrorLog({
        level: 'info',
        source: 'backend',
        project: 'wiedisync',
        event: 'sql_workspace',
        endpoint: '/admin/sql',
        userId,
        action: writeMode ? 'execute_write' : 'execute_read',
        status: 200,
        durationMs,
        rowCount: totalRowCount,
        truncated,
        statementCount: statements.length,
        sqlPreview: sqlText.slice(0, SQL_PREVIEW_MAX),
      })

      // Superuser audit trail (/admin/audit-log). The JSONL entry above is the
      // ops log; user_logs is where "who ran what" is reviewed. Never throws.
      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: writeMode ? 'sql_write' : 'sql_read',
        collection: 'sql_workspace',
        recordId: null,
        data: {
          sql: sqlText.slice(0, SQL_PREVIEW_MAX),
          truncated_sql: sqlText.length > SQL_PREVIEW_MAX,
          statements: statements.length,
          row_count: totalRowCount,
        },
      })

      res.json({
        columns: finalColumns,
        rows: finalRows,
        row_count: totalRowCount,
        duration_ms: durationMs,
        truncated,
        statements: statements.length,
        write_mode: writeMode,
      })
    } catch (err) {
      const durationMs = Date.now() - started
      writeErrorLog({
        level: 'error',
        source: 'backend',
        project: 'wiedisync',
        event: 'sql_workspace',
        endpoint: '/admin/sql',
        userId,
        action: writeMode ? 'execute_write' : 'execute_read',
        status: err.status || 500,
        durationMs,
        error: err.message?.slice(0, 1000) ?? null,
        code: err.code ?? null,
        sqlPreview: sqlText.slice(0, SQL_PREVIEW_MAX),
      })
      res.status(err.status || 500).json({
        error: err.status ? err.message : 'Internal error',
        code: err.code ?? null,
        detail: err.detail ?? null,
        hint: err.hint ?? null,
        position: err.position ?? null,
        statement_index: err.statementIndex ?? null,
        duration_ms: durationMs,
      })
    }
  })
}

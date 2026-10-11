/**
 * KSCW SQL Workspace endpoints — Superuser-only read-mostly Postgres console.
 *
 * Routes (mounted under /kscw):
 *   GET  /admin/sql/schema  — public schema tables, columns, keys and value hints
 *                             for the sidebar + editor autocomplete
 *   POST /admin/sql         — execute SQL: { sql, write_mode? } → { columns, rows, ... }
 *
 * Safety guarantees:
 *   - Auth: full admins only (`accountability.admin`)
 *   - Both modes: statements that change session state on the pooled
 *     connection (SET/RESET/DISCARD/LISTEN/…, transaction control, temp
 *     tables) and functions that do (set_config, advisory locks, dblink,
 *     query_to_xml & co.) are refused before anything runs — see
 *     checkStatementPolicy(). So are functions, triggers, rules, roles,
 *     grants and ownership changes: those belong in a reviewed migration.
 *   - Default mode = read-only: leading-keyword allowlist, then a
 *     `SET LOCAL TRANSACTION READ ONLY` transaction as the restricted role
 *     `kscw_sql_reader` (no credential tables/columns) that is ALWAYS rolled
 *     back, never committed (sql-reader.js)
 *   - write_mode=true: still wrapped in a transaction (commits on success), still
 *     admin only, DML and ordinary DDL allowed — and only with the 6-digit write
 *     PIN (`write_pin`), compared against the container env `SQL_WRITE_PIN`
 *   - statement_timeout = 15s
 *   - Auto-LIMIT 1000 appended to single bare SELECTs without LIMIT
 *   - Every call audited to JSONL via writeErrorLog (event: 'sql_workspace')
 */

import { timingSafeEqual } from 'node:crypto'
import { writeErrorLog } from './error-log.js'
import { writeUserLog } from './activity-log.js'
import { loadSchemaModel, invalidateSchemaCache } from './sql-schema.js'
import { withReadOnlyReader } from './sql-reader.js'

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
const SPACE = /\s/

/** Lex SQL into tokens the way Postgres does: string literals (incl. E'…'
 *  backslash escapes and $tag$…$tag$ dollar quotes), quoted identifiers, line
 *  comments and NESTED block comments are single tokens, so nothing inside
 *  them is ever read as code. Any disagreement with Postgres is a way to hide
 *  code from the guards below, so an unterminated literal/comment throws
 *  instead of guessing. Token types: ws, comment, string, qident, word,
 *  semicolon, other (one punctuation/operator character). Concatenating every
 *  token's `text` gives back the input exactly. */
export function lexSql(sql) {
  const tokens = []
  let i = 0
  const n = sql.length
  const fail = () => {
    const err = new Error('Unterminated string, identifier or comment')
    err.status = 400
    err.code = 'unterminated'
    throw err
  }
  const push = (type, end) => {
    tokens.push({ type, text: sql.slice(i, end) })
    i = end
  }
  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1]
    const prev = i > 0 ? sql[i - 1] : ''
    // Line comment
    if (c === '-' && next === '-') {
      const nl = sql.indexOf('\n', i)
      push('comment', nl === -1 ? n : nl + 1)
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
      push('comment', j)
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
      push('string', j)
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
      push('string', j)
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
      push('qident', j)
      continue
    }
    // Dollar quote $tag$…$tag$ (not $1 params, not mid-identifier like a$b).
    if (c === '$' && !IDENT_CHAR.test(prev)) {
      const m = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/.exec(sql.slice(i))
      if (m) {
        const tag = m[0]
        const close = sql.indexOf(tag, i + tag.length)
        if (close === -1) fail()
        push('string', close + tag.length)
        continue
      }
    }
    if (c === ';') { push('semicolon', i + 1); continue }
    if (SPACE.test(c)) {
      let j = i + 1
      while (j < n && SPACE.test(sql[j])) j++
      push('ws', j)
      continue
    }
    // A run of identifier characters. None of the constructs above can start
    // inside the run: each needs a non-identifier character or a
    // non-identifier predecessor, so the run ends exactly where the
    // character-by-character scan would have found one.
    if (IDENT_CHAR.test(c)) {
      let j = i + 1
      while (j < n && IDENT_CHAR.test(sql[j])) j++
      push('word', j)
      continue
    }
    push('other', i + 1)
  }
  return tokens
}

/** Split SQL into statements at top-level `;` (see lexSql — a `;` inside a
 *  literal, identifier or comment is not a boundary). Returns trimmed
 *  non-empty statements. */
export function splitStatements(sql) {
  const out = []
  let buf = ''
  for (const tok of lexSql(sql)) {
    if (tok.type === 'semicolon') {
      const trimmed = buf.trim()
      if (trimmed) out.push(trimmed)
      buf = ''
      continue
    }
    buf += tok.text
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

// ── Statement policy (both modes) ────────────────────────────────────────────
// READ ONLY stops writes to tables, not everything that outlives a request:
// knex hands the connection back to the pool afterwards, so a session-level
// SET / set_config(…, false), an advisory lock or a LISTEN carried over into
// whichever request — anyone's — drew that connection next. The DB guards
// (kscw.publish_file, kscw.allow_junction_repoint, kscw.signup_slug_write,
// kscw.allow_deactivated_at_edit) are exactly such settings (2026-10-11 audit,
// H4a). Read mode now always rolls back, which undoes SET; these refusals cover
// what a rollback does not (locks, terminated backends), write mode (which
// commits), and SET ROLE's way back out of the reader role. They also keep
// code — functions, triggers, rules, DO — out of the database: write mode runs
// as the schema owner, and anything planted there later runs inside superuser
// host tooling (migrations, the nightly dev refresh). Schema changes of that
// kind belong in a reviewed migration (H5).
//
// Matching runs on lexSql() tokens, so string literals and comments never
// match, quoted identifiers are unwrapped, and every part of a schema-qualified
// name is checked. All names are lower-cased (an upper-case quoted name is a
// different, nonexistent function — refusing it costs nothing).

const MIGRATION_HINT = 'Functions, triggers, rules, roles, grants and ownership changes belong in a numbered migration ' +
  '(directus/scripts/NNN-*.sql), where they are reviewed — code created here would later run inside superuser tooling.'
/** Read mode: what a 42501 from the reader role means. */
const CREDENTIAL_DENIED_HINT = 'Read mode cannot see passwords, tokens, 2FA secrets, private keys, sessions, shares, ' +
  'reset/verification codes, identity documents or VM sheets. SELECT * fails on a table that has such a column ' +
  '(directus_users, members, …) — list the columns you need instead; the schema sidebar shows only readable columns.'
const POOLED_HINT = 'The workspace borrows a pooled database connection that later requests reuse, so nothing it runs may ' +
  'leave session state behind.'

const TX_CONTROL = 'each run is already exactly one transaction (read mode always rolls back, write mode commits once ' +
  'at the end) — remove the transaction control'
/** Leading keywords refused in both modes → why. */
const SESSION_STATEMENTS = new Map([
  ['set', 'changes a setting on the connection — read one with SHOW or current_setting()'],
  ['reset', 'changes a setting on the connection — read one with SHOW or current_setting()'],
  ['discard', 'resets session state on the connection'],
  ['listen', 'subscribes the connection to notifications'],
  ['unlisten', 'changes the connection\'s notification subscriptions'],
  ['notify', 'sends a notification'],
  ['load', 'loads a server library'],
  ['copy', 'copies to or from the server — export from the result grid instead'],
  ['prepare', 'creates a prepared statement or transaction that outlives the request'],
  ['deallocate', 'drops prepared statements on the connection'],
  ['execute', 'runs a prepared statement'],
  ['begin', TX_CONTROL], ['start', TX_CONTROL], ['commit', TX_CONTROL], ['end', TX_CONTROL],
  ['rollback', TX_CONTROL], ['abort', TX_CONTROL], ['savepoint', TX_CONTROL], ['release', TX_CONTROL],
])

/** Functions refused in both modes: [pattern, why]. */
const BLOCKED_FUNCTIONS = [
  [/^set_config$/, 'changes a setting on the connection'],
  [/^pg_(try_)?advisory_/, 'takes an advisory lock that can outlive the request'],
  [/^pg_(terminate|cancel)_backend$/, 'stops other database sessions'],
  [/^pg_(reload_conf|rotate_logfile)$/, 'administers the server'],
  [/_to_xml(schema|_and_xmlschema)?$/, 'runs SQL passed to it as text'],
  [/^ts_(stat|rewrite)$/, 'runs SQL passed to it as text'],
  [/^dblink/, 'opens connections to other databases'],
  [/^lo_|^lo(read|write)$/, 'reads or writes large objects and server files'],
  [/^pg_read_(binary_)?file$|^pg_ls_|^pg_stat_file$|^pg_file_/, 'reads or writes server files'],
  [/^pg_notify$/, 'sends a notification'],
  [/^pg_(create|drop|copy)_|^pg_(logical|replication)_/, 'administers replication'],
  [/^pg_(switch_wal|promote|backup_start|backup_stop|start_backup|stop_backup|import_system_collations|log_backend_memory_contexts)$|^pg_stat_reset/, 'administers the server'],
]

/** CREATE / ALTER / DROP of these objects is refused in both modes. */
const DDL_VERBS = new Set(['create', 'alter', 'drop'])
/** Words between the verb and the object (`CREATE OR REPLACE TRUSTED LANGUAGE`,
 *  `CREATE CONSTRAINT TRIGGER`, `ALTER DEFAULT PRIVILEGES`, `CREATE TEMP …`). */
const DDL_MODIFIERS = new Set([
  'or', 'replace', 'constraint', 'trusted', 'procedural', 'default',
  'global', 'local', 'temp', 'temporary', 'unlogged', 'recursive',
])
const DDL_OBJECTS = new Set([
  'function', 'procedure', 'routine', 'trigger', 'event', 'rule', 'aggregate',
  'operator', 'cast', 'language', 'extension', 'transform', 'conversion',
  'role', 'user', 'group', 'policy', 'privileges', 'owned', 'system', 'database',
  'tablespace', 'server', 'foreign', 'publication', 'subscription', 'access', 'large',
])

function refusal(code, message, hint) {
  return { code, message, hint }
}

/** A word or quoted identifier's name, lower-cased; null for anything else. */
function tokenName(tok) {
  if (tok.type === 'word') return tok.text.toLowerCase()
  if (tok.type === 'qident') return tok.text.slice(1, -1).replace(/""/g, '"').toLowerCase()
  return null
}

/**
 * Refuse a single statement that would leave state behind on the pooled
 * connection, reach outside the database, or plant code/privileges — in BOTH
 * modes. Pure; exported for the unit test.
 * @returns {null | { code: string, message: string, hint: string }}
 */
export function checkStatementPolicy(stmt) {
  const raw = lexSql(stmt)

  // U&"…" identifiers spell names with escapes (U&"set\005fconfig"); nothing
  // legitimate needs one, so refuse it rather than decode it.
  for (let k = 0; k + 2 < raw.length; k++) {
    if (raw[k].type === 'word' && /[uU]$/.test(raw[k].text)
      && raw[k + 1].type === 'other' && raw[k + 1].text === '&' && raw[k + 2].type === 'qident') {
      return refusal('statement_not_allowed', 'Unicode-escaped identifiers (U&"…") are not allowed in the SQL workspace',
        'Write the identifier plainly.')
    }
  }

  // Significant tokens only: whitespace and comments dropped; strings kept as
  // opaque placeholders so they never match a name.
  const sig = raw.filter((t) => t.type !== 'ws' && t.type !== 'comment')
  const isWord = (k, ...words) => sig[k]?.type === 'word' && words.includes(sig[k].text.toLowerCase())
  const names = sig.map(tokenName).filter((v) => v !== null)

  let lead = 0
  while (sig[lead]?.type === 'other' && sig[lead].text === '(') lead++
  const leadWord = sig[lead]?.type === 'word' ? sig[lead].text.toLowerCase() : ''

  // SET CONSTRAINTS only defers FK checks to the end of this transaction.
  // Every other SET form — SET LOCAL included — could switch the statement
  // timeout, the READ ONLY mode or the reader role back off mid-run.
  const setConstraints = leadWord === 'set' && isWord(lead + 1, 'constraints')
  if (SESSION_STATEMENTS.has(leadWord) && !setConstraints) {
    return refusal('statement_not_allowed',
      `${leadWord.toUpperCase()} is not allowed in the SQL workspace: it ${SESSION_STATEMENTS.get(leadWord)}`, POOLED_HINT)
  }
  if (leadWord === 'declare' && names.includes('hold')) {
    return refusal('statement_not_allowed', 'DECLARE … WITH HOLD is not allowed in the SQL workspace: the cursor outlives the request',
      POOLED_HINT)
  }
  if (leadWord === 'do' || leadWord === 'reassign' || leadWord === 'import') {
    return refusal('ddl_not_allowed', `${leadWord.toUpperCase()} is not allowed in the SQL workspace`, MIGRATION_HINT)
  }

  for (const name of names) {
    for (const [re, why] of BLOCKED_FUNCTIONS) {
      if (re.test(name)) {
        return refusal('function_not_allowed', `Function "${name}" is not allowed in the SQL workspace: it ${why}`, POOLED_HINT)
      }
    }
    if (/^pg_temp(_\d+)?$/.test(name)) {
      return refusal('statement_not_allowed', 'Temporary objects are not allowed in the SQL workspace', POOLED_HINT)
    }
  }

  // pg_settings has an UPDATE rule that calls set_config — it is SET by another
  // name, and write mode commits it onto the pooled connection. (Read mode's
  // READ ONLY refuses the rewritten query; refused there too for one rule.)
  if (names.includes('pg_settings') && names.includes('update')) {
    return refusal('statement_not_allowed', 'Updating pg_settings is not allowed in the SQL workspace: it changes settings on the connection',
      POOLED_HINT)
  }

  for (let k = 0; k < sig.length; k++) {
    // Temporary tables survive a commit on the pooled connection and are found
    // before public tables of the same name by every later request.
    if (isWord(k, 'temp', 'temporary') && isWord(k - 1, 'create', 'replace', 'local', 'global', 'into')) {
      return refusal('statement_not_allowed', 'Temporary tables are not allowed in the SQL workspace: they outlive the request on the connection',
        POOLED_HINT)
    }
    if (isWord(k, ...DDL_VERBS)) {
      let j = k + 1
      while (isWord(j, ...DDL_MODIFIERS)) j++
      if (sig[j]?.type === 'word' && DDL_OBJECTS.has(sig[j].text.toLowerCase())) {
        return refusal('ddl_not_allowed',
          `${sig[k].text.toUpperCase()} ${sig[j].text.toUpperCase()} is not allowed in the SQL workspace`, MIGRATION_HINT)
      }
    }
    if (isWord(k, 'enable', 'disable')) {
      let j = k + 1
      while (isWord(j, 'replica', 'always')) j++
      if (isWord(j, 'trigger', 'rule')) {
        return refusal('ddl_not_allowed',
          `${sig[k].text.toUpperCase()} ${sig[j].text.toUpperCase()} is not allowed in the SQL workspace: triggers and rules are the database's guards`,
          MIGRATION_HINT)
      }
    }
    if (isWord(k, 'owner') && isWord(k + 1, 'to')) {
      return refusal('ddl_not_allowed', 'Ownership changes (OWNER TO) are not allowed in the SQL workspace', MIGRATION_HINT)
    }
    if (isWord(k, 'grant', 'revoke', 'authorization')) {
      return refusal('ddl_not_allowed', `${sig[k].text.toUpperCase()} is not allowed in the SQL workspace`, MIGRATION_HINT)
    }
  }
  return null
}

// ── Write PIN ────────────────────────────────────────────────────────────────
// Every full admin (since migration 402 that includes the full-scope board) can
// open this page, so write mode asks for a PIN on top of admin_access. It lives
// in the container env, never in git (the repo is public) and never in a table
// (read mode can SELECT nearly every table). Unset or malformed = write mode
// refused. Write mode runs as the Directus login role, not kscw_sql_reader, so
// the PIN is also what stands between an admin and the credential columns.
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

      // Every check runs on every statement before anything executes, so a
      // multi-statement script is refused whole, never half-applied.
      // Session state, code and privileges: refused in BOTH modes.
      for (let i = 0; i < statements.length; i++) {
        const refused = checkStatementPolicy(statements[i])
        if (refused) {
          log.warn({ msg: 'SQL workspace statement refused', userId, code: refused.code, writeMode })
          const err = new Error(refused.message)
          err.status = 400
          err.code = refused.code
          err.hint = refused.hint
          err.statementIndex = i
          throw err
        }
      }

      // Reject writes in read-only mode (per-statement check).
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

      const runStatements = async (trx) => {
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
            // Read mode runs as kscw_sql_reader, which has no SELECT on
            // credential tables/columns — Postgres reports that as 42501.
            if (!writeMode && pgErr?.code === '42501') {
              wrapped.message = `${pgMessage} — the SQL workspace cannot read credential tables or columns`
              wrapped.code = 'credential_column_denied'
              wrapped.detail = pgMessage
              wrapped.hint = CREDENTIAL_DENIED_HINT
            }
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
      }

      if (writeMode) {
        // Commits when the handler resolves — the one mode meant to.
        await database.transaction(async (trx) => {
          await trx.raw(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`)
          await runStatements(trx)
        })
      } else {
        // READ ONLY, as kscw_sql_reader, and rolled back even on success.
        await withReadOnlyReader(database, runStatements, { statementTimeoutMs: STATEMENT_TIMEOUT_MS })
      }

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

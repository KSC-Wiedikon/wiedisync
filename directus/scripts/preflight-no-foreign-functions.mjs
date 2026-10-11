/**
 * preflight-no-foreign-functions.mjs — the JS side of
 * preflight-no-foreign-functions.sql (security review 2026-10-11, H5).
 *
 * The SQL lists every function in `public` that a role other than the allowed
 * superuser(s) owns, and every trigger / rule / constraint / default / index /
 * type there that calls one. Superuser host tooling must not run over such a
 * database: whatever those functions do, it would do as the superuser. Read the
 * SQL file's header for the full rationale.
 *
 * This module only builds the psql input and judges the answer, so the runner
 * (apply-migrations.mjs) can stay a thin caller and the logic is unit-testable
 * (__tests__/preflight-no-foreign-functions.test.mjs). The two refresh shell
 * scripts implement the same contract in bash: same SQL, same default, same
 * validation, pass ONLY on the exact line `PREFLIGHT|0`.
 *
 * No npm dependencies.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const PREFLIGHT_SQL_FILE = 'preflight-no-foreign-functions.sql'
export const ALLOWED_OWNERS_ENV = 'KSCW_PREFLIGHT_ALLOWED_OWNERS'
/** Every migration, the baseline and the dev restore run as this role. */
export const DEFAULT_ALLOWED_OWNERS = Object.freeze(['supabase_admin'])
/** The Directus login roles (F29) — the roles this check exists to distrust. */
export const DIRECTUS_LOGIN_ROLES = Object.freeze(['directus_prod', 'directus_dev'])
/** The exact, whole answer of a clean database. */
export const ALL_CLEAR = 'PREFLIGHT|0'

// Unquoted Postgres identifier, lower case. Anything else is refused rather
// than quoted: the list ends up inside a psql \set line.
const ROLE_RE = /^[a-z_][a-z0-9_]{0,62}$/

const HERE = dirname(fileURLToPath(import.meta.url))

export function readPreflightSql(dir = HERE) {
  return readFileSync(join(dir, PREFLIGHT_SQL_FILE), 'utf-8')
}

/**
 * The allowed-owner list: `KSCW_PREFLIGHT_ALLOWED_OWNERS` (comma-separated) or
 * the default. Throws on a malformed name or a Directus login role — the SQL
 * would refuse the latter anyway, but a config typo should not wait for SSH.
 */
export function resolveAllowedOwners(raw = process.env[ALLOWED_OWNERS_ENV]) {
  if (raw == null || String(raw).trim() === '') return [...DEFAULT_ALLOWED_OWNERS]
  const names = String(raw).split(',').map((s) => s.trim()).filter(Boolean)
  if (!names.length) throw new Error(`${ALLOWED_OWNERS_ENV} lists no role`)
  for (const n of names) {
    if (!ROLE_RE.test(n)) throw new Error(`${ALLOWED_OWNERS_ENV}: "${n}" is not a plain lower-case role name`)
    if (DIRECTUS_LOGIN_ROLES.includes(n)) {
      throw new Error(`${ALLOWED_OWNERS_ENV}: "${n}" is a Directus login role — functions it owns are exactly what the pre-flight refuses`)
    }
  }
  return [...new Set(names)]
}

/**
 * psql stdin: the variable first, then the SQL. Set on stdin (not `-v`) because
 * apply-migrations reaches psql through ssh, which re-splits argv in a remote
 * shell — same reason directus-db-role.sql gets its `\set role` this way.
 */
export function buildPreflightInput(sqlText, owners) {
  if (!Array.isArray(owners) || !owners.length) throw new Error('pre-flight: no allowed owners')
  for (const n of owners) {
    if (!ROLE_RE.test(n)) throw new Error(`pre-flight: refusing role name "${n}"`)
  }
  if (!/:'allowed_owners'/.test(sqlText)) throw new Error(`pre-flight: ${PREFLIGHT_SQL_FILE} does not read :'allowed_owners'`)
  return `\\set allowed_owners '${owners.join(',')}'\n${sqlText}`
}

/**
 * Judge psql's stdout. `ok` only when the answer is the all-clear line and
 * nothing else; an empty or truncated answer, a second summary line, or a line
 * of any other shape is a failure (fail-closed).
 */
export function parsePreflightOutput(stdout) {
  const lines = String(stdout ?? '').split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '')
  const offenders = []
  const unexpected = []
  let summary = null
  for (const line of lines) {
    if (line.startsWith('OFFENDER|')) {
      const [, kind = '?', object = '?', fn = '?', owner = '?'] = line.split('|')
      offenders.push({ kind, object, function: fn, owner })
    } else if (/^PREFLIGHT\|\d+$/.test(line) && summary === null) {
      summary = Number(line.slice('PREFLIGHT|'.length))
    } else {
      unexpected.push(line)
    }
  }
  const ok = summary === 0 && offenders.length === 0 && unexpected.length === 0 && lines.length === 1
  return { ok, summary, offenders, unexpected }
}

/** Human-readable failure, one finding per line. Values are printable-only. */
export function formatPreflightFailure(result, { target = '', owners = DEFAULT_ALLOWED_OWNERS } = {}) {
  const clean = (s) => String(s).replace(/[^\x20-\x7e -￿]/g, '?').slice(0, 300)
  const out = [`pre-flight FAILED${target ? ` on ${target}` : ''} — refusing to run superuser tooling over code a non-superuser could have written.`]
  if (result.offenders.length) {
    out.push(`Allowed owners: ${owners.join(', ')} (override: ${ALLOWED_OWNERS_ENV}=a,b). Offenders:`)
    for (const o of result.offenders.slice(0, 50)) out.push(`  ${clean(o.kind)}: ${clean(o.object)}  →  ${clean(o.function)}  (owner ${clean(o.owner)})`)
    if (result.offenders.length > 50) out.push(`  … and ${result.offenders.length - 50} more`)
  }
  if (result.summary === null) out.push('No PREFLIGHT summary line — the check did not complete.')
  else if (result.summary !== result.offenders.length) out.push(`Summary says ${result.summary} finding(s), ${result.offenders.length} listed — answer incomplete.`)
  for (const u of result.unexpected.slice(0, 10)) out.push(`  unexpected output: ${clean(u)}`)
  out.push('Inspect before doing anything else: a function only a Directus role could have created means that role\'s DDL is in someone else\'s hands.')
  return out.join('\n')
}

/**
 * Run the check through `runPsql(stdin) → stdout` (which must throw when psql
 * fails). Returns the parse result; never throws on findings — the caller
 * decides how to stop.
 */
export function runPreflight(runPsql, { sqlText = readPreflightSql(), owners = resolveAllowedOwners() } = {}) {
  return parsePreflightOutput(runPsql(buildPreflightInput(sqlText, owners)))
}

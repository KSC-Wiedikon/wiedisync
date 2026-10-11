/**
 * H5 pre-flight (security review 2026-10-11): superuser host tooling must not
 * run over a database where a non-superuser could have planted code.
 *
 * WHY THIS EXISTS
 * ---------------
 * Directus logs in as a NOSUPERUSER role that owns the tables in `public`, so
 * whoever holds its DDL can hang a function on a trigger / CHECK / DEFAULT /
 * index. apply-migrations.mjs and both dev-refresh scripts fire those as the
 * psql superuser. preflight-no-foreign-functions.sql refuses such a database;
 * this file pins
 *   • the JS judge (apply-migrations): fail-closed on anything but the exact
 *     all-clear line, owner-list validation, psql input construction;
 *   • the bash judge (both refresh scripts), executed against a fake `docker`;
 *   • WHERE each caller runs it — before the first statement that can fire
 *     anything, and on the SOURCE of every --no-owner dump.
 *
 * Nothing here talks to a database.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, chmodSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  ALL_CLEAR, ALLOWED_OWNERS_ENV, DEFAULT_ALLOWED_OWNERS, PREFLIGHT_SQL_FILE,
  buildPreflightInput, formatPreflightFailure, parsePreflightOutput, readPreflightSql,
  resolveAllowedOwners, runPreflight,
} from '../preflight-no-foreign-functions.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (f) => readFileSync(resolve(HERE, '..', f), 'utf-8')
const sql = readPreflightSql()
const runner = read('apply-migrations.mjs')
const daily = read('refresh-dev-daily.sh')
const manual = read('refresh-dev-from-prod.sh')

// ── Owner list ───────────────────────────────────────────────────────────────
test('allowed owners: default, override, dedupe', () => {
  assert.deepEqual(DEFAULT_ALLOWED_OWNERS, ['supabase_admin', 'postgres'])
  assert.deepEqual(resolveAllowedOwners(undefined), ['supabase_admin', 'postgres'])
  assert.deepEqual(resolveAllowedOwners(''), ['supabase_admin', 'postgres'])
  assert.deepEqual(resolveAllowedOwners('  '), ['supabase_admin', 'postgres'])
  assert.deepEqual(resolveAllowedOwners('supabase_admin, postgres'), ['supabase_admin', 'postgres'])
  assert.deepEqual(resolveAllowedOwners('postgres,postgres'), ['postgres'])
})

test('allowed owners: malformed names and the Directus roles are refused', () => {
  for (const bad of [',', 'Supabase_Admin', 'a b', "x'; DROP", 'a-b', '"quoted"', '1abc', 'x'.repeat(64)]) {
    assert.throws(() => resolveAllowedOwners(bad), new RegExp(ALLOWED_OWNERS_ENV), `accepted ${JSON.stringify(bad)}`)
  }
  assert.throws(() => resolveAllowedOwners('supabase_admin,directus_prod'), /Directus login role/)
  assert.throws(() => resolveAllowedOwners('directus_dev'), /Directus login role/)
})

// ── psql input ───────────────────────────────────────────────────────────────
test('the variable goes in on stdin, ahead of the SQL', () => {
  const input = buildPreflightInput(sql, ['supabase_admin', 'postgres'])
  assert.ok(input.startsWith("\\set allowed_owners 'supabase_admin,postgres'\n"))
  assert.ok(input.endsWith(sql))
  assert.throws(() => buildPreflightInput(sql, []), /no allowed owners/)
  assert.throws(() => buildPreflightInput(sql, ["x'"]), /refusing role name/)
  assert.throws(() => buildPreflightInput('SELECT 1;', ['supabase_admin']), /allowed_owners/)
})

// ── Judging the answer (fail-closed) ─────────────────────────────────────────
test('only the exact all-clear passes', () => {
  assert.equal(ALL_CLEAR, 'PREFLIGHT|0')
  assert.equal(parsePreflightOutput('PREFLIGHT|0').ok, true)
  assert.equal(parsePreflightOutput('PREFLIGHT|0\n').ok, true)
  assert.equal(parsePreflightOutput('PREFLIGHT|0\r\n').ok, true)
  for (const bad of [
    '', '\n', null, undefined,
    'PREFLIGHT|1',
    'PREFLIGHT|',
    'PREFLIGHT|0\nPREFLIGHT|0',
    'SET\nPREFLIGHT|0',                       // formatting not pinned → refuse
    'PREFLIGHT|0 ',
    'OFFENDER|function|public.f()|public.f()|directus_prod\nPREFLIGHT|0',
    'psql: error: connection to server failed',
  ]) {
    assert.equal(parsePreflightOutput(bad).ok, false, `passed: ${JSON.stringify(bad)}`)
  }
})

test('findings are parsed, and a short answer is not mistaken for a full one', () => {
  const r = parsePreflightOutput([
    'OFFENDER|function|public.evil()|public.evil()|directus_prod',
    'OFFENDER|trigger|trigger t on table public.members|public.evil()|directus_prod',
    'PREFLIGHT|2',
  ].join('\n'))
  assert.equal(r.ok, false)
  assert.equal(r.summary, 2)
  assert.deepEqual(r.offenders.map((o) => o.kind), ['function', 'trigger'])
  assert.equal(r.offenders[1].owner, 'directus_prod')
  // A truncated answer: the summary promises more than was listed.
  const short = parsePreflightOutput('OFFENDER|function|public.evil()|public.evil()|directus_prod\nPREFLIGHT|2')
  assert.equal(short.ok, false)
  assert.match(formatPreflightFailure(short), /Summary says 2 finding\(s\), 1 listed/)
  assert.match(formatPreflightFailure(parsePreflightOutput('')), /did not complete/)
})

test('the failure message names offenders, owners and the override, printable-only', () => {
  const msg = formatPreflightFailure(
    parsePreflightOutput('OFFENDER|function|public.ev\u001b[2Jil()|public.evil()|directus_prod\nPREFLIGHT|1'),
    { target: 'dev (db=directus_kscw_dev)', owners: ['supabase_admin'] })
  assert.match(msg, /FAILED on dev \(db=directus_kscw_dev\)/)
  assert.match(msg, /owner directus_prod/)
  assert.match(msg, new RegExp(`${ALLOWED_OWNERS_ENV}=`))
  assert.doesNotMatch(msg, /\u001b/)
})

test('runPreflight hands psql the built input and propagates a psql failure', () => {
  let seen = null
  const ok = runPreflight((input) => { seen = input; return 'PREFLIGHT|0' }, { sqlText: sql, owners: ['supabase_admin'] })
  assert.equal(ok.ok, true)
  assert.ok(seen.startsWith("\\set allowed_owners 'supabase_admin'\n"))
  assert.throws(() => runPreflight(() => { throw new Error('psql query failed: boom') }, { sqlText: sql, owners: ['supabase_admin'] }), /boom/)
})

// ── The SQL itself ───────────────────────────────────────────────────────────
test('the SQL pins its own output format and search_path, and is read-only', () => {
  for (const line of ['\\set ON_ERROR_STOP on', '\\set QUIET on', '\\pset tuples_only on', '\\pset format unaligned', 'SET search_path = pg_catalog;']) {
    assert.ok(sql.includes(`\n${line}\n`), `missing: ${line}`)
  }
  assert.match(sql, /string_to_array\(:'allowed_owners', ','\)/)
  assert.match(sql, /'PREFLIGHT\|' \|\| count\(\*\) FROM offenders/)
  assert.match(sql, /\[\[:cntrl:\]\|\]/, 'identifiers must be flattened before printing')
  for (const kind of ['trigger', 'rule', 'constraint', 'default', 'index', 'type', 'function', 'allowlist']) {
    assert.match(sql, new RegExp(`'${kind}'`), `kind ${kind} lost`)
  }
  assert.match(sql, /WHERE r\.rolsuper/, 'a non-superuser must never count as an allowed owner')
  assert.match(sql, /rolname IN \('directus_prod', 'directus_dev'\)/)
  const body = sql.replace(/--[^\n]*/g, '')
  assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|COPY|GRANT|DO)\b/i, 'the pre-flight must only read')
})

// ── Callers ──────────────────────────────────────────────────────────────────
test('apply-migrations runs the pre-flight before the tracker bootstrap, in every mode', () => {
  assert.match(runner, /from '\.\/preflight-no-foreign-functions\.mjs'/)
  const main = runner.slice(runner.indexOf('async function main()'))
  const pre = main.indexOf('preflight()')
  assert.ok(pre > 0, 'main() no longer calls preflight()')
  assert.ok(pre < main.indexOf('bootstrapTracker()'), 'preflight must precede the tracker INSERTs')
  assert.ok(pre < main.indexOf("flag === '--status'"), 'preflight must run for --status/--dry too')
  assert.match(runner, /process\.exit\(4\)/)
})

const at = (src, needle, from = 0) => {
  const i = src.indexOf(needle, from)
  assert.ok(i >= 0, `not found: ${needle}`)
  return i
}

test('nightly refresh: sources checked before they are read or dumped, clone before its first UPDATE', () => {
  assert.match(daily, /PREFLIGHT_SQL="\$SELF_DIR\/preflight-no-foreign-functions\.sql"/)
  assert.match(daily, /for f in "\$SELF_DIR" "\$SELF" "\$SCRUB_SQL" "\$ROLE_SQL" "\$PREFLIGHT_SQL"; do/, 'F72 ownership check must cover the pre-flight SQL')
  const zero = at(daily, 'for db in "$PROD_DB" "$DEV_DB"; do\n  if ! preflight "$db"; then')
  assert.ok(zero < at(daily, 'log "[1/7]'), '[0/7] must precede the first superuser read')
  assert.ok(zero < at(daily, 'pg_dump -U supabase_admin -d "$DEV_DB"'), '[0/7] must precede the safety dump')
  const prodAgain = at(daily, 'if ! preflight "$PROD_DB"; then', zero + 1)
  assert.ok(prodAgain < at(daily, 'pg_dump -U supabase_admin -d "$PROD_DB"'), 'prod re-check must precede the clone dump')
  const clone = at(daily, 'if ! preflight "$DEV_DB"; then', prodAgain)
  assert.ok(clone > at(daily, 'pg_dump -U supabase_admin -d "$PROD_DB"'))
  assert.ok(clone < at(daily, 'log "[5/7]'))
  assert.ok(clone < at(daily, 'log "[5b/7]'), 'the license UPDATE fires triggers too')
  assert.ok(clone < at(daily, 'if ! scrub; then'))
  const rb = daily.slice(at(daily, 'rollback(){'), at(daily, '\n}\n', at(daily, 'rollback(){')))
  assert.ok(rb.indexOf('preflight "$DEV_DB"') > 0 && rb.indexOf('preflight "$DEV_DB"') < rb.indexOf('if scrub; then'),
    'rollback must check the restored dump before scrubbing it')
})

test('manual refresh: same pre-flight, same placement', () => {
  assert.match(manual, /PREFLIGHT_FILE=directus\/scripts\/preflight-no-foreign-functions\.sql/)
  assert.match(manual, /\$ROLE_B64 \$PREFLIGHT_B64 \$PREFLIGHT_OWNERS" <<'REMOTE'/)
  const zero = at(manual, 'for db in "$PROD_DB" "$DEV_DB"; do\n  if ! preflight "$db"; then')
  assert.ok(zero < at(manual, 'echo "[1/7]'))
  assert.ok(zero < at(manual, 'pg_dump -U supabase_admin -d "$DEV_DB"'))
  const prodAgain = at(manual, 'if ! preflight "$PROD_DB"; then', zero + 1)
  assert.ok(prodAgain < at(manual, 'pg_dump -U supabase_admin -d "$PROD_DB"'))
  const clone = at(manual, 'if ! preflight "$DEV_DB"; then', prodAgain)
  assert.ok(clone < at(manual, 'echo "[5b/7]'))
  assert.ok(clone < at(manual, '-v scrub_pii="$DO_SCRUB"'))
})

test('JS, nightly and manual agree on the default owner and the all-clear line', () => {
  for (const [name, src] of [['daily', daily], ['manual', manual]]) {
    assert.ok(src.includes(`PREFLIGHT_OWNERS=\${KSCW_PREFLIGHT_ALLOWED_OWNERS:-${DEFAULT_ALLOWED_OWNERS.join(',')}}`), `${name}: default drifted`)
    assert.ok(src.includes(`[ "$rc" -eq 0 ] && [ "$out" = "${ALL_CLEAR}" ] && return 0`), `${name}: all-clear comparison drifted`)
  }
  assert.equal(PREFLIGHT_SQL_FILE, 'preflight-no-foreign-functions.sql')
})

// ── The bash judge, executed (fake `docker` on PATH) ─────────────────────────
const fnBody = (src) => src.slice(at(src, 'preflight(){'), at(src, '\n}\n', at(src, 'preflight(){')) + 3)

for (const [name, src] of [['daily', daily], ['manual', manual]]) {
  test(`${name}: bash preflight() passes only on the exact all-clear`, () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'kscw-preflight-'))
    try {
      const docker = resolve(dir, 'docker')
      // Prints $FAKE_OUT (stdin drained), exits $FAKE_RC — stands in for `docker exec … psql`.
      writeFileSync(docker, '#!/usr/bin/env bash\ncat >/dev/null\nprintf "%b" "$FAKE_OUT"\nexit "${FAKE_RC:-0}"\n')
      chmodSync(docker, 0o755)
      const sqlFile = resolve(dir, 'p.sql')
      writeFileSync(sqlFile, 'SELECT 1;\n')
      const script = `log(){ echo "$*"; }\nPGC=x\nPREFLIGHT_SQL='${sqlFile}'\nPREFLIGHT_OWNERS=supabase_admin\n${fnBody(src)}\npreflight somedb`
      const run = (out, rc = 0) => spawnSync('bash', ['-c', script], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_OUT: out, FAKE_RC: String(rc) }, encoding: 'utf-8',
      })
      assert.equal(run('PREFLIGHT|0').status, 0)
      assert.equal(run('PREFLIGHT|0\\n').status, 0, 'trailing newline is stripped by $(…)')
      for (const [out, rc] of [
        ['OFFENDER|function|public.evil()|public.evil()|directus_prod\\nPREFLIGHT|1', 0],
        ['PREFLIGHT|0', 3],                         // the right text from a psql that failed
        ['', 0],
        ['SET\\nPREFLIGHT|0', 0],
        ['psql: error: connection refused', 2],
        ['PREFLIGHT|0\\nPREFLIGHT|0', 0],
      ]) {
        assert.equal(run(out, rc).status, 1, `${name}: passed on ${JSON.stringify(out)} rc=${rc}`)
      }
      const shown = run('OFFENDER|function|public.e\\033[2Jvil()|public.evil()|directus_prod\\nPREFLIGHT|1')
      assert.match(shown.stdout, /PRE-FLIGHT FAILED on somedb/)
      assert.doesNotMatch(shown.stdout, /\u001b/, 'control characters must not reach the log')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

test('the owner-list validation in bash matches the JS one', () => {
  const m = daily.match(/if ! \[\[ "\$PREFLIGHT_OWNERS" =~ (\S+) \]\] \\\n\s+\|\| \[\[ ",\$PREFLIGHT_OWNERS," =~ (\S+) \]\]; then/)
  assert.ok(m, 'validation block not found in refresh-dev-daily.sh')
  assert.ok(manual.includes(`[[ "$PREFLIGHT_OWNERS" =~ ${m[1]} ]]`), 'manual script validates differently')
  const bashOk = (v) => spawnSync('bash', ['-c', `[[ "$1" =~ ${m[1]} ]] && ! [[ ",$1," =~ ${m[2]} ]]`, '_', v]).status === 0
  for (const v of ['supabase_admin', 'supabase_admin,postgres']) {
    assert.equal(bashOk(v), true, v)
    assert.doesNotThrow(() => resolveAllowedOwners(v))
  }
  for (const v of ['', 'a b', 'a;b', 'Supabase', 'supabase_admin,directus_prod', 'directus_dev', 'a,,b', "a'"]) {
    assert.equal(bashOk(v), false, `bash accepted ${JSON.stringify(v)}`)
  }
})

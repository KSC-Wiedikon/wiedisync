#!/usr/bin/env node
/**
 * apply-migrations.mjs — KSCW migration runner.
 *
 * Usage:
 *   node directus/scripts/apply-migrations.mjs <env>          # apply pending
 *   node directus/scripts/apply-migrations.mjs <env> --status # list state
 *   node directus/scripts/apply-migrations.mjs <env> --dry    # show plan
 *
 *   <env> ∈ { dev, prod }
 *
 * What it does:
 *   0. Pre-flight (preflight-no-foreign-functions.sql): refuses to run — in
 *      every mode, before the tracker INSERT — when `public` holds a function
 *      owned by anyone but the allowed superuser(s), or a trigger / rule /
 *      CHECK / DEFAULT / index that calls one. Everything below runs as the
 *      cluster superuser, so such a function would too (security review
 *      2026-10-11, H5). Allowed owners: KSCW_PREFLIGHT_ALLOWED_OWNERS
 *      (comma-separated), default `supabase_admin`. Exit code 4.
 *   1. Ensures kscw_migrations tracker table exists (bootstrap from
 *      _migrations-tracker.sql).
 *   2. Lists numbered migrations on disk (`0NN-*.sql`).
 *   3. Diffs against tracker rows. Errors if any applied row's stored
 *      sha differs from the on-disk sha (someone edited a migration
 *      after it was applied).
 *   4. Applies pending migrations in numeric order via psql in the
 *      kscw-postgres container on the VPS (`ssh kscw-server`).
 *   5. Records each successful apply in kscw_migrations.
 *
 * No npm dependencies — uses only `child_process`, `fs`, `crypto`.
 */

import { execSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'
import {
  ALLOWED_OWNERS_ENV, formatPreflightFailure, readPreflightSql, resolveAllowedOwners, runPreflight,
} from './preflight-no-foreign-functions.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = __dirname

// ── Env resolution ────────────────────────────────────────────────
const ENVS = {
  dev: {
    container: 'kscw-postgres',
    database: 'directus_kscw_dev',
    user: 'supabase_admin',
  },
  prod: {
    container: 'kscw-postgres',
    database: 'postgres',
    user: 'supabase_admin',
  },
}

// Each env's Directus login role (F29, see directus-db-role.sql).
const DIRECTUS_ROLE = { dev: 'directus_dev', prod: 'directus_prod' }

const args = process.argv.slice(2)
const envName = args[0]
const flag = args[1] || ''
if (!envName || !ENVS[envName]) {
  console.error(`Usage: ${basename(import.meta.url)} <dev|prod> [--status|--dry]`)
  process.exit(1)
}
const env = ENVS[envName]

// ── psql wrappers (via SSH to kscw-server) ────────────────────────
// SQL goes via stdin, never via `-c`. SSH joins args into a remote shell
// string so a multi-word SQL string passed as `-c` gets shell-split.
// Default unaligned separator is `|` — filenames + hex shas never contain it.
function psqlQuery(sql) {
  const cmd = ['ssh', 'kscw-server', 'sudo', 'docker', 'exec', '-i', env.container,
    'psql', '-U', env.user, '-d', env.database,
    '-t', '-A', '-X', '-v', 'ON_ERROR_STOP=1']
  const r = spawnSync(cmd[0], cmd.slice(1), { input: sql, encoding: 'utf-8' })
  if (r.status !== 0) {
    throw new Error(`psql query failed: ${r.stderr.trim() || r.stdout.trim()}`)
  }
  return r.stdout.trim()
}

function psqlApply(sqlText, label) {
  // No `-1` — every migration files its own BEGIN/COMMIT; `-1` would add an
  // outer transaction and warn ("transaction already in progress") when the
  // file's BEGIN runs. Tracker INSERTs (small one-shot statements) get
  // wrapped in a single statement so they don't need outer-tx semantics.
  const cmd = ['ssh', 'kscw-server', 'sudo', 'docker', 'exec', '-i', env.container,
    'psql', '-U', env.user, '-d', env.database,
    '-X', '-v', 'ON_ERROR_STOP=1']
  const r = spawnSync(cmd[0], cmd.slice(1), { input: sqlText, encoding: 'utf-8' })
  if (r.status !== 0) {
    throw new Error(`Apply ${label} failed:\n${r.stderr || r.stdout}`)
  }
  return r.stdout
}

// ── Discover migrations on disk ───────────────────────────────────
function discoverMigrations() {
  const files = readdirSync(SCRIPTS_DIR)
    .filter(f => /^\d{3}-.+\.sql$/.test(f) || /^\d{3}-.+\.mjs$/.test(f))
    .sort()
  return files.map(name => {
    const full = join(SCRIPTS_DIR, name)
    const content = readFileSync(full, 'utf-8')
    const sha = createHash('sha256').update(content).digest('hex')
    return { name, full, sha, content, isMjs: name.endsWith('.mjs') }
  })
}

// ── Pre-flight: no function a non-superuser could have written ────
// Runs BEFORE the first statement that can fire anything (the tracker
// bootstrap INSERTs). Fail-closed: findings, a psql error or an incomplete
// answer all stop the run. Exit 4.
function preflight() {
  let owners
  try {
    owners = resolveAllowedOwners()
  } catch (err) {
    console.error(`[migrate] ✗ ${err.message}`)
    process.exit(4)
  }
  let result
  try {
    result = runPreflight(psqlQuery, { sqlText: readPreflightSql(SCRIPTS_DIR), owners })
  } catch (err) {
    console.error(`[migrate] ✗ pre-flight could not run — refusing to continue (fail-closed):\n${err.message}`)
    process.exit(4)
  }
  if (!result.ok) {
    console.error(`[migrate] ✗ ${formatPreflightFailure(result, { target: `${envName} (db=${env.database})`, owners })}`)
    process.exit(4)
  }
  console.log(`[migrate] ✓ Pre-flight: no function in public, or called from it, owned outside ${owners.join(', ')}${process.env[ALLOWED_OWNERS_ENV] ? ` (${ALLOWED_OWNERS_ENV})` : ''}`)
}

// ── Bootstrap tracker table ───────────────────────────────────────
function bootstrapTracker() {
  const trackerSql = readFileSync(join(SCRIPTS_DIR, '_migrations-tracker.sql'), 'utf-8')
  console.log(`[migrate] Ensuring kscw_migrations tracker table…`)
  psqlApply(trackerSql, '_migrations-tracker.sql')
}

// ── Compare disk vs tracker ───────────────────────────────────────
function getApplied() {
  const out = psqlQuery('SELECT filename, sha256 FROM kscw_migrations ORDER BY filename;')
  if (!out) return new Map()
  return new Map(out.split('\n').map(line => {
    const idx = line.indexOf('|')
    return idx === -1 ? [line, ''] : [line.slice(0, idx), line.slice(idx + 1)]
  }))
}

// ── Main flow ─────────────────────────────────────────────────────
async function main() {
  console.log(`[migrate] Target: ${envName} (db=${env.database})\n`)

  preflight()
  bootstrapTracker()
  const applied = getApplied()
  const onDisk = discoverMigrations()

  // Detect tampering: same filename, different sha (and not a placeholder).
  const tampered = []
  for (const m of onDisk) {
    const recordedSha = applied.get(m.name)
    if (recordedSha && recordedSha !== 'unknown' && recordedSha !== m.sha) {
      tampered.push({ name: m.name, recorded: recordedSha, current: m.sha })
    }
  }
  if (tampered.length) {
    console.error(`[migrate] ❌ Tamper detected — these migrations were edited after being applied:`)
    for (const t of tampered) {
      console.error(`    ${t.name}\n      recorded: ${t.recorded}\n      on-disk:  ${t.current}`)
    }
    console.error(`\nIf the change is intentional, write a new numbered migration that fixes the issue forward, OR (rarely) DELETE the tracker row for that filename to allow re-apply.`)
    process.exit(2)
  }

  const pending = onDisk.filter(m => !applied.has(m.name))

  if (flag === '--status') {
    console.log(`[migrate] Applied: ${applied.size}, pending: ${pending.length}`)
    if (pending.length) {
      console.log(`\nPending:`)
      for (const m of pending) console.log(`  ${m.name}`)
    } else {
      console.log(`  ✓ Up to date`)
    }
    return
  }

  if (!pending.length) {
    console.log(`[migrate] ✓ Up to date — ${applied.size} migrations applied.`)
    return
  }

  if (flag === '--dry') {
    console.log(`[migrate] ${pending.length} migration(s) would be applied:`)
    for (const m of pending) console.log(`  → ${m.name}  (sha ${m.sha.slice(0, 12)})`)
    return
  }

  console.log(`[migrate] Applying ${pending.length} migration(s)…\n`)
  let applied_n = 0
  for (const m of pending) {
    if (m.isMjs) {
      console.log(`[migrate] ⚠ Skipping ${m.name} — .mjs migrations must be run manually (see file header).`)
      continue
    }
    process.stdout.write(`[migrate] → ${m.name} … `)
    try {
      psqlApply(m.content, m.name)
      // Record in tracker
      const recordSql = `INSERT INTO kscw_migrations(filename, sha256) VALUES ('${m.name}', '${m.sha}') ON CONFLICT (filename) DO UPDATE SET sha256 = EXCLUDED.sha256, applied_at = now();`
      psqlApply(recordSql, `tracker:${m.name}`)
      console.log('✓')
      applied_n++
    } catch (err) {
      console.log('✗')
      console.error(`[migrate] Failed at ${m.name}:\n${err.message}`)
      process.exit(3)
    }
  }
  console.log(`\n[migrate] ✓ Applied ${applied_n} new migration(s).`)
  // Migrations run as supabase_admin, so anything they create is owned by it.
  // Hand it to this env's Directus login role (F29): Directus must own a table
  // to alter it, and a non-owner reads ZERO rows from the RLS-enabled tables.
  // A no-op (NOTICE) until the role exists.
  if (applied_n) {
    const roleSql = readFileSync(join(SCRIPTS_DIR, 'directus-db-role.sql'), 'utf-8')
    psqlApply(`\\set role ${DIRECTUS_ROLE[envName]}\n${roleSql}`, 'directus-db-role.sql')
    console.log(`[migrate] ✓ public schema owned by ${DIRECTUS_ROLE[envName]}`)
  }
  console.log(`[migrate] Reminder: permissions are NOT in migrations — run \`npm run db:setup-perms:${envName}\` afterwards if any permissions changed.`)
}

main().catch(err => {
  console.error(`[migrate] ✗ ${err.message}`)
  process.exit(1)
})

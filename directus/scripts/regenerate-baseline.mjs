#!/usr/bin/env node
/**
 * regenerate-baseline.mjs — Pulls the current Postgres schema (DDL only,
 * no data) from the target Directus DB and writes it to
 * `directus/scripts/SCHEMA.sql`.
 *
 * SCHEMA.sql is the "fresh install" snapshot:
 *   - Tables, columns, constraints, indexes
 *   - Triggers + functions
 *   - Foreign keys
 *   - Sequences
 *   - View definitions
 *   - Grants (Postgres roles, NOT Directus permissions — those live in
 *     setup-permissions.mjs)
 *
 * It does NOT include:
 *   - Data backfills / one-time migrations (those stay in `0NN-*.sql`
 *     and are recorded as applied in kscw_migrations).
 *   - Directus permission rows (live in setup-permissions.mjs).
 *
 * Usage:
 *   npm run db:baseline:dev   # regenerate from dev DB
 *   npm run db:baseline:prod  # regenerate from prod DB (canonical)
 *
 * After regenerating, commit SCHEMA.sql. Reviewers diff it as the
 * authoritative schema state.
 *
 * Fresh-install workflow uses SCHEMA.sql + setup-permissions.mjs only:
 *   1. Run `psql ... < SCHEMA.sql`
 *   2. Insert tracker rows for every migration filename (so the runner
 *      considers them applied).
 *   3. Run setup-permissions.mjs.
 *   4. Apply any migrations newer than the baseline via apply-migrations.mjs.
 */

import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'SCHEMA.sql')

const ENVS = {
  dev: { container: 'kscw-postgres', database: 'directus_kscw_dev' },
  prod: { container: 'kscw-postgres', database: 'postgres' },
}

const envName = process.argv[2]
if (!envName || !ENVS[envName]) {
  console.error(`Usage: regenerate-baseline.mjs <dev|prod>`)
  process.exit(1)
}
const env = ENVS[envName]

console.log(`[baseline] Pulling schema from ${envName} (db=${env.database})…`)

// pg_dump --schema-only --no-owner --no-acl  schema-only, no role/grant noise.
// We exclude `directus_*` tables — Directus rebuilds those from its own
// migrations on first boot, so committing them would create false diffs.
const cmd = ['ssh', 'hetzner', 'sudo', 'docker', 'exec', '-i', env.container,
  'pg_dump',
  '-U', 'supabase_admin',
  '-d', env.database,
  '--schema-only',
  '--no-owner',
  '--no-acl',
  '--exclude-table=directus_*',
  '--exclude-schema=auth',
  '--exclude-schema=storage',
  '--exclude-schema=realtime',
  '--exclude-schema=supabase_*',
  '--exclude-schema=pgsodium*',
  '--exclude-schema=vault',
]

const r = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
if (r.status !== 0) {
  console.error(`[baseline] pg_dump failed:\n${r.stderr}`)
  process.exit(2)
}

const generatedAt = new Date().toISOString()
const banner = `-- ============================================================================
-- KSCW SCHEMA baseline — GENERATED, DO NOT EDIT BY HAND
-- ============================================================================
--
-- Generated:   ${generatedAt}
-- Source:      ${envName} (db=${env.database})
-- Generator:   directus/scripts/regenerate-baseline.mjs
--
-- This is the consolidated DDL/triggers/FKs/grants snapshot for a FRESH
-- install. Re-running it on an existing DB is unsafe — apply only on a
-- clean Postgres database, then run setup-permissions.mjs and any post-
-- baseline migrations via apply-migrations.mjs.
--
-- DO NOT EDIT MANUALLY — regenerate via:
--   npm run db:baseline:prod
-- after applying schema migrations on prod.
--
-- Permissions are NOT in this file. They live in setup-permissions.mjs
-- (canonical declarative source). Run after applying SCHEMA.sql.
-- ============================================================================

`

writeFileSync(OUT, banner + r.stdout)
console.log(`[baseline] ✓ Wrote ${OUT} (${(r.stdout.length / 1024).toFixed(1)} KB)`)
console.log(`[baseline] Diff against committed version, then commit if intended.`)

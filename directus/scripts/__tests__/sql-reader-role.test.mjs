// SQL workspace reader role (migration 404 + directus-db-role.sql), audit
// 2026-10-11 H4b. Read mode runs as kscw_sql_reader, so what it may read is
// decided by these grants. Static checks only — the grants were exercised on a
// scratch Postgres 16 when written; this keeps the deny lists from silently
// shrinking and the role from silently gaining power.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const migration = readFileSync(resolve(HERE, '..', '404-sql-workspace-reader-role.sql'), 'utf-8')
const roleFile = readFileSync(resolve(HERE, '..', 'directus-db-role.sql'), 'utf-8')

/** Strip `-- …` comments so assertions only see SQL. */
const code = (sql) => sql.replace(/--[^\n]*/g, '')

function grantBlock(sql) {
  const start = sql.indexOf('DO $grant$')
  const end = sql.indexOf('END $grant$;', start)
  assert.ok(start >= 0 && end > start, 'reader grant block (DO $grant$ … END $grant$;) missing')
  return sql.slice(start, end)
}

function arrayItems(block, name) {
  const m = new RegExp(`${name} constant text\\[\\] := ARRAY\\[([\\s\\S]*?)\\];`).exec(block)
  assert.ok(m, `${name} missing`)
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

function denyRegex(block) {
  const m = /deny_name_re constant text :=\s*'([^']+)';/.exec(block)
  assert.ok(m, 'deny_name_re missing')
  // A Postgres ARE used with ~* — this pattern is plain enough to be a JS RegExp too.
  return new RegExp(m[1], 'i')
}

for (const [label, sql] of [['migration 404', migration], ['directus-db-role.sql', roleFile]]) {
  test(`${label}: credential tables get no SELECT at all`, () => {
    const tables = arrayItems(grantBlock(sql), 'deny_tables')
    for (const t of ['directus_sessions', 'directus_shares', 'password_reset_tokens', 'email_verifications',
      'identity_documents', 'identity_document_keys', 'game_vm_sheets']) {
      assert.ok(tables.includes(t), `${t} must be in deny_tables`)
    }
  })

  test(`${label}: credential columns are excluded by name or listed`, () => {
    const block = grantBlock(sql)
    const re = denyRegex(block)
    const listed = arrayItems(block, 'deny_columns')
    const denied = (table, col) => re.test(col) || listed.includes(`${table}.${col}`)
    for (const [t, c] of [
      ['directus_users', 'password'], ['directus_users', 'token'], ['directus_users', 'tfa_secret'],
      ['directus_users', 'auth_data'], ['members', 'e2ee_private_key'], ['members', 'e2ee_kdf_salt'],
      ['members', 'ical_token'], ['email_accounts', 'password_enc'], ['signup_tokens', 'token_hash'],
      ['directus_settings', 'ai_anthropic_api_key'], ['directus_settings', 'mapbox_key'],
      ['push_subscriptions', 'keys_auth'], ['newsletter_subscribers', 'unsubscribe_token'],
    ]) {
      assert.ok(denied(t, c), `${t}.${c} must be denied`)
    }
    // …without swallowing ordinary columns the workspace exists to read.
    for (const [t, c] of [
      ['members', 'email'], ['members', 'first_name'], ['members', 'e2ee_public_key'], ['members', 'role'],
      ['bugfix_jobs', 'error_hash'], ['events', 'public_share_token'], ['email_sends', 'template_key'],
      ['directus_users', 'last_access'], ['live_match_logs', 'match_key'],
    ]) {
      assert.ok(!denied(t, c), `${t}.${c} should stay readable`)
    }
  })

  test(`${label}: grants are revoke-then-grant, SELECT/USAGE/EXECUTE only`, () => {
    const block = code(grantBlock(sql))
    const revoke = block.indexOf('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM kscw_sql_reader')
    assert.ok(revoke > 0 && revoke < block.indexOf('GRANT SELECT ON TABLE'), 'must revoke before granting')
    const grants = [...block.matchAll(/GRANT ([A-Z ,]+?) (?:\(|ON )/g)]
    assert.ok(grants.length >= 5, 'grant statements not found')
    for (const m of grants) {
      assert.match(m[1].trim(), /^(SELECT|USAGE|EXECUTE)$/, `unexpected privilege: ${m[1]}`)
    }
    assert.match(block, /IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'kscw_sql_reader'\)/)
  })
}

test('migration 404 creates a NOLOGIN, SELECT-only role that login roles can only SET ROLE into', () => {
  const sql = code(migration)
  assert.match(sql, /^BEGIN;$/m)
  assert.match(sql, /^COMMIT;$/m)
  assert.match(sql, /SET LOCAL search_path = pg_catalog;/)
  assert.match(sql, /IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'kscw_sql_reader'\) THEN\s+CREATE ROLE kscw_sql_reader NOLOGIN;/)
  assert.match(sql, /ALTER ROLE kscw_sql_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;/)
  assert.match(sql, /IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = r\) THEN\s+EXECUTE format\('GRANT kscw_sql_reader TO %I WITH INHERIT FALSE, SET TRUE', r\);/)
  assert.doesNotMatch(sql, /directus_permissions|directus_policies|directus_access/, 'migrations never write permission rows')
})

test('directus-db-role.sql resolves nothing through public and grants membership without inherit', () => {
  const sql = code(roleFile)
  const setPath = sql.indexOf('SET search_path = pg_catalog;')
  assert.ok(setPath >= 0 && setPath < sql.indexOf('DO $$'), 'search_path must be pinned before the first DO block')
  assert.match(sql, /GRANT kscw_sql_reader TO %I WITH INHERIT FALSE, SET TRUE/)
  assert.ok(sql.indexOf('DO $grant$') > sql.indexOf('END $$;'), 'reader grants run after the ownership hand-over')
})

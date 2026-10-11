/**
 * Unit tests for the SQL workspace's statement policy (checkStatementPolicy) —
 * the refusals that apply in BOTH modes (2026-10-11 audit, H4a/H5):
 *   - session state that would outlive the request on the pooled connection
 *     (SET/RESET/…, transaction control, temp tables, set_config, advisory
 *     locks, pg_settings updates) — a committed `set_config('kscw.publish_file',
 *     'on', false)` used to switch a DB guard off for every later request;
 *   - functions that reach outside the database or run SQL given as text;
 *   - code, privileges and ownership (functions, triggers, rules, DO, roles,
 *     GRANT/REVOKE, OWNER TO), which would later run in superuser tooling.
 * Every family is checked plain, mixed-case, quoted, schema-qualified and with
 * comments in the way — and the same words inside string literals and comments
 * must NOT be refused. Hermetic, no DB.
 */
import { describe, it, expect } from 'vitest'
import { checkStatementPolicy, lexSql } from '../sql-workspace.js'

const code = (sql) => checkStatementPolicy(sql)?.code ?? null

describe('lexSql', () => {
  it('round-trips the input exactly', () => {
    const sql = `SELECT E'a\\'b', 'c''d', "q""i", $t$ x; $t$ /* /* n */ */ -- tail\n; U&"x" a$b $1`
    expect(lexSql(sql).map((t) => t.text).join('')).toBe(sql)
  })

  it('keeps literals, identifiers and comments as single tokens', () => {
    const types = lexSql(`set_config('x' /* y */ "z" -- w\n$$v$$`)
      .filter((t) => t.type !== 'ws').map((t) => t.type)
    expect(types).toEqual(['word', 'other', 'string', 'comment', 'qident', 'comment', 'string'])
  })
})

describe('checkStatementPolicy — session statements (both modes)', () => {
  it.each([
    'SET kscw.publish_file = on',
    "set local statement_timeout = 0",
    'SET ROLE directus_prod',
    'SET SESSION AUTHORIZATION DEFAULT',
    'Set search_path = evil, public',
    'SET TRANSACTION READ WRITE',
    'RESET ALL',
    'reset role',
    'DISCARD ALL',
    'LISTEN chan',
    "NOTIFY chan, 'x'",
    'UNLISTEN *',
    "LOAD 'auto_explain'",
    'COPY members TO STDOUT',
    'BEGIN', 'COMMIT', 'ROLLBACK', 'START TRANSACTION', 'END', 'ABORT',
    'SAVEPOINT a', 'RELEASE SAVEPOINT a',
    "PREPARE TRANSACTION 'x'",
    'PREPARE p AS SELECT 1',
    'EXECUTE p',
    'DEALLOCATE ALL',
    '/* note */ SET kscw.allow_junction_repoint = on',
    '-- why\nset kscw.signup_slug_write = on',
    'DECLARE c CURSOR WITH HOLD FOR SELECT 1',
  ])('refuses %s', (sql) => {
    expect(code(sql)).toBe('statement_not_allowed')
  })

  it('refuses ALTER SYSTEM', () => {
    expect(code('ALTER SYSTEM SET work_mem = 1')).toBe('ddl_not_allowed')
  })

  it('allows SET CONSTRAINTS (transaction-scoped) and a plain cursor', () => {
    expect(code('SET CONSTRAINTS ALL DEFERRED')).toBeNull()
    expect(code('DECLARE c CURSOR FOR SELECT 1')).toBeNull()
  })
})

describe('checkStatementPolicy — functions (both modes)', () => {
  it.each([
    "SELECT set_config('kscw.publish_file', 'on', false)",
    "SELECT pg_catalog.set_config('kscw.publish_file', 'on', false)",
    `SELECT "pg_catalog"."set_config"('kscw.publish_file', 'on', false)`,
    "SELECT Set_Config('role', 'directus_prod', false)",
    `SELECT "SET_CONFIG"('a', 'b', false)`,
    "SELECT set_config /* hide */ ('a', 'b', false)",
    "SELECT pg_catalog . set_config('a', 'b', true)",
    'SELECT * FROM members WHERE set_config(\'a\', \'b\', false) IS NOT NULL',
    'SELECT pg_advisory_lock(1)',
    'SELECT PG_TRY_ADVISORY_LOCK(1)',
    'SELECT pg_advisory_xact_lock(1)',
    'SELECT pg_catalog.pg_advisory_unlock_all()',
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity',
    'SELECT pg_cancel_backend(1)',
    'SELECT pg_reload_conf()',
    'SELECT pg_rotate_logfile()',
    "SELECT query_to_xml('select password from directus_users', true, false, '')",
    "SELECT pg_catalog.query_to_xmlschema('select 1', true, false, '')",
    "SELECT query_to_xml_and_xmlschema('select 1', true, false, '')",
    "SELECT table_to_xml('directus_users', true, false, '')",
    "SELECT cursor_to_xml('c', 1, true, false, '')",
    "SELECT database_to_xml(true, false, '')",
    "SELECT ts_stat('select 1')",
    "SELECT ts_rewrite('a'::tsquery, 'select 1')",
    "SELECT dblink('dbname=postgres', 'select 1')",
    "SELECT public.dblink_exec('x')",
    "SELECT lo_import('/etc/passwd')",
    'SELECT lo_export(1, \'/tmp/x\')',
    'SELECT loread(0, 1)',
    "SELECT pg_read_file('/etc/passwd')",
    "SELECT pg_read_binary_file('x')",
    "SELECT pg_ls_dir('.')",
    'SELECT * FROM pg_ls_waldir()',
    "SELECT pg_stat_file('x')",
    "SELECT pg_file_write('x', 'y', false)",
    "SELECT pg_notify('chan', 'x')",
    "SELECT pg_create_restore_point('x')",
    "SELECT pg_logical_emit_message(false, 'x', 'y')",
    'SELECT pg_switch_wal()',
    'SELECT pg_stat_reset()',
    // Inside DDL a write-mode run would commit — a DEFAULT runs as whoever inserts.
    "CREATE TABLE t (a text DEFAULT pg_catalog.set_config('kscw.publish_file', 'on', false))",
  ])('refuses %s', (sql) => {
    expect(code(sql)).toBe('function_not_allowed')
  })

  it('names the function in the message', () => {
    expect(checkStatementPolicy('SELECT pg_catalog.set_config(1,2,3)').message).toMatch(/"set_config"/)
  })
})

describe('checkStatementPolicy — escapes that are not function calls', () => {
  it('refuses Unicode-escaped identifiers outright', () => {
    expect(code(`SELECT U&"set\\005fconfig"('a', 'b', false)`)).toBe('statement_not_allowed')
    expect(code('select u&"x" from t')).toBe('statement_not_allowed')
    expect(code('SELECT * FROM U&"\\0064irectus_users"')).toBe('statement_not_allowed')
  })

  it('refuses updating pg_settings (SET by another name)', () => {
    expect(code("UPDATE pg_settings SET setting = 'on' WHERE name = 'kscw.publish_file'")).toBe('statement_not_allowed')
    expect(code("EXPLAIN ANALYZE UPDATE pg_catalog.pg_settings SET setting = 'directus_prod' WHERE name = 'role'"))
      .toBe('statement_not_allowed')
    expect(code(`UPDATE "pg_settings" SET setting = 'x' WHERE name = 'y'`)).toBe('statement_not_allowed')
  })

  it('refuses temporary objects, which outlive a commit and shadow public tables', () => {
    for (const sql of [
      'CREATE TEMP TABLE members AS SELECT 1 AS id',
      'CREATE TEMPORARY TABLE x (a int)',
      'CREATE LOCAL TEMP TABLE x (a int)',
      'CREATE GLOBAL TEMPORARY TABLE x (a int)',
      'create or replace temp view v as select 1',
      'SELECT * INTO TEMP t FROM members',
      'SELECT id INTO TEMPORARY TABLE t FROM members',
      'CREATE TABLE pg_temp.members (id int)',
    ]) {
      expect(code(sql), sql).toBe('statement_not_allowed')
    }
  })
})

describe('checkStatementPolicy — code, privileges, ownership (write-mode DDL)', () => {
  it.each([
    'CREATE FUNCTION f() RETURNS int AS $$ select 1 $$ LANGUAGE sql',
    'create or replace function public.f() returns trigger as $$ begin return new; end $$ language plpgsql',
    'CREATE PROCEDURE p() LANGUAGE sql AS $$ select 1 $$',
    'CREATE TRIGGER t AFTER INSERT ON members FOR EACH ROW EXECUTE FUNCTION f()',
    'CREATE CONSTRAINT TRIGGER t AFTER INSERT ON members FOR EACH ROW EXECUTE FUNCTION f()',
    'CREATE OR REPLACE TRIGGER t BEFORE UPDATE ON members FOR EACH ROW EXECUTE FUNCTION f()',
    'CREATE EVENT TRIGGER e ON ddl_command_start EXECUTE FUNCTION f()',
    'CREATE RULE r AS ON INSERT TO events DO INSTEAD NOTHING',
    'CREATE AGGREGATE a (int) (sfunc = int4pl, stype = int)',
    'CREATE OPERATOR === (leftarg = int, rightarg = int, function = int4eq)',
    'CREATE CAST (text AS int) WITH FUNCTION f(text)',
    'CREATE OR REPLACE TRUSTED PROCEDURAL LANGUAGE plx',
    'CREATE EXTENSION postgres_fdw',
    'ALTER EXTENSION pgcrypto UPDATE',
    'ALTER FUNCTION f() SECURITY DEFINER',
    'ALTER ROUTINE f() OWNER TO directus_dev',
    'DROP FUNCTION IF EXISTS f()',
    'DROP TRIGGER guard ON members',
    'DROP RULE r ON events',
    'DO $$ BEGIN PERFORM 1; END $$',
    'ALTER TABLE members OWNER TO directus_dev',
    'GRANT SELECT ON members TO PUBLIC',
    'REVOKE ALL ON members FROM PUBLIC',
    'CREATE ROLE x LOGIN',
    'ALTER ROLE directus_prod SUPERUSER',
    'CREATE USER x',
    'DROP ROLE x',
    "ALTER DATABASE postgres SET kscw.publish_file = 'on'",
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC',
    'REASSIGN OWNED BY directus_prod TO postgres',
    'DROP OWNED BY directus_dev',
    'CREATE POLICY p ON members USING (true)',
    'ALTER TABLE members DISABLE TRIGGER ALL',
    'ALTER TABLE members ENABLE REPLICA TRIGGER guard',
    'ALTER TABLE events DISABLE RULE r',
    'CREATE SCHEMA s CREATE TABLE t (a int) CREATE TRIGGER x AFTER INSERT ON t EXECUTE FUNCTION f()',
    'CREATE SCHEMA s AUTHORIZATION directus_dev',
    "CREATE SERVER s FOREIGN DATA WRAPPER postgres_fdw",
    'IMPORT FOREIGN SCHEMA public FROM SERVER s INTO x',
    'ALTER LARGE OBJECT 1 OWNER TO x',
    'CREATE PUBLICATION p FOR ALL TABLES',
  ])('refuses %s', (sql) => {
    expect(code(sql)).toBe('ddl_not_allowed')
  })

  it('points at the migration process', () => {
    expect(checkStatementPolicy('CREATE FUNCTION f() RETURNS int AS $$ select 1 $$ LANGUAGE sql').hint).toMatch(/migration/)
  })
})

describe('checkStatementPolicy — allowed', () => {
  it.each([
    'SELECT 1',
    'WITH x AS (SELECT 1) SELECT * FROM x',
    'SHOW search_path',
    "SELECT current_setting('kscw.publish_file', true)",
    "SELECT name, setting FROM pg_settings WHERE name = 'role'",
    "SELECT name FROM pg_settings WHERE context = 'update'",
    "SELECT id AS temp FROM members",
    // The same words inside literals and comments are data, not code.
    "SELECT 'set_config(''kscw.publish_file'', ''on'', false)'",
    'SELECT $$pg_advisory_lock(1); SET ROLE x$$',
    "SELECT E'query_to_xml(\\'x\\')' AS s",
    '/* pg_terminate_backend(1) */ SELECT 1',
    "SELECT 1 -- set_config('a','b',false); CREATE FUNCTION",
    "SELECT * FROM events WHERE title ILIKE '%GRANT ALL / DROP TRIGGER / U&\"x\"%'",
    "SELECT U&'\\0041' AS a",
    // Data fixes write mode exists for.
    "UPDATE members SET first_name = 'Anna' WHERE id = 1",
    "INSERT INTO events (title) VALUES ('Trigger function test') ON CONFLICT DO NOTHING",
    'DELETE FROM events WHERE id = 1',
    'CREATE TABLE fix_2026_10 (id int)',
    'CREATE UNIQUE INDEX ON members (email)',
    'ALTER TABLE members ADD COLUMN nickname2 text',
    'ALTER TABLE members ALTER COLUMN nickname2 DROP DEFAULT',
    'ALTER TABLE members DROP CONSTRAINT IF EXISTS members_x',
    'ALTER TABLE members ENABLE ROW LEVEL SECURITY',
    'CREATE VIEW v AS SELECT id FROM members',
    'DROP TABLE fix_2026_10',
    'TRUNCATE fix_2026_10',
    "COMMENT ON TABLE members IS 'grant execute on function f; set role x'",
    "UPDATE events SET title = 'CREATE FUNCTION x' WHERE id = 1",
    'CALL refresh_participation_visibility()',
  ])('allows %s', (sql) => {
    expect(checkStatementPolicy(sql)).toBeNull()
  })
})

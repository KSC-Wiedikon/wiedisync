/**
 * POST /admin/sql and GET /admin/sql/schema against a fake knex — the
 * transaction lifecycle the 2026-10-11 audit (H4a/H4b) is about:
 *   - read mode opens an explicit transaction, issues statement_timeout →
 *     READ ONLY → SET LOCAL ROLE kscw_sql_reader, and ROLLS BACK — on success
 *     too, never commit (knex commits a handler-style transaction when the
 *     handler resolves, which is how a session-level set_config survived);
 *   - write mode keeps the committing handler transaction and never switches
 *     to the reader role;
 *   - the reader's "permission denied" maps to credential_column_denied, a
 *     missing role to 503;
 *   - refused statements never reach the database, in either mode;
 *   - the schema model is read as the reader role and fails closed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../error-log.js', () => ({ writeErrorLog: vi.fn() }))
vi.mock('../activity-log.js', () => ({ writeUserLog: vi.fn(async () => {}) }))

const { registerSqlWorkspace } = await import('../sql-workspace.js')

const PIN = '424242'

/** knex stand-in: `transaction()` without a handler returns the trx (never
 *  commits by itself); with a handler it commits on resolve, rolls back on
 *  throw — knex's own semantics. */
function fakeDb({ fail = null } = {}) {
  const calls = []
  const state = { committed: 0, rolledBack: 0, handlerForm: 0, explicitForm: 0 }
  const trx = {
    raw: vi.fn(async (sql) => {
      calls.push(sql)
      if (fail) {
        const hit = fail(sql)
        if (hit) throw hit
      }
      if (/^SET LOCAL/.test(sql)) return {}
      if (/information_schema\.columns/.test(sql)) {
        return {
          rows: [
            { table_name: 'members', column_name: 'id', data_type: 'integer', is_nullable: 'NO', full_select: false },
            { table_name: 'teams', column_name: 'id', data_type: 'integer', is_nullable: 'NO', full_select: true },
          ],
        }
      }
      return { fields: [{ name: 'a', dataTypeID: 23 }], rows: [{ a: 1 }], command: 'SELECT', rowCount: 1 }
    }),
    commit: vi.fn(async () => { state.committed++ }),
    rollback: vi.fn(async () => { state.rolledBack++ }),
  }
  const database = {
    transaction: vi.fn(async (handler) => {
      if (!handler) { state.explicitForm++; return trx }
      state.handlerForm++
      try {
        const out = await handler(trx)
        state.committed++
        return out
      } catch (err) {
        state.rolledBack++
        throw err
      }
    }),
    // Catalog queries of the schema model that stay outside the reader role.
    raw: vi.fn(async () => ({ rows: [] })),
  }
  return { database, trx, calls, state }
}

function pgError(message, code) {
  // knex prefixes the SQL: "<sql> - <message>".
  const err = new Error(`SELECT * FROM members - ${message}`)
  err.code = code
  return err
}

function mount(database) {
  const routes = {}
  const router = {
    get: (p, h) => { routes[`GET ${p}`] = h },
    post: (p, h) => { routes[`POST ${p}`] = h },
  }
  const quiet = { info() {}, warn() {}, error() {} }
  registerSqlWorkspace(router, { database, logger: { child: () => quiet } })
  return routes
}

const res = () => ({
  statusCode: 200, body: null,
  status(c) { this.statusCode = c; return this },
  json(b) { this.body = b; return this },
})

async function run(database, body) {
  const routes = mount(database)
  const r = res()
  await routes['POST /admin/sql']({ accountability: { user: 'u1', admin: true }, body }, r)
  return r
}

describe('POST /admin/sql — read mode', () => {
  it('runs READ ONLY as kscw_sql_reader and rolls back on success, never commits', async () => {
    const { database, trx, calls, state } = fakeDb()
    const r = await run(database, { sql: 'SELECT 1' })
    expect(r.statusCode).toBe(200)
    expect(r.body.rows).toEqual([[1]])
    expect(database.transaction).toHaveBeenCalledWith()
    expect(calls).toEqual([
      'SET LOCAL statement_timeout = 15000',
      'SET LOCAL TRANSACTION READ ONLY',
      'SET LOCAL ROLE kscw_sql_reader',
      'SELECT 1\nLIMIT 1001',
    ])
    expect(trx.rollback).toHaveBeenCalledTimes(1)
    expect(trx.commit).not.toHaveBeenCalled()
    expect(state.committed).toBe(0)
    expect(state.handlerForm).toBe(0)
  })

  it('rolls back when a statement fails, and maps the reader\'s permission denied', async () => {
    const { database, trx, state } = fakeDb({
      fail: (sql) => (/FROM members/.test(sql) ? pgError('permission denied for table members', '42501') : null),
    })
    const r = await run(database, { sql: 'SELECT 1; SELECT * FROM members' })
    expect(r.statusCode).toBe(400)
    expect(r.body.code).toBe('credential_column_denied')
    expect(r.body.error).toMatch(/permission denied for table members/)
    expect(r.body.detail).toBe('permission denied for table members')
    expect(r.body.hint).toMatch(/list the columns/)
    expect(r.body.statement_index).toBe(1)
    expect(trx.rollback).toHaveBeenCalledTimes(1)
    expect(state.committed).toBe(0)
  })

  it('keeps other Postgres errors as they are', async () => {
    const { database, trx } = fakeDb({
      fail: (sql) => (/nope/.test(sql) ? pgError('column "nope" does not exist', '42703') : null),
    })
    const r = await run(database, { sql: 'SELECT nope FROM members' })
    expect(r.statusCode).toBe(400)
    expect(r.body.code).toBe('42703')
    expect(trx.rollback).toHaveBeenCalledTimes(1)
  })

  it('fails closed with 503 when the reader role is missing — the query never runs', async () => {
    const { database, trx, calls } = fakeDb({
      fail: (sql) => (/SET LOCAL ROLE/.test(sql) ? pgError('role "kscw_sql_reader" does not exist', '22023') : null),
    })
    const r = await run(database, { sql: 'SELECT 1' })
    expect(r.statusCode).toBe(503)
    expect(r.body.code).toBe('sql_reader_role_missing')
    expect(calls.some((s) => s.startsWith('SELECT 1'))).toBe(false)
    expect(trx.rollback).toHaveBeenCalledTimes(1)
  })

  it('refuses SET and set_config before touching the database', async () => {
    for (const [sql, want, idx] of [
      ['SET kscw.publish_file = on', 'statement_not_allowed', 0],
      ["SELECT 1; SELECT set_config('kscw.publish_file', 'on', false)", 'function_not_allowed', 1],
      ['SELECT pg_advisory_lock(42)', 'function_not_allowed', 0],
      ['COMMIT; SELECT 1', 'statement_not_allowed', 0],
    ]) {
      const { database } = fakeDb()
      const r = await run(database, { sql })
      expect(r.statusCode, sql).toBe(400)
      expect(r.body.code, sql).toBe(want)
      expect(r.body.statement_index, sql).toBe(idx)
      expect(database.transaction, sql).not.toHaveBeenCalled()
    }
  })

  it('still needs write mode for plain writes', async () => {
    const { database } = fakeDb()
    const r = await run(database, { sql: 'UPDATE members SET first_name = 1' })
    expect(r.body.code).toBe('write_required')
    expect(database.transaction).not.toHaveBeenCalled()
  })
})

describe('POST /admin/sql — write mode', () => {
  let saved
  beforeEach(() => { saved = process.env.SQL_WRITE_PIN; process.env.SQL_WRITE_PIN = PIN })
  afterEach(() => { if (saved === undefined) delete process.env.SQL_WRITE_PIN; else process.env.SQL_WRITE_PIN = saved })

  it('commits through the handler transaction and never switches role or READ ONLY', async () => {
    const { database, calls, state } = fakeDb()
    const r = await run(database, { sql: "UPDATE members SET first_name = 'A' WHERE id = 1", write_mode: true, write_pin: PIN })
    expect(r.statusCode).toBe(200)
    expect(state.handlerForm).toBe(1)
    expect(state.committed).toBe(1)
    expect(calls[0]).toBe('SET LOCAL statement_timeout = 15000')
    expect(calls.some((s) => /ROLE|READ ONLY/.test(s))).toBe(false)
  })

  it('does not remap 42501 (it is not the reader role there)', async () => {
    const { database } = fakeDb({ fail: (sql) => (/members/.test(sql) ? pgError('permission denied for table members', '42501') : null) })
    const r = await run(database, { sql: 'DELETE FROM members WHERE id = 1', write_mode: true, write_pin: PIN })
    expect(r.body.code).toBe('42501')
  })

  it('refuses code, privileges, ownership and session state before anything runs', async () => {
    for (const [sql, want] of [
      ['UPDATE members SET x = 1; CREATE FUNCTION f() RETURNS int AS $$ select 1 $$ LANGUAGE sql', 'ddl_not_allowed'],
      ['CREATE TRIGGER t AFTER INSERT ON members FOR EACH ROW EXECUTE FUNCTION f()', 'ddl_not_allowed'],
      ['DO $$ BEGIN END $$', 'ddl_not_allowed'],
      ['ALTER TABLE members OWNER TO directus_dev', 'ddl_not_allowed'],
      ['GRANT SELECT ON members TO PUBLIC', 'ddl_not_allowed'],
      ['ALTER ROLE directus_prod SET kscw.publish_file = on', 'ddl_not_allowed'],
      ["UPDATE pg_settings SET setting = 'on' WHERE name = 'kscw.publish_file'", 'statement_not_allowed'],
      ['CREATE TEMP TABLE members AS SELECT 1', 'statement_not_allowed'],
      ['SET search_path = evil, public', 'statement_not_allowed'],
      ["SELECT pg_catalog.set_config('kscw.publish_file', 'on', false)", 'function_not_allowed'],
    ]) {
      const { database } = fakeDb()
      const r = await run(database, { sql, write_mode: true, write_pin: PIN })
      expect(r.statusCode, sql).toBe(400)
      expect(r.body.code, sql).toBe(want)
      expect(database.transaction, sql).not.toHaveBeenCalled()
    }
  })

  it('checks the PIN before the statement policy', async () => {
    const { database } = fakeDb()
    const r = await run(database, { sql: 'SET x = 1', write_mode: true, write_pin: '000000' })
    expect(r.body.code).toBe('write_pin_invalid')
  })
})

describe('GET /admin/sql/schema', () => {
  it('lists columns as kscw_sql_reader inside a rolled-back READ ONLY transaction', async () => {
    const { database, trx, calls, state } = fakeDb()
    const routes = mount(database)
    const r = res()
    await routes['GET /admin/sql/schema']({ accountability: { user: 'u1', admin: true }, query: { refresh: '1' } }, r)
    expect(r.statusCode).toBe(200)
    // members has hidden (credential) columns → the sidebar must not offer SELECT *.
    expect(r.body.tables).toEqual([
      { name: 'members', restricted: true, columns: [{ name: 'id', data_type: 'integer', nullable: false }] },
      { name: 'teams', columns: [{ name: 'id', data_type: 'integer', nullable: false }] },
    ])
    expect(calls.slice(0, 2)).toEqual(['SET LOCAL TRANSACTION READ ONLY', 'SET LOCAL ROLE kscw_sql_reader'])
    expect(calls[2]).toMatch(/information_schema\.columns/)
    expect(trx.rollback).toHaveBeenCalledTimes(1)
    expect(state.committed).toBe(0)
  })

  it('fails closed (503) without the reader role', async () => {
    const { database } = fakeDb({
      fail: (sql) => (/SET LOCAL ROLE/.test(sql) ? pgError('role "kscw_sql_reader" does not exist', '22023') : null),
    })
    const routes = mount(database)
    const r = res()
    await routes['GET /admin/sql/schema']({ accountability: { user: 'u1', admin: true }, query: { refresh: '1' } }, r)
    expect(r.statusCode).toBe(503)
    expect(r.body.error).toMatch(/kscw_sql_reader/)
  })
})

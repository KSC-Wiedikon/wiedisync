/**
 * Migration 389 makes junction keys immutable unless the transaction sets the
 * `kscw.allow_junction_repoint` GUC. The season rollover re-points
 * hall_slots_teams / events_teams / forms_teams in place, so it must set that
 * GUC — transaction-local — before it touches any table, or the first re-point
 * raises check_violation and the whole rollover rolls back.
 */
import { describe, it, expect } from 'vitest'
import { registerGameScheduling } from '../game-scheduling.js'

function routes(database) {
  const r = {}
  const router = new Proxy({}, {
    get: (_t, method) => (path, ...hs) => { if (typeof path === 'string') r[`${String(method).toUpperCase()} ${path}`] = hs.at(-1) },
  })
  const noop = () => {}
  const logger = { child: () => logger, info: noop, warn: noop, error: noop, debug: noop }
  registerGameScheduling(router, { database, logger, services: {}, getSchema: async () => ({}) })
  return r
}

describe('POST /admin/terminplanung/rollover-season (migration 389)', () => {
  it('opens its transaction with set_config(kscw.allow_junction_repoint, on, true)', async () => {
    const calls = []
    const trx = (table) => {
      calls.push(`table:${table}`)
      throw Object.assign(new Error('stop after first table access'), { httpStatus: 418 })
    }
    trx.raw = async (sql) => { calls.push(`raw:${sql}`) }
    const database = (table) => { throw new Error(`unexpected non-trx access to ${table}`) }
    database.transaction = async (fn) => fn(trx)

    const handler = routes(database)['POST /admin/terminplanung/rollover-season']
    expect(handler).toBeTypeOf('function')
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
    await handler({ accountability: { admin: true, user: 'u-admin' }, body: { from_season: '2025/26', to_season: '2026/27' } }, res)

    expect(calls[0]).toMatch(/set_config\('kscw\.allow_junction_repoint',\s*'on',\s*true\)/)
    expect(calls[1]).toBe('table:teams')
  })
})

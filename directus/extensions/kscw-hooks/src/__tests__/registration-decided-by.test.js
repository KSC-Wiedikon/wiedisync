/**
 * Migration 407 — a registration records who approved or rejected it. The stamp
 * comes from the caller, never the payload, and only on a real status change.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@directus/api/permissions/lib/fetch-roles-tree', () => ({ fetchRolesTree: vi.fn() }))
vi.mock('@directus/api/permissions/modules/fetch-global-access/fetch-global-access', () => ({ fetchGlobalAccess: vi.fn() }))
vi.mock('@directus/api/permissions/utils/create-default-accountability', () => ({ createDefaultAccountability: vi.fn() }))

import registerHooks from '../index.js'

const TABLES = {
  registrations: [
    { id: 1, status: 'pending', membership_type: 'volleyball' },
    { id: 2, status: 'approved', membership_type: 'volleyball' },
    { id: 3, status: 'rejected', membership_type: 'volleyball' },
  ],
  members: [{ id: 7, user: 'u-staff', first_name: 'Anna', last_name: 'Muster', email: 'anna@example.ch', role: ['admin'] }],
  directus_users: [{ id: 'u-svc', first_name: 'Cron', last_name: 'Service', email: 'cron@example.ch' }],
}

function memDb() {
  const db = (table) => {
    const conds = []
    let mode = 'all'
    const eq = (a, b) => String(a) === String(b)
    const run = () => {
      const rows = (TABLES[table] ?? []).filter((r) => conds.every((c) => c(r)))
      return mode === 'first' ? rows[0] : rows
    }
    const chain = {
      where(a, b) {
        if (a && typeof a === 'object') conds.push((r) => Object.entries(a).every(([k, v]) => eq(r[k], v)))
        else conds.push((r) => eq(r[a], b))
        return chain
      },
      whereIn(col, ids) { const want = new Set(ids.map(String)); conds.push((r) => want.has(String(r[col]))); return chain },
      first() { mode = 'first'; return chain },
      select() { return chain },
      then(ok, err) { return Promise.resolve().then(run).then(ok, err) },
    }
    return chain
  }
  return db
}

const filters = {}
const noop = () => {}
const logger = { child: () => logger, info: noop, warn: noop, error: noop, debug: noop }
registerHooks(
  { action: noop, init: noop, schedule: noop, filter: (ev, fn) => { (filters[ev] ||= []).push(fn) } },
  { services: {}, database: memDb(), logger, getSchema: async () => ({}), env: {} },
)

async function update(payload, keys, user) {
  const ctx = { accountability: user ? { user, admin: true } : null, database: memDb() }
  let out = payload
  for (const fn of filters['registrations.items.update'] || []) out = await fn(out, { keys }, ctx)
  return out
}

describe('registration decision stamp', () => {
  it('stamps the approver from the caller', async () => {
    const out = await update({ status: 'approved' }, [1], 'u-staff')
    expect(out.approved_by_name).toBe('Anna Muster')
    expect(out.approved_by_email).toBe('anna@example.ch')
    expect(out.approved_at).toBeInstanceOf(Date)
    expect(out.rejected_by_name).toBeUndefined()
  })
  it('stamps the rejecter, and a rejected row approved later keeps both pairs', async () => {
    const rej = await update({ status: 'rejected', rejection_reason: 'x' }, [1], 'u-staff')
    expect(rej.rejected_by_name).toBe('Anna Muster')
    expect(rej.rejected_at).toBeInstanceOf(Date)
    const app = await update({ status: 'approved' }, [3], 'u-staff')
    expect(app.approved_by_name).toBe('Anna Muster')
    expect('rejected_by_name' in app).toBe(false)
  })
  it('falls back to the Directus user for a login with no member row', async () => {
    const out = await update({ status: 'approved' }, [1], 'u-svc')
    expect(out.approved_by_name).toBe('Cron Service')
  })
  it('never takes the stamp from the payload', async () => {
    const out = await update({ status: 'approved', approved_by_name: 'Someone else', rejected_at: '2020-01-01' }, [1], 'u-staff')
    expect(out.approved_by_name).toBe('Anna Muster')
    expect('rejected_at' in out).toBe(false)
    const plain = await update({ remarks: 'x', approved_by_email: 'forged@example.ch' }, [2], 'u-staff')
    expect('approved_by_email' in plain).toBe(false)
  })
  it('keeps the original stamp when a save resends the same status', async () => {
    const out = await update({ status: 'approved', remarks: 'x' }, [2], 'u-staff')
    expect('approved_by_name' in out).toBe(false)
    expect('approved_at' in out).toBe(false)
  })
  it('leaves a system write unstamped', async () => {
    const out = await update({ status: 'approved' }, [1], null)
    expect('approved_by_name' in out).toBe(false)
  })
})

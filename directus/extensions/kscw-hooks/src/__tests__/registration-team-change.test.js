/**
 * Editing `team` on an already-approved registration rosters the member on the
 * new team (Amelie Guntli, reg 61: approved as DU14, corrected to DU18 Spark,
 * roster never followed). Old teams stay; they are only reported.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@directus/api/permissions/lib/fetch-roles-tree', () => ({ fetchRolesTree: vi.fn() }))
vi.mock('@directus/api/permissions/modules/fetch-global-access/fetch-global-access', () => ({ fetchGlobalAccess: vi.fn() }))
vi.mock('@directus/api/permissions/utils/create-default-accountability', () => ({ createDefaultAccountability: vi.fn() }))

import registerHooks from '../index.js'

let TABLES

function memDb() {
  const db = (spec) => {
    const [table, alias] = String(spec).split(/\s+as\s+/)
    const conds = []
    let mode = 'all'
    let joined = null
    let pluckCol = null
    const eq = (a, b) => String(a) === String(b)
    const col = (r, c) => {
      const [t, f] = c.includes('.') ? c.split('.') : [null, c]
      if (joined && t === joined.alias) return joined.rowFor(r)?.[f]
      return r[f]
    }
    const run = () => {
      const rows = (TABLES[table] ?? []).filter((r) => conds.every((c) => c(r)))
      if (pluckCol) return rows.map((r) => col(r, pluckCol))
      return mode === 'first' ? rows[0] : rows
    }
    const chain = {
      where(a, b) {
        if (a && typeof a === 'object') conds.push((r) => Object.entries(a).every(([k, v]) => eq(col(r, k), v)))
        else conds.push((r) => eq(col(r, a), b))
        return chain
      },
      andWhere(a, b) { return chain.where(a, b) },
      whereIn(c, ids) { const want = new Set(ids.map(String)); conds.push((r) => want.has(String(col(r, c)))); return chain },
      whereNotIn(c, ids) { const no = new Set(ids.map(String)); conds.push((r) => !no.has(String(col(r, c)))); return chain },
      join(spec2, left, right) {
        const [t2, a2] = String(spec2).split(/\s+as\s+/)
        const [, rf] = right.split('.')
        const [, lf] = left.split('.')
        // left is "<joined alias>.id", right is "<base alias>.team"
        joined = { alias: a2, rowFor: (r) => (TABLES[t2] ?? []).find((x) => eq(x[lf], r[rf])) }
        void alias
        return chain
      },
      modify(fn) { fn(chain); return chain },
      first() { mode = 'first'; return chain },
      select() { return chain },
      pluck(c) { pluckCol = c; return chain },
      insert(row) { TABLES[table].push({ id: 1000 + TABLES[table].length, ...row }); return Promise.resolve([]) },
      then(ok, err) { return Promise.resolve().then(run).then(ok, err) },
    }
    return chain
  }
  return db
}

const actions = []
const noop = () => {}
const logger = { child: () => logger, info: noop, warn: noop, error: noop, debug: noop }
registerHooks(
  { action: (ev, fn) => { if (ev === 'items.update') actions.push(fn) }, init: noop, schedule: noop, filter: noop },
  { services: {}, database: memDb(), logger, getSchema: async () => ({}), env: {} },
)

async function fire(payload, keys) {
  for (const fn of actions) await fn({ collection: 'registrations', keys, payload }, { schema: {} })
}

beforeEach(() => {
  TABLES = {
    registrations: [
      { id: 61, status: 'approved', member: 755, team: 'DU18 Spark', rolle: 'Spieler*in', membership_type: 'basketball' },
      { id: 62, status: 'pending', member: 756, team: 'DU18 Spark', rolle: 'Spieler*in', membership_type: 'basketball' },
      { id: 63, status: 'approved', member: 757, team: 'DU18 Spark', rolle: 'Trainer*in', membership_type: 'basketball' },
    ],
    teams: [
      { id: 71, name: 'DU14', active: true, season: '2026/27', sport: 'basketball' },
      { id: 73, name: 'DU18 Spark', active: true, season: '2026/27', sport: 'basketball' },
    ],
    member_teams: [{ id: 2254, member: 755, team: 71, season: '2026/27', guest_level: 0 }],
  }
})

const rowsFor = (m) => TABLES.member_teams.filter((r) => r.member === m).map((r) => r.team).sort()

describe('team edited on an approved registration', () => {
  it('adds the member to the new team and keeps the old one', async () => {
    await fire({ team: 'DU18 Spark' }, [61])
    expect(rowsFor(755)).toEqual([71, 73])
    expect(TABLES.member_teams.find((r) => r.team === 73)).toMatchObject({ season: '2026/27', guest_level: 0 })
  })

  it('is idempotent', async () => {
    await fire({ team: 'DU18 Spark' }, [61])
    await fire({ team: 'DU18 Spark' }, [61])
    expect(rowsFor(755)).toEqual([71, 73])
  })

  it('ignores registrations that are not approved yet', async () => {
    await fire({ team: 'DU18 Spark' }, [62])
    expect(rowsFor(756)).toEqual([])
  })

  it('never rosters a coach/TR registration', async () => {
    await fire({ team: 'DU18 Spark' }, [63])
    expect(rowsFor(757)).toEqual([])
  })

  it('leaves a same-request approval to the approval path', async () => {
    await fire({ team: 'DU18 Spark', status: 'approved' }, [61])
    expect(rowsFor(755)).toEqual([71])
  })

  it('does nothing when team is not in the payload', async () => {
    await fire({ notes: 'x' }, [61])
    expect(rowsFor(755)).toEqual([71])
  })
})

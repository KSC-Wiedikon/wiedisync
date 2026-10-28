/**
 * 2026-10-11 audit M7 — a sport-confined admin (vb_admin / bb_admin below full
 * admin; every board member below full admin is one) cannot CREATE in, or MOVE a
 * row into, the other sport. The section policies cover existing rows; these
 * filters cover the two writes a row filter never sees.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@directus/api/permissions/lib/fetch-roles-tree', () => ({ fetchRolesTree: vi.fn() }))
vi.mock('@directus/api/permissions/modules/fetch-global-access/fetch-global-access', () => ({ fetchGlobalAccess: vi.fn() }))
vi.mock('@directus/api/permissions/utils/create-default-accountability', () => ({ createDefaultAccountability: vi.fn() }))

import registerHooks from '../index.js'

// ── In-memory knex: where / whereIn / andWhere / first / select over TABLES ──
const TABLES = {
  members: [
    { id: 1, user: 'u-bb', role: ['board', 'bb_admin'], permissions_section: 'basketball' },
    { id: 2, user: 'u-vb', role: ['vb_admin'], permissions_section: 'volleyball' },
    { id: 3, user: 'u-dual', role: ['vb_admin', 'bb_admin'], permissions_section: 'both' },
    { id: 4, user: 'u-coach', role: ['user'], permissions_section: 'volleyball' },
    { id: 5, user: 'u-bbcoach', role: ['bb_admin'], permissions_section: 'both' }, // BB admin who coaches VB team 10
    { id: 20, user: null, role: ['user'], permissions_section: 'volleyball' },
    { id: 21, user: null, role: ['user'], permissions_section: 'basketball' },
    { id: 22, user: null, role: ['user'], permissions_section: 'both' },
  ],
  teams: [
    { id: 10, sport: 'volleyball', active: true },
    { id: 11, sport: 'basketball', active: true },
  ],
  teams_coaches: [{ id: 1, teams_id: 10, members_id: 5 }],
  teams_responsibles: [],
  // `active` stands in for the teams join (the fake's join is a no-op).
  member_teams: [
    { id: 1, member: 20, team: 10, active: true },
    { id: 2, member: 21, team: 11, active: true },
  ],
  games: [
    { id: 100, kscw_team: 10 },
    { id: 101, kscw_team: 11 },
  ],
  trainings: [
    { id: 200, team: 10 },
    { id: 201, team: 11 },
  ],
  events: [
    { id: 300, permissions_section: 'volleyball', created_by: 99 },
    { id: 301, permissions_section: 'basketball', created_by: 99 },
    { id: 302, permissions_section: 'both', created_by: 99 },
  ],
  events_teams: [],
}

function memDb() {
  const db = (table) => {
    const conds = []
    let mode = 'all'
    const run = () => {
      const rows = (TABLES[table] ?? []).filter((r) => conds.every((c) => c(r)))
      return mode === 'first' ? rows[0] : rows
    }
    const eq = (a, b) => String(a) === String(b)
    const chain = {
      where(a, b) {
        if (a && typeof a === 'object') conds.push((r) => Object.entries(a).every(([k, v]) => eq(r[k], v)))
        else if (typeof a === 'string' && b !== undefined) conds.push((r) => eq(r[a.split('.').pop()], b))
        return chain
      },
      andWhere(a, b) { return chain.where(a, b) },
      whereIn(col, ids) { const want = new Set(ids.map(String)); conds.push((r) => want.has(String(r[col.split('.').pop()]))); return chain },
      whereNull() { return chain },
      whereNotNull() { return chain },
      join() { return chain },
      leftJoin() { return chain },
      orderBy() { return chain },
      limit() { return chain },
      first() { mode = 'first'; return chain },
      select() { return chain },
      count() { return chain },
      then(ok, err) { return Promise.resolve().then(run).then(ok, err) },
    }
    return chain
  }
  db.raw = (sql) => ({ raw: sql })
  db.fn = { now: () => new Date() }
  return db
}

const filters = {}
const noop = () => {}
const logger = { child: () => logger, info: noop, warn: noop, error: noop, debug: noop }
registerHooks(
  { action: noop, init: noop, schedule: noop, filter: (ev, fn) => { (filters[ev] ||= []).push(fn) } },
  { services: {}, database: memDb(), logger, getSchema: async () => ({}), env: {} },
)

async function write(ev, payload, user, meta = {}) {
  const ctx = { accountability: { user, admin: false }, database: memDb() }
  let out = payload
  for (const fn of filters[ev] || []) out = await fn(out, meta, ctx)
  return out
}
const refused = (p) => expect(p).rejects.toMatchObject({ code: 'OUT_OF_SPORT_SCOPE' })

describe('games / trainings: team of the other sport', () => {
  it('refuses a BB-scoped board member creating a volleyball game', async () => {
    await refused(write('games.items.create', { kscw_team: 10 }, 'u-bb'))
  })
  it('allows a game of their own sport', async () => {
    await expect(write('games.items.create', { kscw_team: 11 }, 'u-bb')).resolves.toBeTruthy()
  })
  it('refuses moving a training to the other sport, allows other edits', async () => {
    await refused(write('trainings.items.update', { team: 10 }, 'u-bb', { keys: [201] }))
    await expect(write('trainings.items.update', { notes: 'x' }, 'u-bb', { keys: [201] })).resolves.toBeTruthy()
  })
  it('keeps a confined admin who coaches a team of the other sport on that team', async () => {
    await expect(write('trainings.items.update', { team: 10 }, 'u-bbcoach', { keys: [200] })).resolves.toBeTruthy()
  })
  it('leaves a dual sport admin and a plain member alone', async () => {
    await expect(write('games.items.create', { kscw_team: 10 }, 'u-dual')).resolves.toBeTruthy()
    await expect(write('games.items.create', { kscw_team: 11 }, 'u-coach')).resolves.toBeTruthy()
  })
})

describe('member-keyed rows', () => {
  // Creates are owner-checked first by assertCreateOwnership (self, a coach/TR
  // of the member's team, or the admin of that team's sport) — already sport-
  // scoped. The M7 guard adds the update side: re-pointing a row at a member.
  it('refuses an absence for a member of the other section (owner check)', async () => {
    await expect(write('absences.items.create', { member: 20 }, 'u-bb')).rejects.toMatchObject({ status: 403 })
  })
  it('allows an absence for own section and self', async () => {
    await expect(write('absences.items.create', { member: 21 }, 'u-bb')).resolves.toBeTruthy()
    await expect(write('absences.items.create', { member: 1 }, 'u-bb')).resolves.toBeTruthy()
  })
  it('allows a member of a team the confined admin coaches', async () => {
    await expect(write('absences.items.create', { member: 20 }, 'u-bbcoach')).resolves.toBeTruthy()
  })
  it('lets a coach enter an absence for a co-coach who does not play (no roster row)', async () => {
    TABLES.teams_coaches.push({ id: 2, teams_id: 10, members_id: 22 })
    try {
      await expect(write('absences.items.create', { member: 22 }, 'u-bbcoach')).resolves.toBeTruthy()
      await expect(write('absences.items.create', { member: 22 }, 'u-coach')).rejects.toMatchObject({ status: 403 })
    } finally {
      TABLES.teams_coaches.pop()
    }
  })
  it('cannot re-point an absence or a participation at another member at all', async () => {
    await expect(write('absences.items.update', { member: 20 }, 'u-bb', { keys: [1] })).rejects.toMatchObject({ code: 'IMMUTABLE_FIELD' })
    await expect(write('participations.items.update', { member: 20 }, 'u-bb', { keys: [1] })).rejects.toMatchObject({ code: 'IMMUTABLE_FIELD' })
  })
  it('refuses a notification addressed to the other section', async () => {
    await refused(write('notifications.items.create', { member: 20, type: 'x' }, 'u-bb'))
    await expect(write('notifications.items.create', { member: 22, type: 'x' }, 'u-bb')).resolves.toBeTruthy()
  })
})

describe('teams and hall slots carry their own sport', () => {
  it('refuses creating or moving a team into the other sport', async () => {
    await expect(write('teams.items.create', { name: 'X', sport: 'volleyball' }, 'u-bb'))
      .rejects.toMatchObject({ code: 'OUT_OF_SPORT_SCOPE' })
    await expect(write('teams.items.update', { sport: 'volleyball' }, 'u-bb', { keys: [11] }))
      .rejects.toMatchObject({ code: 'OUT_OF_SPORT_SCOPE' })
  })
  it('allows a team of their own sport and edits that do not touch sport', async () => {
    await expect(write('teams.items.create', { name: 'X', sport: 'basketball' }, 'u-bb')).resolves.toBeTruthy()
    await expect(write('teams.items.update', { name: 'Y' }, 'u-bb', { keys: [11] })).resolves.toBeTruthy()
  })
  it('refuses moving a hall slot to the other sport; club slots stay open', async () => {
    await refused(write('hall_slots.items.update', { sport: 'volleyball' }, 'u-bb', { keys: [1] }))
    await expect(write('hall_slots.items.update', { sport: null }, 'u-bb', { keys: [1] })).resolves.toBeTruthy()
  })
})

describe("the board's event bypass follows the section", () => {
  it('refuses inviting into an event of the other sport', async () => {
    await expect(write('events_members.items.create', { events_id: 300, members_id: 22 }, 'u-bb'))
      .rejects.toMatchObject({ code: 'NOT_EVENT_MANAGER' })
  })
  it('allows own-sport and club events', async () => {
    await expect(write('events_members.items.create', { events_id: 301, members_id: 22 }, 'u-bb')).resolves.toBeTruthy()
    await expect(write('events_members.items.create', { events_id: 302, members_id: 22 }, 'u-bb')).resolves.toBeTruthy()
  })
  it('a dual sport admin still covers every event', async () => {
    await expect(write('events_members.items.create', { events_id: 300, members_id: 22 }, 'u-dual')).resolves.toBeTruthy()
  })
})

describe('system context and full admins', () => {
  it('never runs for a call with no user or an admin', async () => {
    const sys = { accountability: null, database: memDb() }
    for (const fn of filters['games.items.create']) await fn({ kscw_team: 10 }, {}, sys)
    const admin = { accountability: { user: 'u-bb', admin: true }, database: memDb() }
    let out = { kscw_team: 10 }
    for (const fn of filters['games.items.create']) out = await fn(out, {}, admin)
    expect(out.kscw_team).toBe(10)
  })
})

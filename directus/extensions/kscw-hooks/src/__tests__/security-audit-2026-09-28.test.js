/**
 * Deep audit 2026-09-28 — kscw-hooks guards.
 *
 * The recurring root cause: Directus runs `items.*` FILTER hooks before its
 * access check, so a filter that writes, or that uses the global knex pool
 * inside Directus's own transaction, misbehaves for requests that are later
 * refused. These tests pin the fixes:
 *   F41  no filter body touches the module-level pool (static scan)
 *   F03  hall-slot / training deletes write nothing until the action
 *   F08/F32  junction + game-guest key columns immutable on UPDATE
 *   F15/F17  events.created_by server-stamped, immutable on update
 *   F33  user_logs.acting_guardian comes from the swap, not the body
 *   F37  push_subscriptions.acting_guardian_user stamped from the swap
 *   F05  member privacy applied to relational (nested) member reads
 *   F01  form file answers moved into the private folder, own uploads only
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

vi.mock('@directus/api/permissions/lib/fetch-roles-tree', () => ({ fetchRolesTree: vi.fn() }))
vi.mock('@directus/api/permissions/modules/fetch-global-access/fetch-global-access', () => ({ fetchGlobalAccess: vi.fn() }))
vi.mock('@directus/api/permissions/utils/create-default-accountability', () => ({ createDefaultAccountability: vi.fn() }))

import registerHooks from '../index.js'

// ── A tiny knex stand-in: records every chained call, resolves via a handler ──
function fakeKnex(handler) {
  const calls = []
  const db = (table) => {
    const q = { table, ops: [] }
    calls.push(q)
    const chain = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (ok, err) => Promise.resolve().then(() => handler(q)).then(ok, err)
        }
        return (...args) => { q.ops.push([prop, args]); return chain }
      },
    })
    return chain
  }
  db.raw = (sql) => ({ raw: sql })
  db.transaction = async (fn) => fn(db)
  db.calls = calls
  return db
}
const has = (q, op) => q.ops.some(([p]) => p === op)
const WRITES = ['insert', 'update', 'delete', 'del']
const wrote = (db) => db.calls.some((q) => WRITES.some((w) => has(q, w)))

let globalHandler = () => { throw new Error('global pool used') }
const globalDb = fakeKnex((q) => globalHandler(q))

const filters = {}
const actions = {}
const noop = () => {}
const logger = { child: () => logger, info: noop, warn: noop, error: noop, debug: noop }
registerHooks(
  {
    action: (ev, fn) => { (actions[ev] ||= []).push(fn) },
    init: noop,
    schedule: noop,
    filter: (ev, fn) => { (filters[ev] ||= []).push(fn) },
  },
  { services: {}, database: globalDb, logger, getSchema: async () => ({}), env: {} },
)

async function runFilters(ev, payload, meta, ctx) {
  let out = payload
  for (const fn of filters[ev] || []) out = await fn(out, meta, ctx)
  return out
}
async function runActions(ev, meta, ctx) {
  for (const fn of actions[ev] || []) await fn(meta, ctx)
}

beforeEach(() => {
  globalDb.calls.length = 0
  globalHandler = () => { throw new Error('global pool used') }
})

// ── F41 ────────────────────────────────────────────────────────────────────
describe('F41: filters never use the module-level pool', () => {
  it('no filter( body references `database` except as the `?? database` fallback', () => {
    const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js'), 'utf8')
    const lines = src.split('\n')
    const offenders = []
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\s*)filter\(/.exec(lines[i])
      if (!m) continue
      const oneLiner = !lines[i].trimEnd().endsWith('{')
      for (let j = i; j < lines.length; j++) {
        const l = lines[j]
        if (/(?<![\w.?])database[(.]/.test(l) && !l.includes('?? database')) offenders.push(`${j + 1}: ${l.trim()}`)
        if (oneLiner && j === i) break
        if (j > i && new RegExp(`^${m[1]}\\}\\)`).test(l)) break
      }
    }
    expect(offenders).toEqual([])
  })
})

// ── F03 ────────────────────────────────────────────────────────────────────
describe('F03: a refused delete leaves nothing behind', () => {
  const anon = { user: null, role: null, admin: false }

  it('hall_slots delete filter only reads, on the request connection', async () => {
    const ctxDb = fakeKnex((q) => (q.table === 'trainings' ? [{ id: 11, hall_slot: 7 }, { id: 12, hall_slot: 7 }] : []))
    await runFilters('hall_slots.items.delete', [7], { collection: 'hall_slots' }, { database: ctxDb, accountability: anon })
    expect(wrote(ctxDb)).toBe(false)
    expect(globalDb.calls).toHaveLength(0)
  })

  it('the action deletes only the snapshotted trainings the FK detached', async () => {
    const ctxDb = fakeKnex(() => [{ id: 11, hall_slot: 7 }])
    await runFilters('hall_slots.items.delete', [7], { collection: 'hall_slots' }, { database: ctxDb, accountability: { user: 'u', admin: true } })
    globalHandler = (q) => (has(q, 'pluck') ? [11] : 1)
    await runActions('hall_slots.items.delete', { keys: [7] }, {})
    const trainingsDelete = globalDb.calls.find((q) => q.table === 'trainings' && has(q, 'delete'))
    expect(trainingsDelete).toBeDefined()
    const check = globalDb.calls.find((q) => q.table === 'trainings' && has(q, 'pluck'))
    expect(check.ops.some(([p, a]) => p === 'whereNull' && a[0] === 'hall_slot')).toBe(true)
  })

  it('an action for a slot nobody snapshotted does nothing', async () => {
    await runActions('hall_slots.items.delete', { keys: [999] }, {})
    expect(globalDb.calls).toHaveLength(0)
  })

  it('trainings delete filter plants no tombstone; the committed action does', async () => {
    const ctxDb = fakeKnex(() => [{ id: 5, hall_slot: 3, date: '2026-10-05' }])
    await runFilters('trainings.items.delete', [5], { collection: 'trainings' }, { database: ctxDb, accountability: anon })
    expect(wrote(ctxDb)).toBe(false)
    expect(globalDb.calls).toHaveLength(0)
    globalHandler = () => undefined
    await runActions('trainings.items.delete', { keys: [5] }, { accountability: { user: 'coach-1' } })
    const skip = globalDb.calls.find((q) => q.table === 'training_slot_skips')
    expect(skip.ops.find(([p]) => p === 'insert')[1][0]).toMatchObject({ hall_slot: 3, created_by: 'coach-1' })
  })
})

// ── F08 / F32 ──────────────────────────────────────────────────────────────
describe('F08/F32: junction key columns are immutable for non-admins', () => {
  const coach = { user: 'coach-1', admin: false }
  const stored = {
    teams_coaches: { id: 1, teams_id: 3, members_id: 40 },
    teams_responsibles: { id: 1, teams_id: 3, members_id: 40 },
    hall_slots_teams: { id: 1, hall_slots_id: 8, teams_id: 3 },
    events_teams: { id: 1, events_id: 12, teams_id: 3 },
    forms_teams: { id: 1, forms_id: 2, teams_id: 3 },
    teams_sponsors: { id: 1, teams_id: 3, sponsors_id: 4 },
    game_guests: { id: 1, game: 100, member: 40, via_team: null },
    game_guest_teams: { id: 1, game: 100, team: 3 },
    events_members: { id: 1, events_id: 12, members_id: 40 },
    event_sessions: { id: 1, event: 12 },
  }
  const repoint = {
    teams_coaches: { teams_id: 99 },
    teams_responsibles: { teams_id: 99 },
    hall_slots_teams: { teams_id: 99 },
    events_teams: { events_id: 999 },
    forms_teams: { teams_id: 99 },
    teams_sponsors: { teams_id: 99 },
    game_guests: { game: 999 },
    game_guest_teams: { game: 999 },
    events_members: { events_id: 999 },
    event_sessions: { event: 999 },
  }
  const ctxFor = (coll, accountability) => ({ database: fakeKnex((q) => (q.table === coll ? [stored[coll]] : undefined)), accountability })

  it.each(Object.keys(stored))('%s: re-point refused', async (coll) => {
    await expect(runFilters(`${coll}.items.update`, { ...repoint[coll] }, { keys: [1] }, ctxFor(coll, coach)))
      .rejects.toMatchObject({ code: 'IMMUTABLE_FIELD' })
  })

  it.each(Object.keys(stored))('%s: an unchanged re-send (M2M kept link) passes', async (coll) => {
    const { id: _id, ...same } = stored[coll]
    await expect(runFilters(`${coll}.items.update`, { ...same }, { keys: [1] }, ctxFor(coll, coach))).resolves.toBeDefined()
  })

  it('admins and system writes may re-point', async () => {
    await expect(runFilters('teams_coaches.items.update', { teams_id: 99 }, { keys: [1] }, ctxFor('teams_coaches', { user: 'a', admin: true }))).resolves.toBeDefined()
    await expect(runFilters('teams_coaches.items.update', { teams_id: 99 }, { keys: [1] }, ctxFor('teams_coaches', null))).resolves.toBeDefined()
  })

  it('game_guests: inviter stamp is stripped on update', async () => {
    const out = await runFilters('game_guests.items.update', { invited_by_name: 'Forged' }, { keys: [1] }, ctxFor('game_guests', coach))
    expect(out).not.toHaveProperty('invited_by_name')
  })
})

// ── F15 / F17 ──────────────────────────────────────────────────────────────
describe('F15/F17: events.created_by is server-owned', () => {
  const ctx = (accountability) => ({ database: fakeKnex((q) => (q.table === 'members' ? { id: 77 } : undefined)), accountability })

  it('create stamps the caller and drops the endpoint-owned slug', async () => {
    const out = await runFilters('events.items.create', { title: 'X', created_by: 5, signup_form_slug: 'other-form' }, {}, ctx({ user: 'coach-1', admin: false }))
    expect(out.created_by).toBe(77)
    expect(out).not.toHaveProperty('signup_form_slug')
  })

  it('update strips created_by for a co-manager saving the form', async () => {
    const out = await runFilters('events.items.update', { title: 'Y', created_by: 77, signup_form_slug: 'x' }, { keys: [1] }, ctx({ user: 'coach-1', admin: false }))
    expect(out).toEqual({ title: 'Y' })
  })

  it('a full admin may set created_by; defaults to self', async () => {
    expect((await runFilters('events.items.create', { created_by: 5 }, {}, ctx({ user: 'a', admin: true }))).created_by).toBe(5)
    expect((await runFilters('events.items.create', {}, {}, ctx({ user: 'a', admin: true }))).created_by).toBe(77)
  })
})

// ── F33 / F37 ──────────────────────────────────────────────────────────────
describe('F33/F37: acting markers come from the swap', () => {
  const db = fakeKnex((q) => (q.table === 'members' ? { id: 563 } : undefined))

  it('user_logs.acting_guardian is overwritten from accountability', async () => {
    const forged = await runFilters('user_logs.items.create', { action: 'x', acting_guardian: 1 }, {}, { database: db, accountability: { user: 's', admin: false } })
    expect(forged.acting_guardian).toBeNull()
    const acting = await runFilters('user_logs.items.create', { action: 'x' }, {}, { database: db, accountability: { user: 's', admin: false, kscwGuardian: { user: 'g', memberId: 50 } } })
    expect(acting.acting_guardian).toBe(50)
    expect(acting.user).toBe(563)
  })

  it('push_subscriptions.acting_guardian_user is stamped only while acting', async () => {
    const own = await runFilters('push_subscriptions.items.create', { member: 563, acting_guardian_user: 'forged' }, {}, { database: db, accountability: { user: 's', admin: false } })
    expect(own).not.toHaveProperty('acting_guardian_user')
    const acting = await runFilters('push_subscriptions.items.create', { member: 563 }, {}, { database: db, accountability: { user: 's', admin: false, kscwGuardian: { user: 'g', memberId: 50 } } })
    expect(acting.acting_guardian_user).toBe('g')
  })
})

// ── F05 ────────────────────────────────────────────────────────────────────
describe('F05: nested member reads are redacted like root reads', () => {
  const schema = {
    relations: [
      { collection: 'teams_coaches', field: 'teams_id', related_collection: 'teams', meta: { one_field: 'coach' } },
      { collection: 'teams_coaches', field: 'members_id', related_collection: 'members', meta: { one_field: null } },
      { collection: 'member_teams', field: 'member', related_collection: 'members', meta: { one_field: 'member_teams' } },
    ],
  }
  const gates = {
    40: { id: 40, user: 'u40', hide_phone: true, hide_email: false, birthdate_visibility: 'hidden', website_name_private: true },
    41: { id: 41, user: 'u41', hide_phone: false, hide_email: false, birthdate_visibility: 'full', website_name_private: false },
  }
  const ctxDb = (myRole = []) => fakeKnex((q) => {
    if (q.table !== 'members') return []
    if (has(q, 'first')) return { role: myRole }
    return Object.values(gates)
  })

  it('anonymous: coach surname through teams.coach.members_id is abbreviated (no id → fail closed)', async () => {
    const payload = [{ name: 'H1', coach: [{ members_id: { first_name: 'Anna', last_name: 'Muster' } }] }]
    const out = await runFilters('items.read', payload, { collection: 'teams' }, { database: ctxDb(), schema, accountability: { user: null, admin: false } })
    expect(out[0].coach[0].members_id.last_name).toBe('M.')
  })

  it('anonymous: a name-public member keeps the surname', async () => {
    const payload = [{ coach: [{ members_id: { id: 41, last_name: 'Offen' } }] }]
    const out = await runFilters('items.read', payload, { collection: 'teams' }, { database: ctxDb(), schema, accountability: { user: null, admin: false } })
    expect(out[0].coach[0].members_id.last_name).toBe('Offen')
  })

  it('a coach reading member_teams?fields=member.* gets hidden phone / birthdate / AHV nulled', async () => {
    const payload = [{ id: 1, member: { id: 40, phone: '079', email: 'a@b.ch', birthdate: '2010-01-01', ahv_nummer: '756.1' } }]
    const out = await runFilters('items.read', payload, { collection: 'member_teams' }, { database: ctxDb(), schema, accountability: { user: 'coach', admin: false } })
    expect(out[0].member).toMatchObject({ phone: null, email: 'a@b.ch', birthdate: null, ahv_nummer: null })
  })

  it('own record, full admins and system reads are left alone', async () => {
    const mine = [{ member: { id: 40, phone: '079' } }]
    await runFilters('items.read', mine, { collection: 'member_teams' }, { database: ctxDb(), schema, accountability: { user: 'u40', admin: false } })
    expect(mine[0].member.phone).toBe('079')
    const asAdminRole = [{ member: { id: 40, phone: '079' } }]
    await runFilters('items.read', asAdminRole, { collection: 'member_teams' }, { database: ctxDb(['superuser']), schema, accountability: { user: 'x', admin: false } })
    expect(asAdminRole[0].member.phone).toBe('079')
    const system = [{ member: { id: 40, phone: '079' } }]
    await runFilters('items.read', system, { collection: 'member_teams' }, { database: ctxDb(), schema, accountability: null })
    expect(system[0].member.phone).toBe('079')
  })

  // Blocker from review: aliases return a relation under a key that is not its field.
  it('REST alias at the root is resolved: teams?alias[c]=coach&fields=c.members_id.last_name', async () => {
    const payload = [{ c: [{ members_id: { last_name: 'Muster' } }] }]
    const out = await runFilters('items.read', payload, { collection: 'teams', query: { alias: { c: 'coach' } } }, { database: ctxDb(), schema, accountability: { user: null, admin: false } })
    expect(out[0].c[0].members_id.last_name).toBe('M.')
  })

  it('deep._alias on a nested level is resolved (also what GraphQL aliases become)', async () => {
    const payload = [{ coach: [{ m: { id: 40, last_name: 'Muster' } }] }]
    const query = { deep: { coach: { _alias: { m: 'members_id' } } } }
    const out = await runFilters('items.read', payload, { collection: 'teams', query }, { database: ctxDb(), schema, accountability: { user: null, admin: false } })
    expect(out[0].coach[0].m.last_name).toBe('M.')
  })

  it('an alias ON a member level (renaming phone past the rules) is refused', async () => {
    const nested = [{ member: { id: 40, p: '079' } }]
    await expect(runFilters('items.read', nested, { collection: 'member_teams', query: { deep: { member: { _alias: { p: 'phone' } } } } }, { database: ctxDb(), schema, accountability: { user: 'coach', admin: false } }))
      .rejects.toMatchObject({ code: 'MEMBER_ALIAS_REFUSED' })
    await expect(runFilters('items.read', [{ id: 40, p: '079' }], { collection: 'members', query: { alias: { p: 'phone' } } }, { database: ctxDb(), schema, accountability: { user: 'coach', admin: false } }))
      .rejects.toMatchObject({ code: 'MEMBER_ALIAS_REFUSED' })
  })

  it('an object-valued key the walk cannot place fails closed', async () => {
    await expect(runFilters('items.read', [{ x: { last_name: 'Muster' } }], { collection: 'teams', query: {} }, { database: ctxDb(), schema, accountability: { user: null, admin: false } }))
      .rejects.toMatchObject({ code: 'MEMBER_ALIAS_REFUSED' })
    // …but a real JSON column is just data.
    const withCols = { ...schema, collections: { teams: { fields: { settings: {} } } } }
    await expect(runFilters('items.read', [{ settings: { a: 1 } }], { collection: 'teams', query: {} }, { database: ctxDb(), schema: withCols, accountability: { user: null, admin: false } }))
      .resolves.toBeDefined()
  })

  it('members aggregates: count passes, min(birthdate) is refused below unconfined staff', async () => {
    await expect(runFilters('items.read', [{ count: 3 }], { collection: 'members', query: { aggregate: { count: ['*'] } } }, { database: ctxDb(), schema, accountability: { user: 'coach', admin: false } }))
      .resolves.toBeDefined()
    await expect(runFilters('items.read', [{ min: { birthdate: '2010-01-01' } }], { collection: 'members', query: { aggregate: { min: ['birthdate'] } } }, { database: ctxDb(), schema, accountability: { user: 'coach', admin: false } }))
      .rejects.toMatchObject({ code: 'MEMBER_AGGREGATE_REFUSED' })
    await expect(runFilters('items.read', [{ count: 3 }], { collection: 'teams', query: { aggregate: { count: ['*'] } } }, { database: ctxDb(), schema, accountability: { user: null, admin: false } }))
      .resolves.toBeDefined()
  })

  it('birthdate field functions (month(birthdate) → birthdate_month) are redacted too', async () => {
    const payload = [{ id: 1, member: { id: 40, birthdate_month: 3, birthdate_day: 14, birthdate_visibility: 'hidden' } }]
    const out = await runFilters('items.read', payload, { collection: 'member_teams' }, { database: ctxDb(), schema, accountability: { user: 'coach', admin: false } })
    expect(out[0].member).toMatchObject({ birthdate_month: null, birthdate_day: null, birthdate_visibility: 'hidden' })
  })

  it('reads with no nested member touch no database at all', async () => {
    const db = ctxDb()
    await runFilters('items.read', [{ id: 1, name: 'H1' }], { collection: 'teams' }, { database: db, schema, accountability: { user: null, admin: false } })
    expect(db.calls).toHaveLength(0)
  })
})

// ── F01 ────────────────────────────────────────────────────────────────────
describe('F01: form file answers are quarantined', () => {
  const FILE = '11111111-2222-4333-8444-555555555555'
  it('moves only unfiled (root or quarantine) files the submitter uploaded', async () => {
    globalHandler = (q) => {
      if (q.table === 'form_submissions') return [{ form: 9, answers: { f1: { id: FILE, name: 'a.pdf' }, f2: 'text' } }]
      if (q.table === 'forms') return { fields: [{ id: 'f1', type: 'file' }, { id: 'f2', type: 'text' }] }
      return 1
    }
    await runActions('form_submissions.items.create', { key: 3 }, { accountability: { user: 'u-sub' } })
    const upd = globalDb.calls.find((q) => q.table === 'directus_files' && has(q, 'update'))
    expect(upd.ops).toEqual(expect.arrayContaining([
      ['whereIn', ['id', [FILE]]],
      ['where', ['uploaded_by', 'u-sub']],
      ['update', [{ folder: '0e1a0387-0000-4000-8000-000000000002' }]],
    ]))
  })
})

// ── Round 2 ─────────────────────────────────────────────────────────────────
const QUARANTINE = '0e1a0387-0000-4000-8000-000000000004'
const PUBLIC_IMAGES = '0e1a0387-0000-4000-8000-000000000003'

describe('F01: feedback / registration quarantine only moves unfiled files', () => {
  it('feedback screenshots: folder IS NULL or quarantine only', async () => {
    globalHandler = (q) => (q.table === 'feedback' ? { screenshot: 'f-1', screenshots: ['f-1', 'f-2'] } : 1)
    await runActions('feedback.items.create', { key: 5 }, {})
    const upd = globalDb.calls.find((q) => q.table === 'directus_files' && has(q, 'update'))
    expect(upd.ops).toEqual(expect.arrayContaining([
      ['whereIn', ['id', ['f-1', 'f-2']]],
      ['update', [{ folder: 'feedbac0-0000-4000-8000-000000000001' }]],
    ]))
    // The folder guard is a grouped where(fn) — exercise it.
    const grouped = upd.ops.find(([p, a]) => p === 'where' && typeof a[0] === 'function')
    expect(grouped).toBeDefined()
    const sub = []
    const qb = { whereNull: (c) => { sub.push(['whereNull', c]); return qb }, orWhere: (c, v) => { sub.push(['orWhere', c, v]); return qb } }
    grouped[1][0](qb)
    expect(sub).toEqual([['whereNull', 'folder'], ['orWhere', 'folder', QUARANTINE]])
  })

  it('registration docs: same unfiled-only guard', async () => {
    globalHandler = (q) => (q.table === 'registrations' ? { id_upload_front: 'r-1' } : 1)
    await runActions('registrations.items.create', { key: 9 }, {})
    const upd = globalDb.calls.find((q) => q.table === 'directus_files' && has(q, 'update'))
    expect(upd.ops.some(([p, a]) => p === 'where' && typeof a[0] === 'function')).toBe(true)
  })
})

describe('F19: events_members create needs an event manager', () => {
  const ctx = ({ createdBy = 1, myId = 77, role = [], staffTeams = [] } = {}) => ({
    database: fakeKnex((q) => {
      if (q.table === 'members') return { id: myId, role }
      if (q.table === 'events') return { created_by: createdBy }
      if (q.table === 'events_teams') return staffTeams.map((t) => ({ teams_id: t }))
      if (q.table === 'teams_coaches') return staffTeams.length ? { id: 1 } : undefined
      return undefined
    }),
    accountability: { user: 'coach-1', admin: false },
  })

  it('a coach inviting themselves into a foreign private event is refused', async () => {
    await expect(runFilters('events_members.items.create', { events_id: 12, members_id: 77 }, {}, ctx()))
      .rejects.toMatchObject({ code: 'NOT_EVENT_MANAGER' })
  })
  it('the event creator may invite (EventForm nested create)', async () => {
    await expect(runFilters('events_members.items.create', { events_id: 12, members_id: 5 }, {}, ctx({ createdBy: 77 }))).resolves.toBeDefined()
  })
  it('coach of an attached active team may invite', async () => {
    await expect(runFilters('events_members.items.create', { events_id: 12, members_id: 5 }, {}, ctx({ staffTeams: [3] }))).resolves.toBeDefined()
  })
  it('vorstand may invite; admin and system bypass', async () => {
    await expect(runFilters('events_members.items.create', { events_id: 12, members_id: 5 }, {}, ctx({ role: ['vorstand'] }))).resolves.toBeDefined()
    await expect(runFilters('events_members.items.create', { events_id: 12 }, {}, { database: fakeKnex(() => undefined), accountability: { user: 'a', admin: true } })).resolves.toBeDefined()
    await expect(runFilters('events_members.items.create', { events_id: 12 }, {}, { database: fakeKnex(() => undefined), accountability: null })).resolves.toBeDefined()
  })
  it('only ACTIVE attached teams count', async () => {
    const c = ctx({ staffTeams: [3] })
    await runFilters('events_members.items.create', { events_id: 12, members_id: 5 }, {}, c)
    const et = c.database.calls.find((q) => q.table === 'events_teams')
    expect(et.ops).toEqual(expect.arrayContaining([['where', ['teams.active', true]]]))
  })
})

describe('F24: member_teams create guard', () => {
  const ctx = ({ target = { id: 5, kscw_membership_active: true, deactivated_at: null }, role = [], recent = 0, meId = 77 } = {}) => ({
    database: fakeKnex((q) => {
      if (q.table === 'members' && q.ops.some(([p, a]) => p === 'where' && a[0] === 'id')) return target
      if (q.table === 'members') return { id: meId, role }
      if (q.table === 'teams_coaches') return { id: 1 }
      if (q.table === 'user_logs') return { n: recent }
      return undefined
    }),
    accountability: { user: 'coach-1', admin: false },
  })
  it('a live member can be added by the team coach', async () => {
    await expect(runFilters('member_teams.items.create', { member: 5, team: 3 }, {}, ctx())).resolves.toBeDefined()
  })
  it('deactivated or ex-members are refused', async () => {
    await expect(runFilters('member_teams.items.create', { member: 5, team: 3 }, {}, ctx({ target: { id: 5, kscw_membership_active: false } })))
      .rejects.toMatchObject({ code: 'MEMBER_INACTIVE' })
    await expect(runFilters('member_teams.items.create', { member: 5, team: 3 }, {}, ctx({ target: { id: 5, kscw_membership_active: true, deactivated_at: '2026-01-01' } })))
      .rejects.toMatchObject({ code: 'MEMBER_INACTIVE' })
  })
  it('coaches are capped at 30 adds per hour; vorstand is not', async () => {
    await expect(runFilters('member_teams.items.create', { member: 5, team: 3 }, {}, ctx({ recent: 30 })))
      .rejects.toMatchObject({ code: 'ROSTER_ADD_RATE_LIMITED' })
    await expect(runFilters('member_teams.items.create', { member: 5, team: 3 }, {}, ctx({ recent: 29 }))).resolves.toBeDefined()
    await expect(runFilters('member_teams.items.create', { member: 5, team: 3 }, {}, ctx({ recent: 99, role: ['vorstand'] }))).resolves.toBeDefined()
  })
  it('an array POST cannot slip past the cap before user_logs is written', async () => {
    // Directus createMany runs every item's filter in one trx and emits the
    // audit actions only after commit, so user_logs reads 0 for the whole batch.
    const c = ctx({ recent: 0, meId: 901 })
    for (let i = 0; i < 30; i++) {
      await expect(runFilters('member_teams.items.create', { member: 5, team: 3 }, {}, c)).resolves.toBeDefined()
    }
    await expect(runFilters('member_teams.items.create', { member: 5, team: 3 }, {}, c))
      .rejects.toMatchObject({ code: 'ROSTER_ADD_RATE_LIMITED' })
    // Another coach has an independent budget.
    await expect(runFilters('member_teams.items.create', { member: 5, team: 3 }, {}, ctx({ recent: 0, meId: 902 }))).resolves.toBeDefined()
  })
  it('parallel adds are counted too (check + reserve is atomic)', async () => {
    const c = ctx({ recent: 0, meId: 903 })
    const results = await Promise.allSettled(Array.from({ length: 35 }, () => runFilters('member_teams.items.create', { member: 5, team: 3 }, {}, c)))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(30)
    expect(results.filter((r) => r.status === 'rejected').every((r) => r.reason?.code === 'ROSTER_ADD_RATE_LIMITED')).toBe(true)
  })
  it('admins and system (registration approval is raw knex anyway) bypass', async () => {
    await expect(runFilters('member_teams.items.create', { member: 5, team: 3 }, {}, { database: fakeKnex(() => undefined), accountability: { user: 'a', admin: true } })).resolves.toBeDefined()
  })
  it('the added member gets an in-app notification; a self-add does not', async () => {
    globalHandler = (q) => {
      if (q.table === 'member_teams') return { team: 3, member: 5 }
      if (q.table === 'members' && q.ops.some(([p, a]) => p === 'where' && a[0] === 'id')) return { id: 5, user: 'u5' }
      if (q.table === 'members') return { id: 77, first_name: 'Coach', last_name: 'One' }
      if (q.table === 'teams') return { name: 'H1' }
      if (q.table === 'participations' || has(q, 'raw')) return { rowCount: 0 }
      return 1
    }
    globalDb.raw = async () => ({ rowCount: 0 })
    await runActions('member_teams.items.create', { key: 1, payload: { member: 5, team: 3 } }, { accountability: { user: 'coach-1' } })
    const ins = globalDb.calls.find((q) => q.table === 'notifications' && has(q, 'insert'))
    expect(ins.ops.find(([p]) => p === 'insert')[1][0]).toMatchObject({ member: 5, type: 'team_added', title: 'team_added', activity_type: 'team', activity_id: '3', team: 3 })
    expect(JSON.parse(ins.ops.find(([p]) => p === 'insert')[1][0].body)).toEqual({ team: 'H1', by: 'Coach One' })
    globalDb.calls.length = 0
    await runActions('member_teams.items.create', { key: 1, payload: { member: 5, team: 3 } }, { accountability: { user: 'u5' } })
    expect(globalDb.calls.some((q) => q.table === 'notifications')).toBe(false)
  })
})

describe('F01: public image columns accept only your own upload', () => {
  const FILE = '11111111-2222-4333-8444-555555555555'
  const ctx = (file, current) => ({
    database: fakeKnex((q) => {
      if (q.table === 'directus_files') return file
      if (current !== undefined) return [current]
      return undefined
    }),
    accountability: { user: 'u1', admin: false },
  })
  it.each([
    ['members', 'photo'], ['teams', 'team_picture'], ['sponsors', 'logo'], ['news', 'image'], ['announcements', 'image'],
  ])('%s.%s: someone else\'s quarantined upload is refused, own upload passes', async (coll, col) => {
    // Only the ownership filter (the last one registered) — announcements has
    // its own audience guard ahead of it.
    const own = filters[`${coll}.items.update`].at(-1)
    await expect(own({ [col]: FILE }, { keys: [1] }, ctx({ folder: QUARANTINE, uploaded_by: 'u2' }, { [col]: null })))
      .rejects.toMatchObject({ code: 'FILE_NOT_YOURS' })
    await expect(own({ [col]: FILE }, { keys: [1] }, ctx({ folder: QUARANTINE, uploaded_by: 'u1' }, { [col]: null })))
      .resolves.toBeDefined()
  })
  it('an already-public image, an unchanged re-send and null all pass', async () => {
    await expect(runFilters('members.items.update', { photo: FILE }, { keys: [1] }, ctx({ folder: PUBLIC_IMAGES, uploaded_by: 'u2' }, { photo: null }))).resolves.toBeDefined()
    await expect(runFilters('members.items.update', { photo: FILE }, { keys: [1] }, ctx({ folder: QUARANTINE, uploaded_by: 'u2' }, { photo: FILE }))).resolves.toBeDefined()
    await expect(runFilters('members.items.update', { photo: null }, { keys: [1] }, ctx(undefined, { photo: FILE }))).resolves.toBeDefined()
  })
  it('create: a foreign file or a nested file object is refused; admins bypass', async () => {
    await expect(runFilters('sponsors.items.create', { name: 'X', logo: FILE }, {}, ctx({ folder: QUARANTINE, uploaded_by: 'u2' })))
      .rejects.toMatchObject({ code: 'FILE_NOT_YOURS' })
    await expect(runFilters('sponsors.items.create', { name: 'X', logo: { title: 'new' } }, {}, ctx(undefined)))
      .rejects.toMatchObject({ code: 'FILE_NOT_YOURS' })
    await expect(runFilters('sponsors.items.create', { logo: FILE }, {}, { database: fakeKnex(() => undefined), accountability: { user: 'a', admin: true } })).resolves.toBeDefined()
  })
})

describe('F30: role sync counts active teams only', () => {
  it('teams_coaches lookup joins teams.active = true', async () => {
    globalHandler = (q) => {
      if (q.table === 'members') return { role: [], user: 'u9' }
      if (q.table === 'directus_roles') return [{ id: 'r-m', name: 'Member' }, { id: 'r-tr', name: 'Team Responsible' }]
      if (q.table === 'directus_users') return { role: 'r-tr' }
      return undefined
    }
    await runActions('teams_coaches.items.create', { payload: { members_id: 9 } }, {})
    const tc = globalDb.calls.find((q) => q.table === 'teams_coaches')
    expect(tc.ops).toEqual(expect.arrayContaining([['join', ['teams', 'teams.id', 'teams_coaches.teams_id']], ['where', ['teams.active', true]]]))
    // No active staff row → demoted to Member.
    const upd = globalDb.calls.find((q) => q.table === 'directus_users' && has(q, 'update'))
    expect(upd.ops.find(([p]) => p === 'update')[1][0]).toEqual({ role: 'r-m' })
  })
})

describe('F05: website coach read keeps the requested shape', () => {
  const schema = {
    relations: [
      { collection: 'teams_coaches', field: 'teams_id', related_collection: 'teams', meta: { one_field: 'coach' } },
      { collection: 'teams_coaches', field: 'members_id', related_collection: 'members', meta: { one_field: null } },
    ],
  }
  const gates = [
    { id: 40, user: null, hide_phone: false, hide_email: false, birthdate_visibility: 'hidden', website_name_private: true },
    { id: 41, user: null, hide_phone: false, hide_email: false, birthdate_visibility: 'hidden', website_name_private: false },
  ]
  const anon = { user: null, admin: false }

  it('query filter adds coach.members_id.id; read redacts only the private coach and strips the id again', async () => {
    const fields = ['name', 'coach.members_id.first_name', 'coach.members_id.last_name']
    const q = await runFilters('items.query', { fields }, { collection: 'teams' }, { schema, accountability: anon })
    expect(q.fields).toEqual([...fields, 'coach.members_id.id'])
    // What Directus returns for that query:
    const payload = [{ name: 'U16', coach: [
      { members_id: { id: 40, first_name: 'Anna', last_name: 'Muster' } },
      { members_id: { id: 41, first_name: 'Ben', last_name: 'Offen' } },
    ] }]
    const db = fakeKnex((qq) => (qq.table === 'members' ? gates : []))
    const out = await runFilters('items.read', payload, { collection: 'teams', query: q }, { database: db, schema, accountability: anon })
    expect(out[0].coach).toEqual([
      { members_id: { first_name: 'Anna', last_name: 'M.' } },
      { members_id: { first_name: 'Ben', last_name: 'Offen' } },
    ])
  })

  it('leaves queries that already select the id (or *) and admin reads untouched', async () => {
    const withId = { fields: ['coach.members_id.id', 'coach.members_id.last_name'] }
    expect(await runFilters('items.query', withId, { collection: 'teams' }, { schema, accountability: anon })).toBe(withId)
    const star = { fields: ['coach.members_id.*'] }
    expect(await runFilters('items.query', star, { collection: 'teams' }, { schema, accountability: anon })).toBe(star)
    const admin = { fields: ['coach.members_id.last_name'] }
    expect(await runFilters('items.query', admin, { collection: 'teams' }, { schema, accountability: { user: 'a', admin: true } })).toBe(admin)
  })
})

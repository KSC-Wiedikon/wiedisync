/**
 * /items guards for the hall source switch (migration 455): the switch's columns are
 * endpoint-only for everyone, and a game whose hall is overwritten cannot get a new
 * hall through /items. Both answer a DirectusError-shaped 403 so the message reaches
 * the caller. Also proves they are wired into the real hook module.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@directus/api/permissions/lib/fetch-roles-tree', () => ({ fetchRolesTree: vi.fn() }))
vi.mock('@directus/api/permissions/modules/fetch-global-access/fetch-global-access', () => ({ fetchGlobalAccess: vi.fn() }))
vi.mock('@directus/api/permissions/utils/create-default-accountability', () => ({ createDefaultAccountability: vi.fn() }))

import { refuseHallOverrideColumns, refuseHallEditWhileOverridden } from '../hall-override-guard.js'
import registerHooks from '../index.js'

const MEMBER = { user: 'u-1', admin: false }
const ADMIN = { user: 'u-admin', admin: true }

/** games rows by id; answers whereIn('id').where('hall_override', true).select(). */
function gamesDb(rows) {
  const db = (table) => {
    const q = { ids: [], override: null }
    const pick = () => (table === 'games'
      ? rows.filter((r) => q.ids.includes(r.id) && (q.override == null || r.hall_override === q.override))
      : [])
    const chain = {
      whereIn: (_c, ids) => { q.ids = ids.map(Number); return chain },
      where: (_c, v) => { q.override = v; return chain },
      select: async () => pick(),
      first: async () => pick()[0],
    }
    return chain
  }
  return db
}

describe('refuseHallOverrideColumns', () => {
  it.each(['hall_override', 'synced_hall', 'synced_additional_halls', 'hall_override_by_name', 'hall_override_at'])(
    'refuses %s for a member and for a Directus admin',
    (field) => {
      for (const acc of [MEMBER, ADMIN]) {
        let err
        try { refuseHallOverrideColumns({ [field]: true }, acc) } catch (e) { err = e }
        expect(err?.name).toBe('DirectusError')
        expect(err?.status).toBe(403)
        expect(err?.code).toBe('FIELD_NOT_WRITABLE')
      }
    },
  )

  it('lets every other payload through, and internal service calls', () => {
    const p = { hall: 3, scorer_member: 5 }
    expect(refuseHallOverrideColumns(p, MEMBER)).toBe(p)
    expect(refuseHallOverrideColumns({ hall_override: true }, null)).toEqual({ hall_override: true })
    expect(refuseHallOverrideColumns(null, MEMBER)).toBeNull()
  })
})

describe('refuseHallEditWhileOverridden', () => {
  const db = gamesDb([{ id: 1, hall_override: true, hall: 4, additional_halls: null }, { id: 2, hall_override: false, hall: 1 }])

  it('refuses a hall or court-set edit on an overwritten game, admins included', async () => {
    for (const payload of [{ hall: 3 }, { additional_halls: ['2'] }, { hall: null }]) {
      for (const acc of [MEMBER, ADMIN]) {
        await expect(refuseHallEditWhileOverridden(db, [1], payload, acc)).rejects.toMatchObject({ status: 403, code: 'HALL_OVERRIDDEN' })
      }
    }
  })

  it('lets a hall edit on a game on Sync through, and edits that do not touch the hall', async () => {
    expect(await refuseHallEditWhileOverridden(db, [2], { hall: 3 }, MEMBER)).toEqual({ hall: 3 })
    expect(await refuseHallEditWhileOverridden(db, [1], { scorer_member: 9 }, MEMBER)).toEqual({ scorer_member: 9 })
    expect(await refuseHallEditWhileOverridden(db, 1, { hall: 3 }, null)).toEqual({ hall: 3 })
    expect(await refuseHallEditWhileOverridden(db, [], { hall: 3 }, MEMBER)).toEqual({ hall: 3 })
  })

  it('re-sending the hall an overwritten game already has is not a move', async () => {
    expect(await refuseHallEditWhileOverridden(db, [1], { hall: '4', additional_halls: [] }, MEMBER)).toEqual({ hall: '4', additional_halls: [] })
  })
})

describe('wired into kscw-hooks', () => {
  const filters = {}
  const noop = () => {}
  const logger = { child: () => logger, info: noop, warn: noop, error: noop, debug: noop }
  const database = Object.assign(gamesDb([{ id: 1, hall_override: true, hall: 4, additional_halls: null }]), { raw: () => {} })
  registerHooks(
    {
      action: noop,
      init: noop,
      schedule: noop,
      filter: (ev, fn) => { (filters[ev] ||= []).push(fn) },
    },
    { services: {}, database, logger, getSchema: async () => ({}), env: {} },
  )

  /** Run every filter for the event like Directus does, in order. */
  async function runAll(event, payload, meta, ctx) {
    let p = payload
    for (const fn of filters[event] || []) p = (await fn(p, meta, ctx)) ?? p
    return p
  }

  it('a games create with hall_override is refused', async () => {
    await expect(runAll('games.items.create', { source: 'swiss_volley', hall_override: true }, {}, { accountability: MEMBER, database }))
      .rejects.toMatchObject({ status: 403 })
  })

  it('a games update moving the hall of an overwritten game is refused', async () => {
    await expect(runAll('games.items.update', { hall: 3 }, { keys: [1] }, { accountability: ADMIN, database }))
      .rejects.toMatchObject({ code: 'HALL_OVERRIDDEN' })
  })
})

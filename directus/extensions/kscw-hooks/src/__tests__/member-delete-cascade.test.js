/**
 * Deleting a member deletes its login (directus_users), whatever type the key has.
 * The admin's single-item delete (DELETE /items/members/795) hands the hooks "795",
 * while the filter reads 795 back from the DB: keyed by the raw id, the action
 * missed it and the login stayed behind (found 28.11.2026 on dev).
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@directus/api/permissions/lib/fetch-roles-tree', () => ({ fetchRolesTree: vi.fn() }))
vi.mock('@directus/api/permissions/modules/fetch-global-access/fetch-global-access', () => ({ fetchGlobalAccess: vi.fn() }))
vi.mock('@directus/api/permissions/utils/create-default-accountability', () => ({ createDefaultAccountability: vi.fn() }))

import registerHooks from '../index.js'

const filters = {}
const actions = {}
const noop = () => {}
const logger = { child: () => logger, info: noop, warn: noop, error: noop, debug: noop }
const deletedUsers = []
const database = Object.assign((table) => ({
  whereIn: () => ({ select: async () => (table === 'members' ? [{ id: 795, user: 'u-795' }] : []) }),
  where: (_col, val) => ({ delete: async () => { if (table === 'directus_users') deletedUsers.push(val); return 1 } }),
}), { raw: noop })

registerHooks(
  {
    init: noop, schedule: noop,
    filter: (ev, fn) => { (filters[ev] ||= []).push(fn) },
    action: (ev, fn) => { (actions[ev] ||= []).push(fn) },
  },
  { services: {}, database, logger, getSchema: async () => ({}), env: {} },
)

async function deleteMember(keys) {
  for (const fn of filters['members.items.delete'] || []) await fn(keys, { collection: 'members' }, { database })
  for (const fn of actions['members.items.delete'] || []) await fn({ keys, collection: 'members' }, {})
}

describe('member delete → login delete', () => {
  it.each([[['795']], [[795]]])('keys %j', async (keys) => {
    deletedUsers.length = 0
    await deleteMember(keys)
    expect(deletedUsers).toEqual(['u-795'])
  })
})

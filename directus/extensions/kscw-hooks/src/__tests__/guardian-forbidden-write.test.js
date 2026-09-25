/**
 * GUARDIAN_FORBIDDEN_WRITE — the collections a main account may NOT write while
 * acting as a linked member, even though the swap makes her look exactly like
 * that member.
 *
 * Without the set the swap silently inverts assertCreateOwnership: acting makes
 * `editor.id === affectedMemberId`, so "self only" returns early and a parent
 * could vote in polls and hand off scorer duty for her child. Update and delete
 * are pinned too — the Member policy grants an existing row's owner update under
 * $CURRENT_USER, which the swap satisfies. The allow-list half pins what a main
 * account IS meant to do for a linked member.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@directus/api/permissions/lib/fetch-roles-tree', () => ({ fetchRolesTree: vi.fn() }))
vi.mock('@directus/api/permissions/modules/fetch-global-access/fetch-global-access', () => ({ fetchGlobalAccess: vi.fn() }))
vi.mock('@directus/api/permissions/utils/create-default-accountability', () => ({ createDefaultAccountability: vi.fn() }))

import registerHooks from '../index.js'

const filters = {}
const noop = () => {}
const logger = { child: () => logger, info: noop, warn: noop, error: noop, debug: noop }
registerHooks(
  { action: noop, init: noop, schedule: noop, filter: (ev, fn) => { (filters[ev] ||= []).push(fn) } },
  { services: {}, database: Object.assign(() => ({}), { raw: noop }), logger, getSchema: async () => ({}), env: {} },
)

// Linked member 563, acted as by the main account.
const acting = { user: 'shadow-563', admin: false, kscwGuardian: { user: 'u-main', memberId: 50 } }
const self = { user: 'shadow-563', admin: false }
const db = (t) => ({ where: () => ({ select: () => ({ first: async () => (t === 'members' ? { id: 563 } : undefined) }) }) })

const runAll = (ev, payload, accountability) =>
  Promise.all((filters[ev] || []).map((fn) => fn(payload, { collection: ev.split('.')[0] }, { database: db, accountability })))

describe('blocked while acting', () => {
  it.each([['poll_votes', 'member'], ['scorer_delegations', 'from_member']])('create %s', async (coll, field) => {
    await expect(runAll(`${coll}.items.create`, { [field]: 563 }, acting)).rejects.toThrow(/another account/)
    await expect(runAll(`${coll}.items.create`, { [field]: 563 }, self)).resolves.toBeDefined()
  })

  it.each([
    ['poll_votes', 'update'], ['poll_votes', 'delete'],
    ['scorer_delegations', 'update'], ['scorer_delegations', 'delete'],
  ])('%s %s', async (coll, ev) => {
    const key = `${coll}.items.${ev}`
    expect(filters[key]?.length).toBeGreaterThan(0)
    await expect(runAll(key, { status: 'accepted' }, acting)).rejects.toThrow(/another account/)
    await expect(runAll(key, { status: 'accepted' }, self)).resolves.toBeDefined()
  })
})

describe('allowed while acting (deliberate)', () => {
  it.each([['participations', 'member'], ['absences', 'member'], ['push_subscriptions', 'member'], ['team_requests', 'member']])(
    'create %s for the acted-as member', async (coll, field) => {
      const r = await runAll(`${coll}.items.create`, { [field]: 563 }, acting)
      expect(r.length).toBeGreaterThan(0)
    },
  )
})

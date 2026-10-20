/**
 * members.items.update → ClubDesk push flag for the contact cells (2026-10-20).
 *
 * An items-API edit to email / phone / address / PLZ / city / birthdate now
 * queues a push at edit time and names the field in clubdesk_push_changes — but
 * only when the value really changed (ProfileEditForm re-sends the whole
 * address block on every save). The register fields keep their old rule: any
 * non-empty value flags.
 *
 * Drives the real hook module: every members.items.update filter, then every
 * action, against a knex stand-in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@directus/api/permissions/lib/fetch-roles-tree', () => ({ fetchRolesTree: vi.fn() }))
vi.mock('@directus/api/permissions/modules/fetch-global-access/fetch-global-access', () => ({ fetchGlobalAccess: vi.fn() }))
vi.mock('@directus/api/permissions/utils/create-default-accountability', () => ({ createDefaultAccountability: vi.fn() }))

import registerHooks from '../index.js'

let members = {}
let updates = []

/** members-only knex stand-in: whereIn/where + select/first/update. */
function db(table) {
  const q = {
    _ids: null,
    _where: null,
    whereIn(_c, ids) { q._ids = ids.map(String); return q },
    where(a, b) { q._where = typeof a === 'object' ? a : { [a]: b }; return q },
    async select(...cols) {
      if (table !== 'members') return []
      const rows = Object.values(members).filter((m) => (q._ids ? q._ids.includes(String(m.id)) : String(m.id) === String(q._where?.id)))
      return rows.map((m) => Object.fromEntries(cols.map((c) => [c, m[c]])))
    },
    async first() { return undefined },
    async update(patch) {
      updates.push({ id: q._where?.id, patch })
      if (members[q._where?.id]) Object.assign(members[q._where.id], patch)
      return 1
    },
    async insert() { return [1] },
  }
  return q
}
db.raw = async () => ({ rows: [] })

const filters = {}
const actions = {}
const noop = () => {}
const logger = { child: () => logger, info: noop, warn: noop, error: noop, debug: noop }
registerHooks(
  {
    action: (ev, fn) => { (actions[ev] ||= []).push(fn) },
    filter: (ev, fn) => { (filters[ev] ||= []).push(fn) },
    init: noop, schedule: noop,
  },
  { services: {}, database: db, logger, getSchema: async () => ({}), env: {} },
)

/** One items-API update, as Directus runs it: filters in order, then actions. */
async function update(keys, payload) {
  let p = payload
  for (const fn of filters['members.items.update'] || []) {
    p = (await fn(p, { keys, collection: 'members' }, { database: db, accountability: null })) ?? p
  }
  for (const fn of actions['members.items.update'] || []) {
    await fn({ keys, payload: p, collection: 'members' }, { database: db, accountability: null })
  }
}

const pushed = (id) => {
  const u = updates.filter((x) => String(x.id) === String(id) && 'clubdesk_push_changes' in x.patch).at(-1)
  return u ? JSON.parse(u.patch.clubdesk_push_changes) : null
}

beforeEach(() => {
  updates = []
  members = {
    120: {
      id: 120, clubdesk_id: '1000120', clubdesk_push_changes: null,
      email: 'parent@example.ch', phone: '+41 79 000 00 00', address: 'Weg 1',
      postal_code: '8003', city: 'Zürich', birthdate: new Date('2009-04-17T00:00:00Z'),
    },
    735: { id: 735, clubdesk_id: null, clubdesk_push_changes: null, email: 'a@x.ch' },
  }
})

describe('contact-field edits flag a ClubDesk push at edit time', () => {
  it('flags a changed email and names it, with the old value', async () => {
    await update([120], { email: 'player@example.ch' })
    expect(members[120].clubdesk_push_pending).toBe(true)
    expect(pushed(120)).toEqual([{ field: 'email', old_value: 'parent@example.ch', new_value: 'player@example.ch' }])
  })

  it('a profile save re-sending the unchanged block flags nothing', async () => {
    await update([120], {
      email: 'Parent@Example.ch', address: 'Weg 1', postal_code: '8003', city: 'Zürich', birthdate: '2009-04-17',
    })
    expect(pushed(120)).toBeNull()
    expect(members[120].clubdesk_push_pending).toBeUndefined()
  })

  it('names only the fields that changed, birthdate in Swiss format', async () => {
    await update([120], { address: 'Weg 1', city: 'Winterthur', birthdate: '2009-04-18' })
    expect(pushed(120)).toEqual([
      { field: 'city', old_value: 'Zürich', new_value: 'Winterthur' },
      { field: 'birthdate', old_value: '17.04.2009', new_value: '18.04.2009' },
    ])
  })

  it('never flags a cleared field (the push cannot blank the register)', async () => {
    await update([120], { phone: '' })
    expect(pushed(120)).toBeNull()
  })

  it('skips an unlinked member — the CREATE push carries the values', async () => {
    await update([735], { email: 'b@x.ch' })
    expect(pushed(735)).toBeNull()
  })

  it('register fields keep their rule (any non-empty value flags) and merge with contact fields', async () => {
    await update([120], { iban: 'CH9300762011623852957', email: 'player@example.ch' })
    expect(pushed(120)).toEqual([
      { field: 'iban', old_value: null, new_value: 'CH9300762011623852957' },
      { field: 'email', old_value: 'parent@example.ch', new_value: 'player@example.ch' },
    ])
  })
})

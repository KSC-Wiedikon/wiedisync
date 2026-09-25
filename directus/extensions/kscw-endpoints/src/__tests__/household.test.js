/**
 * Households — the refusals and the consent test that nothing else pins.
 *
 * The acting middleware (kscw-hooks) trusts two things this module decides:
 * who may be a MANAGED target (a member with no usable login — never one with a
 * real account of her own) and who may be a MAIN account (anyone with a real,
 * non-shadow login — deliberately with NO age rule: the club lets a child's own
 * login manage a sibling). These tests pin both, plus the integrity refusals
 * that used to degrade into silent defaults or 500s: a typo'd role became
 * 'managed', a link id from another household revoked the wrong row, and a
 * household with history could be deleted through its ON DELETE CASCADE.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  registerHousehold,
  parseRole,
  isShadowUser,
  manageableReason,
  guardianReason,
  actableReason,
  dedupeManaged,
  managedEmailFor,
  MANAGED_EMAIL_DOMAIN,
} from '../household.js'
import { withActorStamp } from '../activity-log.js'

// ── A knex-shaped fake, only as wide as the routes under test use ──────────
function makeDb(tables) {
  class QB {
    constructor(name) { this.name = name; this.conds = []; this.inCond = null; this.notConds = [] }
    where(a, b) {
      if (typeof a === 'function') return this
      if (a && typeof a === 'object') for (const [k, v] of Object.entries(a)) this.conds.push([k, v])
      else this.conds.push([a, b])
      return this
    }
    whereNot(k, v) { this.notConds.push([k, v]); return this }
    whereIn(k, arr) { this.inCond = [k, arr.map(String)]; return this }
    whereNull(k) { this.conds.push([k, null]); return this }
    whereNotNull() { return this }
    join() { return this }
    leftJoin() { return this }
    whereRaw() { return this }
    forUpdate() { return this }
    orderBy() { return this }
    rows() {
      return (tables[this.name] || []).filter((r) =>
        this.conds.every(([k, v]) => (v === null ? r[k] == null : r[k] === v))
        && this.notConds.every(([k, v]) => r[k] !== v)
        && (!this.inCond || this.inCond[1].includes(String(r[this.inCond[0]]))))
    }
    select() { return this }
    first() { const r = this.rows()[0]; return Promise.resolve(r ? { ...r } : undefined) }
    pluck(col) { return Promise.resolve(this.rows().map((r) => r[col])) }
    count() { return Promise.resolve([{ n: this.rows().length }]) }
    update(patch) {
      const rs = this.rows()
      rs.forEach((r) => Object.assign(r, patch))
      const p = Promise.resolve(rs.length)
      p.returning = () => Promise.resolve(rs.map((r) => ({ ...r })))
      return p
    }
    insert(row) {
      const list = (tables[this.name] ||= [])
      const created = { id: list.length + 1000, ...row }
      list.push(created)
      const p = Promise.resolve([created.id])
      p.returning = () => Promise.resolve([{ ...created }])
      return p
    }
    delete() {
      const rs = this.rows()
      tables[this.name] = tables[this.name].filter((r) => !rs.includes(r))
      return Promise.resolve(rs.length)
    }
    then(res, rej) { return Promise.resolve(this.rows().map((r) => ({ ...r }))).then(res, rej) }
  }
  const db = (name) => new QB(name)
  db.raw = (sql) => sql
  db.transaction = async (fn) => fn(db)
  return db
}

function makeRouter() {
  const routes = {}
  const add = (m) => (path, handler) => { routes[`${m} ${path}`] = handler }
  return { routes, get: add('GET'), post: add('POST'), patch: add('PATCH'), delete: add('DELETE') }
}

const noopLogger = { child: () => noopLogger, error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }

function makeRes() {
  const res = { statusCode: 200, body: undefined }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  return res
}

const ADMIN_USER = 'user-admin'
const ADMIN = { user: ADMIN_USER, admin: true }

let tables
let routes

beforeEach(() => {
  tables = {
    members: [{ id: 1, user: ADMIN_USER, role: '["superuser"]', first_name: 'Ada' }],
    households: [
      { id: 10, name: 'Familie Alexandre', notes: null },
      { id: 11, name: 'Typo household', notes: null },
    ],
    household_members: [
      { id: 100, household: 10, member: 112, role: 'guardian', revoked_at: null },
      { id: 101, household: 10, member: 763, role: 'managed', revoked_at: null },
    ],
    user_logs: [],
  }
  globalThis.__kscwActingGrantBust = vi.fn()
  const router = makeRouter()
  registerHousehold(router, { database: makeDb(tables), logger: noopLogger, services: {}, getSchema: async () => ({}) })
  routes = router.routes
})

async function call(key, req) {
  const res = makeRes()
  await routes[key]({ params: {}, query: {}, body: {}, accountability: ADMIN, ...req }, res)
  return res
}

describe('pure rules', () => {
  it('accepts exactly the two roles — a typo is refused, never defaulted to managed', () => {
    expect(parseRole('guardian')).toBe('guardian')
    expect(parseRole('managed')).toBe('managed')
    expect(parseRole('Guardian')).toBeNull()
    expect(parseRole('child')).toBeNull()
    expect(parseRole(undefined)).toBeNull()
  })

  it('recognises a shadow login only when draft, on the managed domain and passwordless', () => {
    const shadow = { email: managedEmailFor(763), status: 'draft', password: null }
    expect(isShadowUser(shadow)).toBe(true)
    expect(isShadowUser({ ...shadow, email: 'M763@MANAGED.WIEDISYNC.KSCW.CH' })).toBe(true)
    expect(isShadowUser({ ...shadow, status: 'active' })).toBe(false)
    expect(isShadowUser({ ...shadow, password: '$argon2...' })).toBe(false)
    expect(isShadowUser({ ...shadow, password: undefined, has_password: true })).toBe(false)
    expect(isShadowUser({ ...shadow, email: 'kid@example.invalid' })).toBe(false)
    expect(isShadowUser(null)).toBe(false)
    expect(managedEmailFor(5)).toBe(`m5@${MANAGED_EMAIL_DOMAIN}`)
  })

  it('never lets a member with her own real login be managed (the consent rule)', () => {
    const member = { id: 5, user: 'u5', role: '["user"]', is_spielplaner: false }
    expect(manageableReason({ member, user: { email: 'kid@example.invalid', status: 'active' } })).toBe('member_has_own_login')
    // A real login that is merely inactive/invited is still a real login.
    expect(manageableReason({ member, user: { email: 'kid@example.invalid', status: 'invited' } })).toBe('member_has_own_login')
    expect(manageableReason({ member, user: { email: managedEmailFor(5), status: 'draft', has_password: false } })).toBeNull()
    expect(manageableReason({ member: { ...member, user: null } })).toBeNull()
  })

  it('refuses staff as a managed target', () => {
    const member = { id: 5, user: null, role: '["user"]', is_spielplaner: false }
    expect(manageableReason({ member: { ...member, is_spielplaner: true } })).toBe('member_is_staff')
    expect(manageableReason({ member: { ...member, role: '["user","vb_admin"]' } })).toBe('member_is_staff')
    expect(manageableReason({ member, isStaffLinked: true })).toBe('member_is_staff')
    expect(manageableReason({ member: null })).toBe('member_not_found')
  })

  it('says why a linked member is not switchable — the one predicate behind the switcher, the admin list and the middleware', () => {
    const member = { id: 563, user: 'shadow-563', role: '["user"]', is_spielplaner: false }
    const user = { email: managedEmailFor(563), status: 'draft', has_password: false }
    expect(actableReason({ member, user, roleName: 'Member' })).toBeNull()
    expect(actableReason({ member: { ...member, user: null }, user: null, roleName: null })).toBe('not_provisioned')
    expect(actableReason({ member, user: { ...user, has_password: true }, roleName: 'Member' })).toBe('not_provisioned')
    expect(actableReason({ member, user, roleName: 'Team Responsible' })).toBe('member_is_staff')
    expect(actableReason({ member, user, roleName: 'Member', hasUserAccess: true })).toBe('member_is_staff')
    expect(actableReason({ member, user, roleName: 'Member', isStaffLinked: true })).toBe('member_is_staff')
    expect(actableReason({ member: { ...member, role: '["user","finance"]' }, user, roleName: 'Member' })).toBe('member_is_staff')
    expect(actableReason({ member: { ...member, is_spielplaner: true }, user, roleName: 'Member' })).toBe('member_is_staff')
  })

  it('lets any real login be the main account — no age rule, a sibling may manage a sibling', () => {
    const minorWithLogin = { id: 112, user: 'u112', birthdate: '2017-03-01' }
    expect(guardianReason({ member: minorWithLogin, user: { email: 'anne@example.invalid', status: 'active' } })).toBeNull()
    expect(guardianReason({ member: { ...minorWithLogin, user: null } })).toBe('guardian_needs_login')
    expect(guardianReason({ member: minorWithLogin, user: { email: managedEmailFor(112), status: 'draft' } })).toBe('guardian_is_managed')
  })

  it('lists a member linked in two households once, keeping the accented row', () => {
    const out = dedupeManaged([
      { id: 7, accent: null, household: 1 },
      { id: 7, accent: 'plum', household: 2 },
      { id: 8, accent: 'sky', household: 1 },
    ])
    expect(out).toHaveLength(2)
    expect(out.find((r) => r.id === 7).accent).toBe('plum')
  })

  it('stamps the actor into every audit payload', () => {
    expect(withActorStamp({ a: 1 }, ADMIN)).toEqual({ a: 1, actor_user: ADMIN_USER, actor_admin: true })
    expect(withActorStamp(null, { user: 'u' })).toEqual({ actor_user: 'u', actor_admin: false })
    expect(withActorStamp([1], { user: 'u' })).toEqual({ value: [1], actor_user: 'u', actor_admin: false })
  })
})

describe('routes', () => {
  it('refuses an unknown role with 400 bad_role instead of linking as managed', async () => {
    const res = await call('POST /household/:id/members', { params: { id: '10' }, body: { member: 5, role: 'child' } })
    expect(res.statusCode).toBe(400)
    expect(res.body.code).toBe('bad_role')
    expect(tables.household_members).toHaveLength(2)
  })

  it('refuses every mutation while acting for someone else', async () => {
    const res = await call('PATCH /household/:id', {
      params: { id: '10' }, body: { name: 'x' },
      accountability: { ...ADMIN, kscwGuardian: { user: ADMIN_USER, memberId: 1 } },
    })
    expect(res.statusCode).toBe(403)
    expect(res.body.code).toBe('acting_forbidden')
  })

  it('refuses a mutation with no user to attribute it to', async () => {
    const res = await call('POST /household', { body: { name: 'X' }, accountability: { admin: true } })
    expect(res.statusCode).toBe(401)
    expect(tables.households).toHaveLength(2)
  })

  it('404s a link id that belongs to a different household', async () => {
    const res = await call('DELETE /household/:id/members/:hmId', { params: { id: '11', hmId: '101' } })
    expect(res.statusCode).toBe(404)
    expect(tables.household_members.find((r) => r.id === 101).revoked_at).toBeNull()
    expect(globalThis.__kscwActingGrantBust).not.toHaveBeenCalled()
  })

  it('revokes (never deletes) a link and audits it with the actor stamp', async () => {
    const res = await call('DELETE /household/:id/members/:hmId', { params: { id: '10', hmId: '101' } })
    expect(res.statusCode).toBe(200)
    expect(tables.household_members).toHaveLength(2)
    expect(tables.household_members.find((r) => r.id === 101).revoked_at).toBeInstanceOf(Date)
    // The middleware's grant cache must drop the link now, not after its TTL.
    expect(globalThis.__kscwActingGrantBust).toHaveBeenCalledOnce()
    const log = tables.user_logs.at(-1)
    expect(log.action).toBe('household_unlink')
    expect(JSON.parse(log.data)).toMatchObject({ actor_user: ADMIN_USER, actor_admin: true })
  })

  it('400s a non-numeric household or link id', async () => {
    const res = await call('DELETE /household/:id/members/:hmId', { params: { id: 'x', hmId: '101' } })
    expect(res.statusCode).toBe(400)
  })

  it('renames a household and records before/after', async () => {
    const res = await call('PATCH /household/:id', { params: { id: '10' }, body: { name: '  Familie Alexander ' } })
    expect(res.statusCode).toBe(200)
    expect(tables.households.find((h) => h.id === 10).name).toBe('Familie Alexander')
    const log = tables.user_logs.at(-1)
    expect(log.action).toBe('household_update')
    expect(log.collection_name).toBe('households')
    expect(JSON.parse(log.data)).toMatchObject({ before: { name: 'Familie Alexandre' }, after: { name: 'Familie Alexander' } })
  })

  it('refuses a blank rename and an empty patch', async () => {
    expect((await call('PATCH /household/:id', { params: { id: '10' }, body: { name: '  ' } })).body.code).toBe('name_required')
    expect((await call('PATCH /household/:id', { params: { id: '10' }, body: {} })).body.code).toBe('bad_request')
  })

  it('refuses to delete a household that has (or had) members — the cascade would erase history', async () => {
    tables.household_members.forEach((r) => { r.revoked_at = new Date() })
    const res = await call('DELETE /household/:id', { params: { id: '10' } })
    expect(res.statusCode).toBe(409)
    expect(res.body.code).toBe('household_has_history')
    expect(tables.households.some((h) => h.id === 10)).toBe(true)
  })

  it('deletes a household that never had a member, and audits it', async () => {
    const res = await call('DELETE /household/:id', { params: { id: '11' } })
    expect(res.statusCode).toBe(200)
    expect(tables.households.some((h) => h.id === 11)).toBe(false)
    expect(tables.user_logs.at(-1)).toMatchObject({ action: 'household_delete', record_id: '11' })
  })

  it('provisions the shadow login in the same transaction as a managed link', async () => {
    tables.members.push({ id: 763, user: null, role: '["user"]', is_spielplaner: false, first_name: 'Aliyah', last_name: 'Alexander', wiedisync_active: false })
    tables.directus_roles = [{ id: 'role-member', name: 'Member' }]
    tables.teams_coaches = []
    tables.teams_responsibles = []
    tables.spielplaner_assignments = []
    tables.household_members = tables.household_members.filter((r) => r.id !== 101)
    const created = []
    class UsersService {
      constructor(opts) { this.opts = opts }
      async createOne(data) { created.push({ data, knex: this.opts.knex }); tables.directus_users = [{ id: 'shadow-763', ...data, password: null }]; return 'shadow-763' }
    }
    const router = makeRouter()
    const db = makeDb(tables)
    let trxSeen = null
    db.transaction = async (fn) => { trxSeen = db; return fn(db) }
    registerHousehold(router, { database: db, logger: noopLogger, services: { UsersService }, getSchema: async () => ({}) })
    const res = makeRes()
    await router.routes['POST /household/:id/members']({ params: { id: '10' }, query: {}, body: { member: 763, role: 'managed' }, accountability: ADMIN }, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.data.provisioned).toBe('created')
    expect(created).toHaveLength(1)
    expect(created[0].knex).toBe(trxSeen)
    expect(created[0].data).toMatchObject({ email: managedEmailFor(763), status: 'draft', role: 'role-member' })
    expect(tables.members.find((m) => m.id === 763)).toMatchObject({ user: 'shadow-763', wiedisync_active: true })
    expect(tables.user_logs.map((l) => l.action)).toEqual(['household_link', 'household_provision'])
    expect(globalThis.__kscwActingGrantBust).toHaveBeenCalledOnce()
  })

  it('validates the candidates role', async () => {
    const res = await call('GET /household/candidates', { query: { role: 'kid' } })
    expect(res.statusCode).toBe(400)
    expect(res.body.code).toBe('bad_role')
  })
})

describe('switcher source (GET /household/me)', () => {
  function seedFamily() {
    tables.members.push({ id: 141, user: 'u-elin', first_name: 'Elin', last_name: 'B', photo: null })
    tables['member_guardians as mg'] = [563, 564].map((id) => ({
      'mg.guardian_user': 'u-elin', 'u.status': 'draft', 'u.password': null, 'r.name': 'Member',
      id, first_name: id === 563 ? 'Zoe' : 'Mila', last_name: 'B', photo: null, accent: null, household: 10,
      user: `shadow-${id}`, role: '["user"]', is_spielplaner: false,
      login_email: managedEmailFor(id), login_status: 'draft', role_name: 'Member',
    }))
    tables['member_teams as mt'] = []
  }

  it('lists the main account and both linked members', async () => {
    seedFamily()
    const res = await call('GET /household/me', { accountability: { user: 'u-elin' } })
    expect(res.body.data.self.id).toBe(141)
    expect(res.body.data.managed.map((m) => m.id)).toEqual([563, 564])
    // Staff-marker columns stay server-side.
    expect(res.body.data.managed[0]).not.toHaveProperty('role')
  })

  it('while acting as a linked member, still answers for the MAIN account (sibling switch + way back)', async () => {
    seedFamily()
    const res = await call('GET /household/me', {
      accountability: { user: 'shadow-563', kscwGuardian: { user: 'u-elin', memberId: 141 } },
    })
    expect(res.body.data.self.id).toBe(141)
    expect(res.body.data.managed.map((m) => m.id)).toEqual([563, 564])
  })

  it('hides a linked member who became staff after the link — the middleware would refuse her', async () => {
    seedFamily()
    tables.teams_coaches = [{ teams_id: 1, members_id: 563 }]
    tables.directus_access = [{ id: 'a1', user: 'shadow-564', policy: 'finance' }]
    const res = await call('GET /household/me', { accountability: { user: 'u-elin' } })
    expect(res.body.data.managed).toEqual([])
  })
})

describe('admin list (GET /household)', () => {
  it('marks a linked member who became staff as not actable, with the reason', async () => {
    tables['household_members as hm'] = [
      { id: 101, household: 10, member: 563, role: 'managed', revoked_at: null,
        member_user: 'shadow-563', member_roles: '["user"]', is_spielplaner: false,
        login_email: managedEmailFor(563), user_status: 'draft', login_role: 'Member', login_has_password: false },
      { id: 102, household: 10, member: 564, role: 'managed', revoked_at: null,
        member_user: 'shadow-564', member_roles: '["user"]', is_spielplaner: false,
        login_email: managedEmailFor(564), user_status: 'draft', login_role: 'Member', login_has_password: false },
    ]
    tables.teams_responsibles = [{ teams_id: 1, members_id: 564 }]
    const res = await call('GET /household', {})
    const rows = res.body.data.find((h) => h.id === 10).members
    expect(rows.find((r) => r.member === 563)).toMatchObject({ actable: true, not_actable_reason: null })
    expect(rows.find((r) => r.member === 564)).toMatchObject({ actable: false, not_actable_reason: 'member_is_staff' })
    expect(rows[0]).not.toHaveProperty('member_roles')
  })
})

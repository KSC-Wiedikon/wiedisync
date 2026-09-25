/**
 * The acting-member middleware — the code that decides WHOSE identity every
 * request carrying X-KSCW-Acting-Member runs as.
 *
 * What these pin: main → linked → linked sibling → back to main with one login;
 * every refusal (no grant, revoked grant, a real login, a staff marker given
 * AFTER the link, Directus resolving anything but a plain app user); the path
 * deny list; and the rule that any throw answers 503 and NEVER falls through —
 * falling through would run the request as the main account while the UI shows
 * the linked member.
 *
 * Hermetic: the three @directus/api internals are mocked, the DB is a tiny fake.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@directus/api/permissions/lib/fetch-roles-tree', () => ({ fetchRolesTree: vi.fn(async (role) => [role]) }))
vi.mock('@directus/api/permissions/modules/fetch-global-access/fetch-global-access', () => ({ fetchGlobalAccess: vi.fn(async () => ({ admin: false, app: true })) }))
vi.mock('@directus/api/permissions/utils/create-default-accountability', () => ({ createDefaultAccountability: vi.fn((o) => ({ admin: false, app: false, ...o })) }))

import { createActingMemberMiddleware, isDeniedWhileActing } from '../acting-member.js'
import { fetchGlobalAccess } from '@directus/api/permissions/modules/fetch-global-access/fetch-global-access'

const MAIN = 'u-main'
const MEMBER_ROLE = 'role-member'
const shadow = (id) => ({ id: `shadow-${id}`, email: `m${id}@managed.wiedisync.kscw.ch`, status: 'draft', password: null, role: MEMBER_ROLE })

let state
function makeDb() {
  const db = (table) => {
    const q = { table, conds: {} }
    q.where = (a, b) => { if (typeof a === 'object') Object.assign(q.conds, a); else q.conds[a] = b; return q }
    q.join = () => q
    q.leftJoin = () => q
    q.first = async () => {
      if (table === 'directus_roles') return { id: MEMBER_ROLE }
      if (table === 'member_guardians as mg') {
        const g = state.grants.find((r) => r.guardian_user === q.conds['mg.guardian_user'] && r.member === q.conds['mg.member'])
        if (!g) return undefined
        const u = state.users[g.member]
        if (!u) return { target_member: g.member, target_user: null }
        const m = state.members[g.member] || {}
        return {
          target_member: g.member, target_user: u.id,
          target_member_roles: m.role ?? '["user"]', target_is_spielplaner: m.is_spielplaner ?? false,
          target_role: u.role, target_status: u.status, target_email: u.email,
          target_has_password: u.password != null, guardian_member: 50,
        }
      }
      if (table === 'teams_coaches') return state.coaches.includes(q.conds.members_id) ? { members_id: q.conds.members_id } : undefined
      if (table === 'teams_responsibles') return undefined
      if (table === 'spielplaner_assignments') return undefined
      if (table === 'directus_access') return state.access.includes(q.conds.user) ? { id: 'a1' } : undefined
      return undefined
    }
    q.insert = async (row) => { state.logs.push(row) }
    return q
  }
  db.raw = (s) => s
  return db
}

const logger = { child: () => logger, warn: () => {}, error: () => {}, info: () => {} }

function run(mw, { header, path = '/items/participations', acc = { user: MAIN, role: 'role-guardian', admin: false, app: true, session: 's1' } } = {}) {
  const req = { headers: header == null ? {} : { 'x-kscw-acting-member': String(header) }, path, accountability: acc }
  const res = {
    statusCode: 200, headers: {},
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    setHeader(k, v) { this.headers[k] = v },
  }
  const next = vi.fn()
  return mw(req, res, next).then(() => ({ req, res, next }))
}

beforeEach(() => {
  state = {
    grants: [{ guardian_user: MAIN, member: 563 }, { guardian_user: MAIN, member: 564 }],
    users: { 563: shadow(563), 564: shadow(564) },
    members: {},
    coaches: [],
    access: [],
    logs: [],
  }
  globalThis.__kscwActingGrantBust = undefined
  vi.mocked(fetchGlobalAccess).mockClear()
})

describe('switching', () => {
  it('main -> linked', async () => {
    const mw = createActingMemberMiddleware(makeDb(), logger)
    const { req, res, next } = await run(mw, { header: 563 })
    expect(next).toHaveBeenCalledOnce()
    expect(req.accountability).toMatchObject({
      user: 'shadow-563', role: MEMBER_ROLE, admin: false, app: true, session: 's1',
      kscwActingMember: 563, kscwGuardian: { user: MAIN, memberId: 50 },
    })
    expect(res.headers['X-KSCW-Acting-Member']).toBe('563')
  })

  it('linked -> linked sibling resolves the sibling against the same main login', async () => {
    const mw = createActingMemberMiddleware(makeDb(), logger)
    await run(mw, { header: 563 })
    const { req, res } = await run(mw, { header: 564 })
    expect(req.accountability.user).toBe('shadow-564')
    expect(req.accountability.kscwGuardian.user).toBe(MAIN)
    expect(res.headers['X-KSCW-Acting-Member']).toBe('564')
  })

  it('linked -> main: no header leaves the session owner untouched', async () => {
    const mw = createActingMemberMiddleware(makeDb(), logger)
    await run(mw, { header: 563 })
    const acc = { user: MAIN, role: 'role-guardian', admin: false, app: true }
    const { req, res, next } = await run(mw, { acc })
    expect(next).toHaveBeenCalledOnce()
    expect(req.accountability).toBe(acc)
    expect(res.headers['X-KSCW-Acting-Member']).toBeUndefined()
  })
})

describe('refusals', () => {
  it('a member with no grant gets one opaque grant refusal', async () => {
    const { res, next } = await run(createActingMemberMiddleware(makeDb(), logger), { header: 999 })
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ code: 'KSCW_ACTING_DENIED', scope: 'grant' })
  })

  it('a revoked grant bites as soon as the household route busts the cache', async () => {
    const mw = createActingMemberMiddleware(makeDb(), logger)
    expect((await run(mw, { header: 563 })).next).toHaveBeenCalled()
    state.grants = state.grants.filter((g) => g.member !== 563)
    expect((await run(mw, { header: 563 })).next).toHaveBeenCalled() // cached
    globalThis.__kscwActingGrantBust(MAIN)
    const { res, next } = await run(mw, { header: 563 })
    expect(next).not.toHaveBeenCalled()
    expect(res.body.scope).toBe('grant')
  })

  it('a target with her own real login is refused', async () => {
    state.users[563] = { ...shadow(563), email: 'zoe@example.invalid', status: 'active', password: 'x' }
    const { res } = await run(createActingMemberMiddleware(makeDb(), logger), { header: 563 })
    expect(res.statusCode).toBe(403)
  })

  it('a target whose login role is not Member is refused', async () => {
    state.users[563] = { ...shadow(563), role: 'role-team-responsible' }
    const { res } = await run(createActingMemberMiddleware(makeDb(), logger), { header: 563 })
    expect(res.statusCode).toBe(403)
  })

  // Staff markers given AFTER the link never reach the Directus role — the
  // custom endpoints read them directly. Each must turn the switch off.
  it.each([
    ['an app role beyond user (finance)', () => { state.members[563] = { role: '["user","finance"]' } }],
    ['is_spielplaner', () => { state.members[563] = { is_spielplaner: true } }],
    ['a coach seat', () => { state.coaches.push(563) }],
    ['a user-level directus_access row', () => { state.access.push('shadow-563') }],
  ])('a target with %s is refused, with the same opaque code', async (_label, arrange) => {
    arrange()
    const { res, next } = await run(createActingMemberMiddleware(makeDb(), logger), { header: 563 })
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: 'Not permitted', code: 'KSCW_ACTING_DENIED', scope: 'grant' })
  })

  it('Directus resolving the target as anything but a plain app user is refused', async () => {
    vi.mocked(fetchGlobalAccess).mockResolvedValueOnce({ admin: true, app: true })
    const { res, next } = await run(createActingMemberMiddleware(makeDb(), logger), { header: 563 })
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
  })

  it('/users and /graphql are refused with path scope, case-insensitively', async () => {
    const mw = createActingMemberMiddleware(makeDb(), logger)
    for (const path of ['/users/me', '/USERS', '/graphql', '/GraphQL/system']) {
      const { res, next } = await run(mw, { header: 563, path })
      expect(next).not.toHaveBeenCalled()
      expect(res.body).toMatchObject({ code: 'KSCW_ACTING_DENIED', scope: 'path' })
    }
    expect(isDeniedWhileActing('/users-foo')).toBe(false)
  })

  it('400s a malformed header', async () => {
    for (const h of ['abc', '0', '-3', '1.5']) {
      const { res, next } = await run(createActingMemberMiddleware(makeDb(), logger), { header: h })
      expect(next).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(400)
    }
  })
})

describe('fail-safe', () => {
  it('a throw answers 503 and NEVER falls through as the main account', async () => {
    const db = makeDb()
    const boom = (t) => { if (t === 'member_guardians as mg') throw new Error('db down'); return db(t) }
    boom.raw = db.raw
    const { res, next } = await run(createActingMemberMiddleware(boom, logger), { header: 563 })
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(503)
    expect(res.body.code).toBe('KSCW_ACTING_UNAVAILABLE')
  })

  it('never swaps on /auth (login and refresh stay the session owner)', async () => {
    const acc = { user: MAIN }
    const { req, next } = await run(createActingMemberMiddleware(makeDb(), logger), { header: 563, path: '/auth/refresh', acc })
    expect(next).toHaveBeenCalled()
    expect(req.accountability).toBe(acc)
  })

  it('an unauthenticated caller with the header stays nobody', async () => {
    const { req, next } = await run(createActingMemberMiddleware(makeDb(), logger), { header: 563, acc: { user: null } })
    expect(next).toHaveBeenCalled()
    expect(req.accountability.user).toBeNull()
  })

  it('a share link keeps its own identity', async () => {
    const acc = { user: MAIN, share: 'sh1' }
    const { req, next } = await run(createActingMemberMiddleware(makeDb(), logger), { header: 563, acc })
    expect(next).toHaveBeenCalled()
    expect(req.accountability).toBe(acc)
  })
})

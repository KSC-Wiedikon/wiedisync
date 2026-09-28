// 2026-09-28 audit F37 (migration 382): a push subscription registered while a
// main account acts for a linked member records that guardian login, so revoking
// the grant unbinds her device. Stamped from the acting swap, never the body.
import { describe, it, expect } from 'vitest'
import { registerWebPush } from '../web-push.js'

function setup(existing) {
  const writes = []
  const db = (table) => {
    const chain = {
      where: () => chain,
      select: () => chain,
      first: async () => (table === 'members' ? { id: 5 } : existing),
      update: async (patch) => { writes.push({ op: 'update', table, patch }); return 1 },
      insert: async (row) => { writes.push({ op: 'insert', table, row }); return [] },
    }
    return chain
  }
  const routes = {}
  const router = { get: (p, h) => { routes[`GET ${p}`] = h }, post: (p, h) => { routes[`POST ${p}`] = h } }
  const logger = { child: () => ({ info() {}, warn() {}, error() {} }) }
  registerWebPush(router, { database: db, logger })
  return { handler: routes['POST /web-push/subscribe'], writes }
}
const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } })
const body = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys_p256dh: 'p', keys_auth: 'a',
  acting_guardian_user: 'forged-from-body',
}

describe('POST /web-push/subscribe acting_guardian_user', () => {
  it('stamps the guardian login from the acting swap on insert', async () => {
    const { handler, writes } = setup(undefined)
    const r = res()
    await handler({ body, accountability: { user: 'u-child', kscwGuardian: { user: 'u-parent', memberId: 9 } } }, r)
    expect(r.statusCode).toBe(201)
    expect(writes[0].row.acting_guardian_user).toBe('u-parent')
  })

  it('an own-device subscribe stores null and ignores a body value', async () => {
    const { handler, writes } = setup(undefined)
    await handler({ body, accountability: { user: 'u-child' } }, res())
    expect(writes[0].row.acting_guardian_user).toBeNull()
  })

  it('re-stamps on the upsert of an existing (member, endpoint) row', async () => {
    const { handler, writes } = setup({ id: 77 })
    await handler({ body, accountability: { user: 'u-child', kscwGuardian: { user: 'u-parent' } } }, res())
    expect(writes[0]).toMatchObject({ op: 'update', patch: { acting_guardian_user: 'u-parent' } })
  })
})

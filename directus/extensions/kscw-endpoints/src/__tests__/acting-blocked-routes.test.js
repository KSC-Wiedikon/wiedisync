/**
 * Routes that must refuse while a main account is acting as a linked member
 * (accountability.kscwGuardian set by kscw-hooks/src/acting-member.js).
 *
 * Each one would otherwise turn a revocable acting grant into something that
 * outlives it, or let the main account take a strictly personal decision for
 * the linked member:
 *   - change-password / set-password — a credential on the shadow login
 *   - delete-account                  — not an errand to run from inside someone else's session
 *   - the iCal token mint / rotate    — a bearer URL that outlives revocation
 *   - scorer-delegation accept/decline — scorer duty is personal
 * The DB fakes throw if touched: the refusal must come before any read or write.
 */
import { describe, it, expect, vi } from 'vitest'

// sv-sync.js (imported by index.js) refuses to load without it.
vi.hoisted(() => { process.env.SV_API_KEY ||= 'test-key' })

import endpoints from '../index.js'
import { registerChangePassword } from '../change-password.js'
import { registerICalFeed } from '../ical-feed.js'

const noop = () => {}
const logger = { child: () => logger, info: noop, warn: noop, error: noop, debug: noop }

/** An express-shaped router that records `METHOD /path` → last handler. */
function makeRouter() {
  const routes = {}
  return new Proxy({ routes }, {
    get(target, prop) {
      if (prop in target) return target[prop]
      return (path, ...handlers) => {
        if (typeof path === 'string') routes[`${String(prop).toUpperCase()} ${path}`] = handlers.at(-1)
      }
    },
  })
}

function makeRes() {
  const o = { statusCode: 200, headers: {} }
  o.status = (c) => { o.statusCode = c; return o }
  o.json = (b) => { o.body = b; return o }
  o.set = () => o
  o.setHeader = noop
  o.send = () => o
  o.type = () => o
  return o
}

const acting = { user: 'shadow-563', kscwGuardian: { user: 'u-main', memberId: 50 } }
let touched = 0
const failDb = Object.assign(() => { touched++; throw new Error('must not touch the DB while acting') }, {
  raw: () => { touched++; throw new Error('must not touch the DB while acting') },
  transaction: async () => { touched++; throw new Error('must not touch the DB while acting') },
})

async function expectRefused(handler, body = {}) {
  touched = 0
  const res = makeRes()
  await handler({ accountability: acting, body, params: {}, query: {}, headers: {}, path: '/x', method: 'POST', ip: '127.0.0.1', socket: {} }, res)
  expect(res.statusCode).toBe(403)
  expect(res.body.code).toBe('acting_forbidden')
  expect(touched).toBe(0)
}

describe('refused while acting', () => {
  it('change-password', async () => {
    const R = makeRouter()
    registerChangePassword(R, { database: failDb, services: {}, getSchema: noop, logger })
    await expectRefused(R.routes['POST /change-password'], { current_password: 'a', new_password: 'b' })
  })

  it('every iCal token route', async () => {
    const R = makeRouter()
    registerICalFeed(R, { database: failDb, logger })
    const keys = Object.keys(R.routes).filter((k) => k.includes('ical-token'))
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) await expectRefused(R.routes[k])
  })

  describe('kscw-endpoints index routes', () => {
    const R = makeRouter()
    endpoints.handler(R, { services: {}, database: failDb, logger, getSchema: async () => ({}), env: {} })

    it.each([
      ['POST /set-password', { password: 'x' }],
      ['POST /delete-account', {}],
      ['POST /scorer-delegation/accept', { delegation_id: 1 }],
      ['POST /scorer-delegation/decline', { delegation_id: 1 }],
    ])('%s', async (key, body) => {
      expect(R.routes[key], key).toBeTypeOf('function')
      await expectRefused(R.routes[key], body)
    })
  })
})

// 2026-09-28 audit F56: /change-password runs the same password rules as every other
// password path, and refuses a weak password before it touches the DB or logs in.
import { describe, it, expect } from 'vitest'
import { registerChangePassword, basicPasswordCheck } from '../change-password.js'

const noop = () => {}
const logger = { child: () => logger, info: noop, warn: noop, error: noop }

function setup(deps) {
  const routes = {}
  const router = { post: (p, h) => { routes[`POST ${p}`] = h } }
  let touched = 0
  const db = Object.assign(() => { touched++; throw new Error('must not touch the DB') }, {
    transaction: async () => { touched++; throw new Error('must not touch the DB') },
  })
  registerChangePassword(router, { database: db, services: {}, getSchema: noop, logger }, deps)
  return { handler: routes['POST /change-password'], touched: () => touched }
}

async function call(handler, body) {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
  await handler({ accountability: { user: 'u-1' }, body }, res)
  return res
}

describe('basicPasswordCheck', () => {
  it('mirrors the length + composition rule', () => {
    expect(basicPasswordCheck('Ab1')?.code).toBe('password_too_short')
    expect(basicPasswordCheck('aaaaaaaa')?.code).toBe('password_weak')
    expect(basicPasswordCheck('12345678')?.code).toBe('password_weak')
    expect(basicPasswordCheck('Volley1ball')).toBeNull()
  })
})

describe('POST /change-password password rules (F56)', () => {
  it('refuses a weak new password without touching the DB (fallback rule)', async () => {
    const { handler, touched } = setup()
    const res = await call(handler, { current_password: 'Old-pass1', new_password: 'aaaaaaaa' })
    expect(res.statusCode).toBe(400)
    expect(res.body.code).toBe('password_weak')
    expect(touched()).toBe(0)
  })

  it('uses the injected validatePassword when index.js provides it', async () => {
    const { handler, touched } = setup({
      validatePassword: (p) => (p === 'Password1' ? { error: 'common', code: 'password_too_common' } : null),
    })
    const res = await call(handler, { current_password: 'Old-pass1', new_password: 'Password1' })
    expect(res.statusCode).toBe(400)
    expect(res.body.code).toBe('password_too_common')
    expect(touched()).toBe(0)
  })
})

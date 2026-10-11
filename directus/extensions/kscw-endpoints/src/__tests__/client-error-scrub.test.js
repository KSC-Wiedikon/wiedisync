// /kscw/client-error is unauthenticated and writes a 30-day JSONL file every admin
// can read. It stored `body.payload` capped but NOT scrubbed, so a client that
// scrubbed less than it should — the pre-2026-10 bundle let `current_password`,
// `new_password` and the re-wrapped E2EE key through — had its secrets written
// verbatim (security audit 2026-10, H2). The server now scrubs whatever it is
// sent, and redacts base64url share tokens (`/e/<token>`) the hex rule missed.
import { describe, it, expect, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const LOG_DIR = vi.hoisted(() => {
  const dir = `${require('node:os').tmpdir()}/kscw-client-error-${process.pid}-${Date.now()}`
  process.env.ERROR_LOG_DIR = dir
  // Module-level reads in modules index.js imports.
  process.env.TURNSTILE_SECRET ||= 'test-turnstile'
  process.env.SECRET ||= 'test-ticket-secret'
  process.env.SV_API_KEY ||= 'test-key'
  return dir
})

import endpoints from '../index.js'
import { isSensitiveKey, scrubPii, scrubJsonString, redactUrlTokens } from '../error-log.js'

const shareToken = 'Zk3_q9-LmN0pQrStUvWxYz012345AbCdEfGhIjKlMnO' // gitleaks:allow — synthetic fixture

describe('isSensitiveKey', () => {
  it('matches the credential and personal-data families', () => {
    for (const k of ['password', 'current_password', 'new_password', 'newPassword', 'pwd', 'private_key',
      'privateKey', 'e2ee', 'e2ee_kdf_salt', 'salt', 'kdf', 'wrapped_key', 'client_secret', 'share_token',
      'ticket', 'otp', 'otp_code', 'pin', 'write_pin', 'code', 'ahv_nummer', 'iban', 'adresse', 'address',
      'plz', 'ort', 'postcode', 'zip', 'birthdate', 'phone', 'proposer_email', 'contact_name', 'firstName']) {
      expect(isSensitiveKey(k), k).toBe(true)
    }
  })

  it('leaves ordinary keys alone', () => {
    for (const k of ['sort', 'report', 'export', 'mapping', 'shipping', 'pinned', 'footprint', 'error_code',
      'status_code', 'salted', 'mime', 'size', 'count', 'member', 'elapsed_ms', 'res', 'pending', 'nav']) {
      expect(isSensitiveKey(k), k).toBe(false)
    }
  })
})

describe('scrubPii', () => {
  it('descends into nested objects and arrays', () => {
    expect(scrubPii({ e2ee: { private_key: 'k' }, rows: [{ new_password: 'p', id: 1 }], meta: { plz: '8000' } }))
      .toEqual({ e2ee: '[REDACTED]', rows: [{ new_password: '[REDACTED]', id: 1 }], meta: { plz: '[REDACTED]' } })
    expect(scrubPii([{ salt: 's' }])).toEqual([{ salt: '[REDACTED]' }])
  })

  it('survives a hostile, deeply nested payload', () => {
    let deep = { password: 'x' }
    for (let i = 0; i < 5000; i++) deep = { a: deep }
    expect(() => scrubPii(deep)).not.toThrow()
    expect(JSON.stringify(scrubPii(deep))).not.toContain('"x"')
  })
})

describe('scrubJsonString', () => {
  it('scrubs a JSON body by key and masks e-mail addresses', () => {
    const out = scrubJsonString(JSON.stringify({ error: 'Taken: anna@example.ch', current_password: 'Secr3t!' }))
    expect(out).not.toContain('Secr3t!')
    expect(out).not.toContain('anna@example.ch')
    expect(JSON.parse(out).current_password).toBe('[REDACTED]')
  })

  it('still scrubs a JSON body the client cut mid-way', () => {
    const cut = '{"data":{"new_password":"Secr3t!","e2ee":{"private_key":"AAAA","salt":"BBBB"},"note":"keep me","ahv_nummer":"756.1'
    const out = scrubJsonString(cut)
    for (const secret of ['Secr3t!', 'AAAA', 'BBBB', '756.1']) expect(out).not.toContain(secret)
    expect(out).toContain('keep me')
  })
})

describe('redactUrlTokens', () => {
  it('redacts the base64url share token on the app page and the API', () => {
    expect(redactUrlTokens(`/e/${shareToken}`)).toBe('/e/[REDACTED]')
    expect(redactUrlTokens(`/kscw/public/events/${shareToken}/signup`)).toBe('/kscw/public/events/[REDACTED]/signup')
  })

  it('redacts any random-looking whole segment and long hex, keeps slugs and assets', () => {
    expect(redactUrlTokens(`/kscw/new-route/${shareToken}`)).toBe('/kscw/new-route/:token')
    expect(redactUrlTokens('/kscw/team-invites/info/a1b2c3d4e5f60718a9b0c1d2e3f40516')).toBe('/kscw/team-invites/info/:token')
    for (const p of ['/kscw/clubdesk-registration-status', '/assets/SpielplanungAdminPage-Dk3j4kLm.js', '/e/:token']) {
      expect(redactUrlTokens(p)).toBe(p)
    }
  })
})

describe('POST /client-error end to end', () => {
  function handler() {
    const routes = {}
    const R = new Proxy({ routes }, {
      get(t, prop) {
        if (prop in t) return t[prop]
        return (path, ...h) => { if (typeof path === 'string') routes[`${String(prop).toUpperCase()} ${path}`] = h.at(-1) }
      },
    })
    const db = () => new Proxy({}, { get: () => () => Promise.resolve(null) })
    const logger = { child: () => ({ info() {}, warn() {}, error() {} }) }
    endpoints.handler(R, { services: {}, database: db, logger, getSchema: async () => ({}), env: {} })
    return routes['POST /client-error']
  }

  it('writes no password, key material or share token to the log', async () => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this },
      end() { return this },
      json() { return this },
      set() { return this },
    }
    await handler()({
      headers: { 'cf-connecting-ip': '192.0.2.200' },
      body: {
        event: 'api_error',
        endpoint: '/change-password',
        page: `/e/${shareToken}`,
        error: `API /public/events/${shareToken}: 500`,
        responseBody: JSON.stringify({ errors: [{ message: 'x', extensions: { new_password: 'Body-Secr3t' } }] }),
        payload: {
          current_password: 'Old-Secr3t!',
          new_password: 'New-Secr3t!',
          e2ee: { private_key: 'PRIVATE-KEY-B64', salt: 'SALT-B64' }, // gitleaks:allow — synthetic fixture
          ahv_nummer: '756.1234.5678.97',
        },
      },
    }, res)
    expect(res.statusCode).toBe(204)
    await new Promise((r) => setTimeout(r, 50)) // appendFile is fire-and-forget
    const log = readdirSync(LOG_DIR).map((f) => readFileSync(join(LOG_DIR, f), 'utf8')).join('')
    expect(log).toContain('api_error')
    for (const secret of ['Old-Secr3t!', 'New-Secr3t!', 'PRIVATE-KEY-B64', 'SALT-B64', '756.1234.5678.97', 'Body-Secr3t', shareToken]) {
      expect(log).not.toContain(secret)
    }
  })

  it('scrubs a payload sent as a JSON string too', async () => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, end() { return this } }
    await handler()({
      headers: { 'cf-connecting-ip': '192.0.2.201' },
      body: { event: 'api_error', error: 'boom', payload: JSON.stringify({ write_pin: '424242', sql: 'select 1' }) },
    }, res)
    await new Promise((r) => setTimeout(r, 50))
    const log = readdirSync(LOG_DIR).map((f) => readFileSync(join(LOG_DIR, f), 'utf8')).join('')
    expect(log).not.toContain('424242')
    expect(log).toContain('select 1')
  })
})

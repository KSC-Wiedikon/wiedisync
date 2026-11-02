// 2026-11-02: a member never got a push and nothing said why. "Send test
// notification" (POST /web-push/test-self) lets a member check their own
// device, and a refused push now leaves a log line instead of nothing.
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-push-test-self-'))
let registerWebPush, validatePushEndpoint, sendPushToMembers, PUSH_BATCH_SIZE

beforeAll(async () => {
  // Both are read at import time.
  process.env.PUSH_AUTH_SECRET = 'x'.repeat(40)
  process.env.ERROR_LOG_DIR = logDir
  vi.resetModules()
  ;({ registerWebPush, validatePushEndpoint, sendPushToMembers, PUSH_BATCH_SIZE } = await import('../web-push.js'))
})
afterAll(() => {
  delete process.env.PUSH_AUTH_SECRET
  fs.rmSync(logDir, { recursive: true, force: true })
})

const ROWS = [
  { id: 1, member: 5, endpoint: 'https://fcm.googleapis.com/fcm/send/phone', keys_p256dh: 'p1', keys_auth: 'a1' },
  { id: 2, member: 5, endpoint: 'https://fcm.googleapis.com/fcm/send/laptop', keys_p256dh: 'p2', keys_auth: 'a2' },
]

function setup({ member = { id: 5, language: 'english' }, rows = ROWS } = {}) {
  const db = (table) => {
    const filters = []
    const chain = {
      where: (col, val) => { filters.push([col, val]); return chain },
      whereIn: () => chain,
      select: async () => rows.filter(r => filters.every(([c, v]) => r[c] === v)),
      first: async () => (table === 'members' ? member : undefined),
      delete: async () => 0,
    }
    if (table === 'members') chain.select = () => chain
    return chain
  }
  const routes = {}
  const router = { get: (p, h) => { routes[`GET ${p}`] = h }, post: (p, h) => { routes[`POST ${p}`] = h } }
  const warnings = []
  const logger = { child: () => ({ info() {}, warn: (m) => warnings.push(m), error() {} }) }
  registerWebPush(router, { database: db, logger })
  return { handler: routes['POST /web-push/test-self'], warnings }
}
const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } })
let user = 0
const nextUser = () => ({ user: `u-${++user}` })

describe('POST /web-push/test-self', () => {
  let fetchMock
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ sent: 1, failed: 0, errors: [], expired: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('refuses an anonymous caller', async () => {
    const { handler } = setup()
    const r = res()
    await handler({ body: {}, accountability: null }, r)
    expect(r.statusCode).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says registered: false when the server holds no row for this device', async () => {
    const { handler } = setup({ member: { id: 6, language: 'german' } })
    const r = res()
    await handler({ body: { endpoint: 'https://fcm.googleapis.com/fcm/send/other' }, accountability: nextUser() }, r)
    expect(r.body).toEqual({ registered: false, sent: 0, failed: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends only to the asking device, in the member\'s language', async () => {
    const { handler } = setup({ member: { id: 5, language: 'english' } })
    const r = res()
    await handler({ body: { endpoint: ROWS[0].endpoint }, accountability: nextUser() }, r)
    expect(r.body).toEqual({ registered: true, sent: 1, failed: 0 })
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.subscriptions.map(s => s.endpoint)).toEqual([ROWS[0].endpoint])
    expect(sent.title).toBe('Test notification')
    expect(sent.body).toBe('Notifications work on this device.')
  })

  it('allows three tests per member per ten minutes', async () => {
    const { handler } = setup({ member: { id: 7, language: 'german' }, rows: ROWS.map(r => ({ ...r, member: 7 })) })
    const codes = []
    for (let i = 0; i < 4; i++) {
      const r = res()
      await handler({ body: {}, accountability: nextUser() }, r)
      codes.push(r.statusCode)
    }
    expect(codes).toEqual([200, 200, 200, 429])
  })

  it('logs the push service\'s answer when every subscription is refused', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({
      sent: 0, failed: 1, expired: [],
      errors: ['403: the key in the authorization header does not correspond to the sender'],
    }), { status: 200 }))
    const { handler, warnings } = setup({ member: { id: 8, language: 'german' }, rows: ROWS.map(r => ({ ...r, member: 8 })) })
    const r = res()
    await handler({ body: { endpoint: ROWS[0].endpoint }, accountability: nextUser() }, r)
    expect(r.body).toEqual({ registered: true, sent: 0, failed: 1 })
    expect(warnings.some(w => typeof w === 'string' && w.includes('403: the key in the authorization header'))).toBe(true)
  })
})

// The Directus list now equals the Worker's ALLOWED_PUSH_HOSTS: a host taken here
// but refused there was a subscription that showed "on" and never delivered.
describe('validatePushEndpoint — same hosts as the Worker', () => {
  it('accepts the browsers\' push services', () => {
    expect(validatePushEndpoint('https://fcm.googleapis.com/fcm/send/abc').ok).toBe(true)
    expect(validatePushEndpoint('https://web.push.apple.com/QAbc').ok).toBe(true)
    expect(validatePushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=abc').ok).toBe(true)
  })

  it('rejects other Google and Microsoft hosts the Worker would refuse', () => {
    expect(validatePushEndpoint('https://storage.googleapis.com/bucket/x').ok).toBe(false)
    expect(validatePushEndpoint('https://android.googleapis.com/gcm/send/abc').ok).toBe(false)
    expect(validatePushEndpoint('https://login.windows.com/x').ok).toBe(false)
  })
})

// The club's Cloudflare account is on the Free plan: 50 subrequests per Worker
// call, one per subscription. A fanout goes out in calls of at most 40.
describe('sendPushToMembers — batches for the Free plan', () => {
  it('sends 90 subscriptions as 40 + 40 + 10 and adds up the results', async () => {
    const rows = Array.from({ length: 90 }, (_, i) => ({
      id: i, endpoint: `https://fcm.googleapis.com/fcm/send/d${i}`, keys_p256dh: 'p', keys_auth: 'a',
    }))
    const db = () => {
      const chain = { whereIn: () => chain, where: () => chain, select: async () => rows, delete: async () => 0 }
      return chain
    }
    const sizes = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const n = JSON.parse(init.body).subscriptions.length
      sizes.push(n)
      return new Response(JSON.stringify({ sent: n, failed: 0, errors: [], expired: [] }), { status: 200 })
    }))
    const result = await sendPushToMembers(db, [1, 2], 'T', 'B', 'https://x', 'tag', { info() {}, warn() {}, error() {} })
    expect(PUSH_BATCH_SIZE).toBeLessThan(50)
    expect(sizes).toEqual([40, 40, 10])
    expect(result).toEqual({ sent: 90, failed: 0, cleaned: 0 })
  })

  it('counts a refused batch as failed and still sends the next one', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      id: i, endpoint: `https://fcm.googleapis.com/fcm/send/d${i}`, keys_p256dh: 'p', keys_auth: 'a',
    }))
    const db = () => {
      const chain = { whereIn: () => chain, where: () => chain, select: async () => rows, delete: async () => 0 }
      return chain
    }
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const n = JSON.parse(init.body).subscriptions.length
      if (call++ === 0) return new Response('{"error":"rate limited"}', { status: 429 })
      return new Response(JSON.stringify({ sent: n, failed: 0, errors: [], expired: [] }), { status: 200 })
    }))
    const result = await sendPushToMembers(db, [1], 'T', 'B', 'https://x', 'tag', { info() {}, warn() {}, error() {} })
    expect(result).toEqual({ sent: 10, failed: 40, cleaned: 0 })
  })
})
